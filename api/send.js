const nodemailer = require('nodemailer');

const MIN_FORM_AGE_MS = 3000;
const MAX_MESSAGE_LENGTH = 5000;
const MAX_FIELD_LENGTH = 500;
const DEFAULT_SUBJECT = 'Заявка с сайта ИВВС';
let cachedTransporter = null;

function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function normalize(value) {
  return String(value || '').trim();
}

function escapeHtml(value) {
  return normalize(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plainText(value) {
  return normalize(value).replace(/\r\n/g, '\n');
}

function normalizeConsent(value) {
  if (value === true || value === 'true' || value === 'on' || value === '1') {
    return true;
  }

  return false;
}

function parseOrigins(raw) {
  return String(raw || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function getRequestOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return host ? `${proto}://${host}` : '';
}

function allowedOrigin(req) {
  const configured = parseOrigins(
    [process.env.SITE_ORIGIN, process.env.ALLOWED_ORIGINS].filter(Boolean).join(',')
  );
  const requestOrigin = req.headers.origin || '';
  const fallbackOrigin = getRequestOrigin(req);

  if (configured.length > 0) {
    return configured.includes(requestOrigin);
  }

  return requestOrigin && requestOrigin === fallbackOrigin;
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || '';

  if (!origin || !allowedOrigin(req)) {
    return false;
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';

    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1024 * 64) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });

    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function renderEmail({ name, phone, pet, subject, message }) {
  const safeName = escapeHtml(name);
  const safePhone = escapeHtml(phone);
  const safePet = escapeHtml(pet);
  const safeSubject = escapeHtml(subject);
  const safeMessage = escapeHtml(message).replace(/\n/g, '<br>');

  return {
    subject: subject || DEFAULT_SUBJECT,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2328">
        <h2 style="margin:0 0 12px">Новая заявка с сайта</h2>
        <p style="margin:0 0 8px"><strong>Имя:</strong> ${safeName}</p>
        <p style="margin:0 0 8px"><strong>Телефон:</strong> ${safePhone}</p>
        <p style="margin:0 0 8px"><strong>Питомец:</strong> ${safePet || '—'}</p>
        <p style="margin:0 0 8px"><strong>Тема:</strong> ${safeSubject || '—'}</p>
        <p style="margin:0 0 8px"><strong>Сообщение:</strong></p>
        <div style="padding:12px 14px;background:#f6f8fa;border-radius:12px;border:1px solid #e5e7eb">
          ${safeMessage || '—'}
        </div>
      </div>
    `,
    text: [
      'Новая заявка с сайта',
      `Имя: ${plainText(name)}`,
      `Телефон: ${plainText(phone)}`,
      `Питомец: ${plainText(pet) || '—'}`,
      `Тема: ${plainText(subject) || '—'}`,
      '',
      'Сообщение:',
      plainText(message) || '—',
    ].join('\n'),
  };
}

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function parsePort(value) {
  const port = Number.parseInt(value, 10);
  return Number.isFinite(port) && port > 0 ? port : undefined;
}

function getSmtpTransporter() {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  if (process.env.SMTP_URL) {
    cachedTransporter = nodemailer.createTransport(process.env.SMTP_URL);
    return cachedTransporter;
  }

  const host = normalize(process.env.SMTP_HOST);
  const defaultHost = 'smtp.mail.ru';
  const smtpHost = host || defaultHost;
  const smtpPort = parsePort(process.env.SMTP_PORT) || 465;
  const smtpSecure = process.env.SMTP_SECURE
    ? parseBoolean(process.env.SMTP_SECURE)
    : smtpPort === 465;

  cachedTransporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth:
      process.env.SMTP_USER || process.env.SMTP_PASS
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          }
        : undefined,
  });

  return cachedTransporter;
}

function getMailFrom() {
  return normalize(process.env.MAIL_FROM || process.env.SMTP_FROM);
}

module.exports = async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    if (!setCorsHeaders(req, res)) {
      json(res, 403, { error: 'Forbidden origin' });
      return;
    }

    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (!allowedOrigin(req)) {
    json(res, 403, { error: 'Forbidden origin' });
    return;
  }

  setCorsHeaders(req, res);

  const transporter = getSmtpTransporter();
  const mailFrom = getMailFrom();
  const mailTo = normalize(process.env.MAIL_TO);

  if (!transporter || !mailFrom || !mailTo) {
    json(res, 500, {
      error:
        'Server is not configured. Set SMTP_USER, SMTP_PASS, MAIL_FROM and MAIL_TO. SMTP_HOST defaults to smtp.mail.ru.',
    });
    return;
  }

  let payload;

  try {
    const raw = await readBody(req);
    payload = JSON.parse(raw || '{}');
  } catch (error) {
    json(res, 400, { error: 'Invalid JSON payload' });
    return;
  }

  const name = normalize(payload.name).slice(0, MAX_FIELD_LENGTH);
  const phone = normalize(payload.phone).slice(0, MAX_FIELD_LENGTH);
  const pet = normalize(payload.pet).slice(0, MAX_FIELD_LENGTH);
  const subject = normalize(payload.subject).slice(0, MAX_FIELD_LENGTH);
  const message = normalize(payload.message).slice(0, MAX_MESSAGE_LENGTH);
  const website = normalize(payload.website);
  const startedAt = Number.parseInt(payload.startedAt, 10);
  const consent = normalizeConsent(payload.consent);

  if (website) {
    json(res, 400, { error: 'Spam detected' });
    return;
  }

  if (!name || !phone || !consent) {
    json(res, 400, { error: 'Name, phone and consent are required' });
    return;
  }

  if (!Number.isFinite(startedAt) || Date.now() - startedAt < MIN_FORM_AGE_MS) {
    json(res, 400, { error: 'Form submitted too quickly' });
    return;
  }

  const body = renderEmail({ name, phone, pet, subject, message });

  try {
    const info = await transporter.sendMail({
      from: mailFrom,
      to: mailTo,
      subject: body.subject,
      html: body.html,
      text: body.text,
    });

    json(res, 200, { ok: true, id: info.messageId });
  } catch (error) {
    json(res, 500, {
      error: 'Failed to send email',
      details: process.env.NODE_ENV === 'production' ? undefined : error.message,
    });
  }
};

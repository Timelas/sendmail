# SendMail

Минимальный Vercel API для приёма данных с внешних форм и пересылки их на почту через SMTP.

Подходит для сценария, где формы живут на других доменах: они отправляют `POST` на этот Vercel endpoint, а сервер уже шлёт письмо. Секреты остаются только на сервере.

## Что защищено

- Секретный ключ почтового сервиса не попадает в браузер
- API принимает только `POST`
- Проверяется `Origin` по allowlist
- Есть honeypot для ботов
- Есть минимальное время заполнения формы
- Поля ограничены по длине и валидируются на сервере

## Файлы

- `api/send.js` — serverless-обработчик отправки письма
- `vercel.json` — security headers
- `package.json` — зависимость `nodemailer`

## Переменные окружения

Настройте в Vercel:

- `SMTP_USER` — логин SMTP, обычно полный адрес ящика Mail.ru
- `SMTP_PASS` — пароль SMTP или пароль приложения
- `MAIL_FROM` — отправитель, например `Site Form <your@mail.ru>`
- `MAIL_TO` — адрес, куда приходят заявки
- `SITE_ORIGIN` — ваш основной домен, например `https://example.com`

Опционально:

- `SMTP_HOST` — хост SMTP, по умолчанию `smtp.mail.ru`
- `SMTP_PORT` — порт SMTP, по умолчанию `465`
- `SMTP_SECURE` — `true` для SSL/TLS, `false` для STARTTLS
- `ALLOWED_ORIGINS` — список допустимых origin через запятую, например `https://example.com,https://landing.example.org`

## Локальный запуск

Проще всего через Vercel CLI:

```bash
npm i -g vercel
vercel dev
```

Перед запуском добавьте переменные окружения в Vercel или локальный `.env` файл.

## Деплой

1. Залейте проект в GitHub.
2. Импортируйте репозиторий в Vercel.
3. Задайте переменные окружения.
4. Убедитесь, что `ALLOWED_ORIGINS` содержит все домены, с которых будет идти форма.
5. Если нужен только один домен, достаточно `SITE_ORIGIN`.

### Для Mail.ru

Если используете Mail.ru, обычно достаточно задать:

```env
SMTP_USER=your@mail.ru
SMTP_PASS=your-app-password
MAIL_FROM=Site Form <your@mail.ru>
MAIL_TO=you@example.com
ALLOWED_ORIGINS=https://site1.com,https://site2.com
```

`SMTP_HOST` и `SMTP_PORT` можно не указывать, потому что код использует `smtp.mail.ru:465` по умолчанию.

## Подключение с другого домена

На любом HTML-фронте отправляйте `fetch` на ваш Vercel endpoint:

```html
<script>
  window.SENDMAIL_API_URL = 'https://your-project.vercel.app/api/send';
</script>
<script>
  async function sendForm(form) {
    const payload = Object.fromEntries(new FormData(form).entries());
    const response = await fetch(window.SENDMAIL_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      mode: 'cors',
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Send failed');
    return result;
  }
</script>
```

Если фронтов несколько, добавьте все их origin в `ALLOWED_ORIGINS`. Сервер не отправит письмо, если запрос пришёл с неразрешённого домена.

## Примечание

Если нужен другой почтовый провайдер, можно заменить `api/send.js` на его SDK, но принцип безопасности останется тем же: секреты только на сервере, не в HTML.

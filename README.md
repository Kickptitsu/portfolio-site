# Сайт-портфолио

Статический сайт: HTML, CSS и JavaScript без сборщиков и внешних библиотек.
Ничего не скачивает со сторонних сайтов, не собирает данные посетителей, форм нет.

## Посмотреть у себя

Демо-чат читает сценарии из JSON-файлов. Браузер не разрешает это, если открыть
`index.html` двойным щелчком, поэтому нужен простой локальный сервер. В папке сайта:

```bash
python -m http.server 8000
```

Откройте http://localhost:8000. Остановить сервер — `Ctrl+C`.

## Что где лежит

```
index.html        вся страница
css/style.css     оформление; цвета — в начале файла
js/demo.js        движок демо-чата
demos/            сценарии демо (как добавить новый — demos/README.md)
favicon.svg       значок вкладки
```

## Перед публикацией

- Когда боты будут работать на сервере, добавьте в карточки проектов ссылки на них
  (там оставлены комментарии).
- После покупки домена добавьте в `<head>` строки `og:url` и `og:image` —
  тогда в Telegram у ссылки появится картинка.

## Размещение на VPS (nginx)

Скопируйте папку на сервер, например в `/var/www/portfolio`, и добавьте сайт в nginx:

```nginx
server {
    listen 80;
    server_name example.ru;            # ваш домен
    root /var/www/portfolio;
    index index.html;

    # Сжатие: страница с демо весит ~25 КБ вместо ~90 КБ
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    # Браузер каждый раз сверяет файлы с сервером (короткий запрос),
    # поэтому правки видны сразу, а неизменённые файлы заново не скачиваются
    location / {
        add_header Cache-Control "no-cache";
        try_files $uri $uri/ =404;
    }

    # Служебные файлы не отдаём
    location ~ (README\.md|\.git) { deny all; }
}
```

Проверка и перезапуск: `sudo nginx -t && sudo systemctl reload nginx`.
HTTPS-сертификат бесплатно — через `certbot --nginx`.

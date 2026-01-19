# Link Rotator - Node.js + MongoDB

Высокопроизводительный ротатор ссылок на Node.js с MongoDB и Redis.

## 📥 Установка на Production (Hestia CP)

### 1. Подготовка сервера

Требования:
- Ubuntu 20.04 / 22.04
- Hestia Control Panel
- Root доступ
- Домен привязан к серверу

### 2. Создайте домен в Hestia CP

1. Зайдите в Hestia CP → WEB → Add Web Domain
2. Введите домен: `rotator.example.com`
3. Выберите пользователя: `admin`

### 3. Загрузите проект на сервер

```bash
# Подключитесь к серверу
ssh root@your-server

# Перейдите в папку домена
cd /home/admin/web/rotator.example.com/public_html/

# Клонируйте репозиторий
git clone https://github.com/Traffic-Connect/link-rotator-v2.git .

# Если папка не пустая, используйте:
rm -rf * .* 2>/dev/null || true
git clone https://github.com/Traffic-Connect/link-rotator-v2.git .
```

### 4. Запустите установку

```bash
# Сделайте скрипт исполняемым
chmod +x deploy/install.sh

# Запустите установку
sudo bash deploy/install.sh
```

Скрипт спросит:
- **Domain**: `rotator.example.com`
- **Hestia user**: `admin`

Установка автоматически:
- ✅ Установит Node.js 20, MongoDB 4.4, Redis 7, PM2
- ✅ Установит все зависимости
- ✅ Соберет фронтенд
- ✅ Создаст .env с уникальным JWT_SECRET
- ✅ Настроит MongoDB и Redis
- ✅ Настроит Nginx
- ✅ Создаст администратора

### 5. Настройте SSL

1. В Hestia CP откройте настройки домена
2. Включите SSL (Let's Encrypt)
3. Дождитесь выпуска сертификата

### 6. Готово! 🎉

```
URL: https://rotator.example.com
Email: adminseo@trafficconnect.com
Password: m9OviUHdCOKM
```

---

## 🔄 Обновление

```bash
cd /home/admin/web/rotator.example.com/public_html/

# Метод 1: Через Git (рекомендуется)
git pull origin main
bash deploy/update.sh

# Метод 2: Полная переустановка
rm -rf * .*
git clone https://github.com/Traffic-Connect/link-rotator-v2.git .
bash deploy/update.sh
```

---

## 🐳 Docker для разработки

```bash
# 1. Клонируйте репозиторий
git clone https://github.com/Traffic-Connect/link-rotator-v2.git
cd link-rotator-v2

# 2. Запустите
cp .env.example .env
docker-compose up -d
```

Доступ: http://localhost

## 📚 Документация

- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Полная инструкция по развертыванию
- **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)** - Быстрая справка по командам
- **[deploy/](deploy/)** - Скрипты для установки и обновления

## 🔑 Доступ по умолчанию

```
Email: adminseo@trafficconnect.com
Password: m9OviUHdCOKM
```

## 📋 Основные возможности

- ✅ Ротация ссылок с кешированием в Redis
- ✅ Статистика кликов по дням
- ✅ Управление пользователями (роли admin/user)
- ✅ Экспорт статистики в CSV
- ✅ Responsive UI на Vue.js + Bootstrap
- ✅ JWT авторизация
- ✅ PM2 для production
- ✅ Docker для разработки

## 🚀 API Endpoints

```bash
# Публичный редирект (без авторизации)
GET /api/links/r/:key

# Все остальные endpoints требуют авторизации:
POST /api/auth/login
GET  /api/links
POST /api/links
PUT  /api/links/:id
DELETE /api/links/:id
GET  /api/stats/dashboard
```

## 🛠 Технологии

- **Backend**: Node.js 20, Express.js
- **Database**: MongoDB 4.4
- **Cache**: Redis 7
- **Frontend**: Vue.js 3, Bootstrap 5
- **Process Manager**: PM2
- **Proxy**: Nginx

## 📊 Производительность

- 🚀 ~5000 req/s с Redis кешем
- ⚡ Latency 5-15ms (95 percentile)
- 💾 Memory ~50-150MB

## 🆕 Cloudflare воркеры и сервисы

- Что добавилось:
  - Cloudflare-воркер для каждой ссылки: в `Link` есть `cloudflare.*`; `linkController` при создании/обновлении поднимает скрипт, route и DNS через `cloudflareManager`, чистит при удалении; Redis по-прежнему кэширует ротацию.
  - Клоакинг/редиректы: три шаблона воркеров (`src/cloudflare_worker_cloak.js`, `src/cloudflare_worker_cloak_redirect.js`, `src/cloudflare_worker_cloak_wa_money.js`).
  - Батчевые Cloudflare джобы: кеш-правила (`/api/cloudflare-cache`), cloak (`/api/cloudflare-cloak`), redirect cloak (`/api/cloudflare-redirect`), WA money (`/api/cloudflare-wa-money`) — работают через Manager API, статус виден в UI.
  - Сабдомены: `subdomainService` + `Subdomain` создают/удаляют DNS в Cloudflare через Manager API (`/api/subdomains`). **На данный момент не работает.**
  - Креды Cloudflare: модель `CloudflareCredential`, проверка токена/аккаунта, CRUD `/api/cloudflare/credentials`, UI «Cloudflare Workers Credentials».
  - Фронтенд: разделы Cloudflare (Credentials, Caching, Cloak, WA Money, Redirect), расширенный `LinksView` (вкл/выкл воркер, выбор аккаунта, автогенерация cloudflare link), Navbar/роутер обновлены, Users для админа.

- Что нужно настроить, чтобы работало:
  - В `.env` задать `MANAGER_BASE_URL`, `MANAGER_BEARER`, `MANAGER_EMAIL` (для вызова Manager API). Так же `VITE_CLOUDFLARE_BASE_DOMAIN` для дефолтного значения "Cloudflare Link".
  - В UI «Cloudflare Workers Credentials» добавить токен Cloudflare (с правами Workers + Zones:Read) — без этого создание воркеров для ссылок не сработает.

- Как это работает (коротко):
  - CRUD ссылок: по флажку «Enable Cloudflare Worker» создаётся/обновляется воркер с массивом редиректов, route в зоне и A-запись; данные хранятся в Mongo, кэш ротации в Redis.
  - Джобы: бекенд запрашивает креды у Manager API, затем на каждый домен включает кеш-правила, клоакинг или редирект-воркер; прогресс можно читать через `/api/.../status`.

## 🔧 Управление

```bash
# PM2 команды
pm2 list
pm2 logs link-rotator
pm2 restart link-rotator

# Обновление проекта
bash deploy/update.sh
```

## 📞 Поддержка

Проблемы? Смотрите [DEPLOYMENT.md](DEPLOYMENT.md) раздел Troubleshooting

---

**Лицензия:** MIT

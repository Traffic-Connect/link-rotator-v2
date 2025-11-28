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
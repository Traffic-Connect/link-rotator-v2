#!/bin/bash

# ============================================
# Link Rotator - Production Installation Script
# For Hestia Control Panel (Ubuntu/Debian)
# ============================================

set -e

echo "======================================"
echo "Link Rotator - Production Setup"
echo "======================================"
echo ""

# Проверка прав root
if [ "$EUID" -ne 0 ]; then
   echo "❌ Please run as root (sudo bash install.sh)"
   exit 1
fi

# Переменные
DOMAIN=""
USER=""
PROJECT_PATH=""
ADMIN_EMAIL="adminseo@trafficconnect.com"
JWT_SECRET=$(openssl rand -base64 32)

# Получаем параметры
echo "📝 Enter configuration:"
read -p "Domain (e.g., rotator.example.com): " DOMAIN
read -p "Hestia user (e.g., admin): " USER

if [ -z "$DOMAIN" ] || [ -z "$USER" ]; then
    echo "❌ Domain and User are required!"
    exit 1
fi

PROJECT_PATH="/home/$USER/web/$DOMAIN/public_html"

echo ""
echo "Configuration:"
echo "  Domain: $DOMAIN"
echo "  User: $USER"
echo "  Path: $PROJECT_PATH"
echo ""
read -p "Continue? (y/n): " CONTINUE

if [ "$CONTINUE" != "y" ]; then
    echo "Installation cancelled"
    exit 0
fi

echo ""
echo "======================================"
echo "1. Installing System Dependencies"
echo "======================================"

# Update system
apt-get update

# Install Node.js 20
if ! command -v node &> /dev/null; then
    echo "Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
else
    echo "✅ Node.js already installed: $(node -v)"
fi

# Install MongoDB 4.4
if ! command -v mongod &> /dev/null; then
    echo "Installing MongoDB 4.4..."

    # Import MongoDB public key
    wget -qO - https://www.mongodb.org/static/pgp/server-4.4.asc | apt-key add -

    # Add MongoDB repository
    echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/4.4 multiverse" | tee /etc/apt/sources.list.d/mongodb-org-4.4.list

    apt-get update
    apt-get install -y mongodb-org

    # Start MongoDB
    systemctl start mongod
    systemctl enable mongod

    echo "✅ MongoDB installed and started"
else
    echo "✅ MongoDB already installed"
fi

# Install Redis
if ! command -v redis-server &> /dev/null; then
    echo "Installing Redis..."
    apt-get install -y redis-server

    # Configure Redis
    sed -i 's/^supervised no/supervised systemd/' /etc/redis/redis.conf
    sed -i 's/^# maxmemory <bytes>/maxmemory 256mb/' /etc/redis/redis.conf
    sed -i 's/^# maxmemory-policy noeviction/maxmemory-policy allkeys-lru/' /etc/redis/redis.conf

    systemctl restart redis-server
    systemctl enable redis-server

    echo "✅ Redis installed and started"
else
    echo "✅ Redis already installed"
fi

# Install PM2
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    npm install -g pm2
    pm2 startup systemd -u $USER --hp /home/$USER
    echo "✅ PM2 installed"
else
    echo "✅ PM2 already installed"
fi

echo ""
echo "======================================"
echo "2. Setting Up Project"
echo "======================================"

# Убедимся, что директория существует
if [ ! -d "$PROJECT_PATH" ]; then
    echo "❌ Project directory not found at $PROJECT_PATH"
    echo "Please upload your project files to $PROJECT_PATH first"
    exit 1
fi

cd $PROJECT_PATH

# Set ownership
chown -R $USER:$USER $PROJECT_PATH

echo ""
echo "======================================"
echo "3. Installing Node.js Dependencies"
echo "======================================"

# Backend dependencies
sudo -u $USER npm install --production

# Frontend dependencies and build
cd frontend
sudo -u $USER npm install --legacy-peer-deps
sudo -u $USER npm run build
cd ..

echo ""
echo "======================================"
echo "4. Configuring Environment"
echo "======================================"

# Create .env file
cat > .env << EOF
NODE_ENV=production
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/link_rotator
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=$JWT_SECRET
ROTATION_CACHE_TTL=3600
EOF

chown $USER:$USER .env

echo "✅ .env file created"

echo ""
echo "======================================"
echo "5. Initializing Database"
echo "======================================"

# Создаем индексы MongoDB
mongosh link_rotator --eval "
db.links.createIndex({ 'key': 1 }, { unique: true });
db.links.createIndex({ 'userId': 1, 'createdAt': -1 });
db.links.createIndex({ 'userId': 1, 'isActive': 1 });

db.clicks.createIndex({ 'linkId': 1, 'createdAt': -1 });
db.clicks.createIndex({ 'redirectId': 1, 'createdAt': -1 });
db.clicks.createIndex({ 'createdAt': -1 });

db.users.createIndex({ 'email': 1 }, { unique: true });
db.users.createIndex({ 'isActive': 1 });

print('✅ MongoDB indexes created');
"

echo "✅ Database initialized"

echo ""
echo "======================================"
echo "6. Creating PM2 Process"
echo "======================================"

# Копируем ecosystem config если его нет
if [ ! -f "ecosystem.config.js" ]; then
    cp deploy/ecosystem.config.js ecosystem.config.js
fi

chown $USER:$USER ecosystem.config.js

# Create logs directory
mkdir -p logs
chown -R $USER:$USER logs

# Stop any existing process
sudo -u $USER pm2 delete link-rotator 2>/dev/null || true

# Start application with PM2
sudo -u $USER pm2 start ecosystem.config.js
sudo -u $USER pm2 save

echo "✅ Application started with PM2"

echo ""
echo "======================================"
echo "7. Configuring Nginx"
echo "======================================"

# Get server IP
SERVER_IP=$(hostname -I | awk '{print $1}')

# Create full Nginx configuration
NGINX_CONF="/home/$USER/conf/web/$DOMAIN/nginx.conf"

# Backup existing config if it exists
if [ -f "$NGINX_CONF" ]; then
    cp "$NGINX_CONF" "${NGINX_CONF}.backup.$(date +%Y%m%d_%H%M%S)"
    echo "✅ Backed up existing nginx.conf"
fi

cat > $NGINX_CONF << EOF
server {
    listen      ${SERVER_IP}:80;
    server_name ${DOMAIN} www.${DOMAIN};
    root        ${PROJECT_PATH}/frontend/dist;
    index       index.html;

    access_log  /var/log/nginx/domains/${DOMAIN}.log combined;
    access_log  /var/log/nginx/domains/${DOMAIN}.bytes bytes;
    error_log   /var/log/nginx/domains/${DOMAIN}.error.log error;

    include /home/$USER/conf/web/${DOMAIN}/nginx.forcessl.conf*;

    # ===========================
    # 1. SPA routing fallback
    # ===========================
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # ===========================
    # 2. Static files caching
    # ===========================
    location ~* ^.+\.(jpeg|jpg|png|webp|gif|bmp|ico|svg|css|js|woff|woff2|ttf|eot)$ {
        expires max;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    # ===========================
    # 3. Node API proxy
    # ===========================
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # ===========================
    # 4. Health check
    # ===========================
    location /health {
        proxy_pass http://127.0.0.1:3000;
        access_log off;
    }

    # ===========================
    # 5. Errors & stats
    # ===========================
    location /error/ {
        alias /home/$USER/web/${DOMAIN}/document_errors/;
    }

    location /vstats/ {
        alias /home/$USER/web/${DOMAIN}/stats/;
        include /home/$USER/web/${DOMAIN}/stats/auth.conf*;
    }

    include /etc/nginx/conf.d/phpmyadmin.inc*;
    include /etc/nginx/conf.d/phppgadmin.inc*;
    include /home/$USER/conf/web/${DOMAIN}/nginx.conf_*;
}
EOF

chown $USER:$USER $NGINX_CONF

# Test nginx configuration
if nginx -t 2>/dev/null; then
    systemctl reload nginx
    echo "✅ Nginx configured and reloaded"
else
    echo "⚠️  Nginx configuration test failed, please check manually"
    echo "Run: nginx -t"
fi

echo ""
echo "======================================"
echo "8. Creating Admin User"
echo "======================================"

# Run admin creation script
cd $PROJECT_PATH
sudo -u $USER node scripts/create-admin.js

echo ""
echo "======================================"
echo "✅ Installation Complete!"
echo "======================================"
echo ""
echo "📋 Configuration:"
echo "  Domain: https://$DOMAIN"
echo "  Admin Email: $ADMIN_EMAIL"
echo "  Admin Password: m9OviUHdCOKM"
echo ""
echo "⚠️  IMPORTANT: Save these credentials!"
echo ""
echo "📝 Next steps:"
echo "  1. Make sure domain $DOMAIN points to this server IP"
echo "  2. Setup SSL in Hestia CP (Let's Encrypt)"
echo "  3. Login to https://$DOMAIN"
echo ""
echo "🔧 Useful commands:"
echo "  sudo su - $USER"
echo "  pm2 list                    - View running processes"
echo "  pm2 logs link-rotator      - View application logs"
echo "  pm2 restart link-rotator   - Restart application"
echo "  pm2 stop link-rotator      - Stop application"
echo ""
echo "📁 Project location: $PROJECT_PATH"
echo ""
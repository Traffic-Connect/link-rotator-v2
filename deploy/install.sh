#!/bin/bash

set -e

echo "======================================"
echo "Link Rotator - Production Setup"
echo "======================================"
echo ""

if [ "$EUID" -ne 0 ]; then
   echo "❌ Please run as root (sudo bash install.sh)"
   exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_PATH="$(dirname "$SCRIPT_DIR")"

if [[ "$PROJECT_PATH" =~ ^/home/([^/]+)/web/([^/]+)/public_html$ ]]; then
    USER="${BASH_REMATCH[1]}"
    DOMAIN="${BASH_REMATCH[2]}"
else
    echo "❌ Cannot determine USER and DOMAIN from path: $PROJECT_PATH"
    echo "Expected format: /home/USER/web/DOMAIN/public_html"
    exit 1
fi

ADMIN_EMAIL="adminseo@trafficconnect.com"
JWT_SECRET=$(openssl rand -base64 32)

echo "Auto-detected configuration:"
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

apt-get update

if ! command -v node &> /dev/null; then
    echo "Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
else
    echo "✅ Node.js already installed: $(node -v)"
fi

if ! command -v mongod &> /dev/null; then
    echo "Installing MongoDB 7.0..."

    curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor

    echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | tee /etc/apt/sources.list.d/mongodb-org-7.0.list

    apt-get update
    apt-get install -y mongodb-org

    systemctl start mongod
    systemctl enable mongod

    echo "✅ MongoDB installed and started"
else
    echo "✅ MongoDB already installed"
fi

if ! command -v redis-server &> /dev/null; then
    echo "Installing Redis..."
    apt-get install -y redis-server

    sed -i 's/^supervised no/supervised systemd/' /etc/redis/redis.conf
    sed -i 's/^# maxmemory <bytes>/maxmemory 256mb/' /etc/redis/redis.conf
    sed -i 's/^# maxmemory-policy noeviction/maxmemory-policy allkeys-lru/' /etc/redis/redis.conf

    systemctl restart redis-server
    systemctl enable redis-server

    echo "✅ Redis installed and started"
else
    echo "✅ Redis already installed"
fi

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

if [ ! -d "$PROJECT_PATH" ]; then
    echo "❌ Project directory not found at $PROJECT_PATH"
    echo "Please upload your project files to $PROJECT_PATH first"
    exit 1
fi

cd $PROJECT_PATH

chown -R $USER:$USER $PROJECT_PATH

echo ""
echo "======================================"
echo "3. Installing Node.js Dependencies"
echo "======================================"

sudo -u $USER npm install --production

cd frontend
sudo -u $USER npm install --legacy-peer-deps
sudo -u $USER npm run build
cd ..

echo ""
echo "======================================"
echo "4. Configuring Environment"
echo "======================================"

cat > .env << EOF
NODE_ENV=production
PORT=3001
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

if [ ! -f "ecosystem.config.js" ]; then
    cp deploy/ecosystem.config.js ecosystem.config.js
fi

chown $USER:$USER ecosystem.config.js

mkdir -p logs
chown -R $USER:$USER logs

sudo -u $USER pm2 delete link-rotator 2>/dev/null || true

sudo -u $USER pm2 start ecosystem.config.js
sudo -u $USER pm2 save

echo "✅ Application started with PM2"

echo ""
echo "======================================"
echo "7. Configuring Nginx"
echo "======================================"

SERVER_IP=$(hostname -I | awk '{print $1}')

NGINX_CONF="/home/$USER/conf/web/$DOMAIN/nginx.conf"

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

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location ~* ^.+\.(jpeg|jpg|png|webp|gif|bmp|ico|svg|css|js|woff|woff2|ttf|eot)$ {
        expires max;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location /health {
        proxy_pass http://127.0.0.1:3001;
        access_log off;
    }

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
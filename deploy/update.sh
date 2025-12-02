#!/bin/bash

set -e

echo "======================================"
echo "Link Rotator - Update"
echo "======================================"
echo ""

if [ "$EUID" -ne 0 ]; then
   echo "❌ Please run as root (sudo bash update.sh)"
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

echo "Auto-detected configuration:"
echo "  Domain: $DOMAIN"
echo "  User: $USER"
echo "  Path: $PROJECT_PATH"
echo ""
read -p "Continue? (y/n): " CONTINUE

if [ "$CONTINUE" != "y" ]; then
    echo "Update cancelled"
    exit 0
fi

cd $PROJECT_PATH

echo ""
echo "======================================"
echo "1. Creating Backup"
echo "======================================"

BACKUP_DIR="/home/$USER/backups/link-rotator-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

cp -r frontend/dist "$BACKUP_DIR/" 2>/dev/null || echo "⚠️  No previous build to backup"
cp .env "$BACKUP_DIR/" 2>/dev/null || echo "⚠️  No .env to backup"
cp package.json "$BACKUP_DIR/" 2>/dev/null
cp package-lock.json "$BACKUP_DIR/" 2>/dev/null
cp ecosystem.config.js "$BACKUP_DIR/" 2>/dev/null

echo "✅ Backup created at $BACKUP_DIR"

echo ""
echo "======================================"
echo "2. Stopping Application"
echo "======================================"

sudo -u $USER pm2 stop link-rotator 2>/dev/null || echo "⚠️  Application not running"

echo ""
echo "======================================"
echo "3. Fixing Permissions"
echo "======================================"

echo "Setting correct ownership..."
chown -R $USER:$USER $PROJECT_PATH

echo ""
echo "======================================"
echo "4. Updating Code"
echo "======================================"

if [ -d ".git" ]; then
    echo "Pulling from Git..."
    sudo -u $USER git pull origin main
else
    echo "⚠️  Not a Git repository"
    echo "Make sure you uploaded the latest code to $PROJECT_PATH"
    read -p "Press Enter to continue..."
fi

echo ""
echo "======================================"
echo "5. Installing Backend Dependencies"
echo "======================================"

sudo -u $USER npm install --production

echo ""
echo "======================================"
echo "6. Building Frontend"
echo "======================================"

cd frontend

if [ -f "$BACKUP_DIR/package.json" ]; then
    if ! diff -q package.json "$BACKUP_DIR/package.json" > /dev/null 2>&1; then
        echo "📦 Frontend dependencies changed, updating..."
        sudo -u $USER npm install --legacy-peer-deps
    else
        echo "✅ Frontend dependencies unchanged"
    fi
else
    sudo -u $USER npm install --legacy-peer-deps
fi

echo "Building Vue.js application..."
sudo -u $USER npm run build

cd ..

echo ""
echo "======================================"
echo "7. Checking Environment"
echo "======================================"

if [ -f ".env" ]; then
    echo "✅ .env file exists"
else
    echo "⚠️  Warning: .env file not found!"
fi

echo ""
echo "======================================"
echo "8. Restarting Application"
echo "======================================"

sudo -u $USER pm2 restart link-rotator 2>/dev/null || sudo -u $USER pm2 start ecosystem.config.js
sudo -u $USER pm2 save

echo "Waiting for application to start..."
sleep 5

if sudo -u $USER pm2 list | grep -q "link-rotator.*online"; then
    echo "✅ Application restarted successfully"
    echo ""
    sudo -u $USER pm2 list | grep link-rotator
else
    echo "⚠️  Warning: Application might not be running properly"
    echo ""
    echo "Check logs with: sudo su - $USER -c 'pm2 logs link-rotator'"
    echo "Or restore backup from: $BACKUP_DIR"
fi

echo ""
echo "======================================"
echo "9. Testing Application"
echo "======================================"

echo "Testing health endpoint..."
sleep 2

if curl -s http://127.0.0.1:3001/health > /dev/null 2>&1; then
    echo "✅ Application health check passed"
else
    echo "⚠️  Health check failed"
    echo "Check logs: sudo su - $USER -c 'pm2 logs link-rotator'"
fi

echo ""
echo "======================================"
echo "✅ Update Complete!"
echo "======================================"
echo ""
echo "📋 Summary:"
echo "  Domain: https://$DOMAIN"
echo "  Status: $(sudo -u $USER pm2 list | grep link-rotator | awk '{print $10}')"
echo "  Backup: $BACKUP_DIR"
echo ""
echo "🔧 Useful commands:"
echo "  sudo su - $USER"
echo "  pm2 list                    - View running processes"
echo "  pm2 logs link-rotator      - View application logs"
echo "  pm2 restart link-rotator   - Restart application"
echo "  pm2 monit                   - Monitor resources"
echo ""
echo "🔄 Rollback (if needed):"
echo "  1. sudo su - $USER"
echo "  2. pm2 stop link-rotator"
echo "  3. cp -r $BACKUP_DIR/dist $PROJECT_PATH/frontend/"
echo "  4. pm2 restart link-rotator"
echo ""
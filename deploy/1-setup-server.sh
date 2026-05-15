#!/bin/bash
# Запускать на сервере после SSH-входа
# Скопируй и вставь целиком в терминал

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  DobroPost AI — Настройка сервера"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Система ───────────────────────────────
echo "📦 Обновляю систему..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

# ── Node.js 20 ────────────────────────────
echo "📦 Устанавливаю Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null
apt-get install -y nodejs > /dev/null
echo "   Node: $(node -v) | NPM: $(npm -v)"

# ── PM2 ──────────────────────────────────
echo "📦 Устанавливаю PM2..."
npm install -g pm2 --silent
pm2 startup systemd -u root --hp /root > /dev/null

# ── Google Chrome ─────────────────────────
echo "🌐 Устанавливаю Google Chrome..."
wget -q -O /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
apt-get install -y /tmp/google-chrome.deb > /dev/null 2>&1 || true
apt-get install -f -y > /dev/null 2>&1
rm /tmp/google-chrome.deb
echo "   Chrome: $(google-chrome --version 2>/dev/null || echo 'установлен')"

# ── Зависимости Puppeteer ─────────────────
apt-get install -y \
  libgbm1 libxss1 libasound2 \
  libatk-bridge2.0-0 libgtk-3-0 \
  fonts-liberation fonts-noto \
  --no-install-recommends > /dev/null

# ── Nginx ────────────────────────────────
echo "🌐 Устанавливаю Nginx..."
apt-get install -y nginx > /dev/null
systemctl enable nginx

# ── Nginx конфиг ────────────────────────
cat > /etc/nginx/sites-available/dobropost << 'NGINX'
server {
    listen 80 default_server;
    server_name _;

    client_max_body_size 50m;

    # SSE — отключаем буферизацию чтобы события шли в реальном времени
    location /api/tasks/events {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 10s;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/dobropost /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ── Swap (2GB) ────────────────────────────
echo "💾 Создаю swap 2GB..."
if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile > /dev/null
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "   Swap создан"
else
    echo "   Swap уже есть"
fi

# ── Папка проекта ────────────────────────
mkdir -p /opt/dobropost
echo "   Папка /opt/dobropost создана"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Сервер готов!"
echo "   Node:   $(node -v)"
echo "   Chrome: $(google-chrome --version 2>/dev/null)"
echo "   Nginx:  $(nginx -v 2>&1)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "➡️  Следующий шаг: загрузи файлы проекта (скрипт 2-upload.ps1)"

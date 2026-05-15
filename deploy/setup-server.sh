#!/bin/bash
# Запускать на сервере RUVDS (Ubuntu 22.04) от root
# bash setup-server.sh

set -e
echo "🚀 Настройка сервера DobroPost AI..."

# ── Обновление системы ────────────────────────────────────────────────────────
apt-get update -qq && apt-get upgrade -y -qq

# ── Node.js 20 LTS ────────────────────────────────────────────────────────────
echo "📦 Устанавливаю Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# ── PM2 (менеджер процессов) ──────────────────────────────────────────────────
npm install -g pm2

# ── Chromium для Puppeteer ────────────────────────────────────────────────────
echo "🌐 Устанавливаю Chromium..."
apt-get install -y \
  chromium-browser \
  libgbm1 libxss1 libasound2 \
  fonts-liberation fonts-noto-cjk \
  --no-install-recommends

# ── Nginx ─────────────────────────────────────────────────────────────────────
apt-get install -y nginx
systemctl enable nginx

# ── Папка проекта ─────────────────────────────────────────────────────────────
mkdir -p /opt/dobropost
chown $USER:$USER /opt/dobropost 2>/dev/null || true

echo "✅ Сервер готов к деплою!"
echo "   Node: $(node -v)"
echo "   NPM:  $(npm -v)"
echo "   PM2:  $(pm2 -v)"
echo "   Chromium: $(chromium-browser --version 2>/dev/null || chromium --version)"

#!/bin/bash
# Запускать на сервере после загрузки файлов
# SSH → вставь в терминал

set -e
cd /opt/dobropost

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  DobroPost AI — Запуск приложения"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Проверяем .env
if [ ! -f .env ]; then
    echo "❌ Нет файла .env! Создай его:"
    echo "   nano /opt/dobropost/.env"
    exit 1
fi

echo "📦 Устанавливаю зависимости npm..."
npm install --omit=dev --silent

echo "🚀 Запускаю через PM2..."
pm2 delete dobropost-ai 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Запущено!"
echo ""
pm2 status
echo ""
echo "🌐 Дашборд: http://170.168.34.26"
echo "📋 Логи:    pm2 logs dobropost-ai"
echo "♻️  Рестарт: pm2 restart dobropost-ai"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

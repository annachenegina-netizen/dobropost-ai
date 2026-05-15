# Запускать в PowerShell на Windows
# Загружает проект на сервер (без node_modules)

$SERVER = "root@170.168.34.26"
$REMOTE = "/opt/dobropost"
$LOCAL  = "C:\Users\Владислав\Claude-code"

Write-Host "📤 Загружаю проект на сервер..." -ForegroundColor Cyan

# Создаём временную папку без node_modules
$TMP = "$env:TEMP\dobropost-deploy"
if (Test-Path $TMP) { Remove-Item $TMP -Recurse -Force }
New-Item -ItemType Directory -Path $TMP | Out-Null

# Копируем нужные папки
Write-Host "   Копирую файлы..."
Copy-Item "$LOCAL\server"  "$TMP\server"  -Recurse
Copy-Item "$LOCAL\client"  "$TMP\client"  -Recurse
Copy-Item "$LOCAL\package.json"       "$TMP\package.json"
Copy-Item "$LOCAL\package-lock.json"  "$TMP\package-lock.json" -ErrorAction SilentlyContinue
Copy-Item "$LOCAL\deploy\ecosystem.config.js" "$TMP\ecosystem.config.js"

# .env для продакшена (с Linux Chrome)
Copy-Item "$LOCAL\.env.production" "$TMP\.env" -ErrorAction SilentlyContinue

Write-Host "   Загружаю на сервер через SCP..."
scp -o StrictHostKeyChecking=no -r "$TMP\*" "${SERVER}:${REMOTE}/"

Write-Host "✅ Файлы загружены!" -ForegroundColor Green
Write-Host ""
Write-Host "➡️  Теперь SSH на сервер и запусти: bash /opt/dobropost/deploy/3-start.sh" -ForegroundColor Yellow

# Чистим временную папку
Remove-Item $TMP -Recurse -Force

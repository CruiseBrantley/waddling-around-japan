# deploy-server.ps1
# Deploys the itinerary push server to the Raspberry Pi

$PI_USER = "pi"
$PI_HOST = "192.168.50.61"
$DEST_DIR = "~/waddling-push-server"

Write-Host "🚀 Starting deployment to $PI_HOST..." -ForegroundColor Cyan

# 1. Sync files (excluding noise)
Write-Host "📦 Syncing files..." -ForegroundColor Yellow
# On Windows, scp multiple targets in one command can be flaky. Copying individually for reliability.
scp -r server/src "${PI_USER}@${PI_HOST}:${DEST_DIR}/"
scp server/package.json "${PI_USER}@${PI_HOST}:${DEST_DIR}/"
scp server/package-lock.json "${PI_USER}@${PI_HOST}:${DEST_DIR}/"
scp server/tsconfig.json "${PI_USER}@${PI_HOST}:${DEST_DIR}/"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Sync failed!" -ForegroundColor Red
    exit $LASTEXITCODE
}

# 2. Rebuild and Restart on Pi
Write-Host "🔨 Rebuilding and Restarting on Pi..." -ForegroundColor Yellow
# We try to restart, but if it fails (first time), we start it. 
# Finally, we run 'pm2 save' to ensure it survives a system reboot.
ssh "${PI_USER}@${PI_HOST}" "cd $DEST_DIR && npm install --no-audit --no-fund && npm run build && (pm2 restart waddling-push || pm2 start dist/index.js --name waddling-push) && pm2 save"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Remote build/restart failed!" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "✅ Deployment Successful!" -ForegroundColor Green

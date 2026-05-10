# deploy-server.ps1
# Deploys the itinerary push server to the Raspberry Pi

$PI_USER = "pi"
$PI_HOST = "192.168.50.61"
$DEST_DIR = "~/waddling-push-server"

Write-Host "🚀 Starting deployment to $PI_HOST..." -ForegroundColor Cyan

# 1. Sync files (excluding noise)
Write-Host "📦 Syncing files..." -ForegroundColor Yellow
# We use a temporary exclude list for scp-like behavior with robocopy or just explicit scp
# Since we want to be clean, we'll scp the src, package.json, and tsconfig.json
scp -r server/src server/package.json server/package-lock.json server/tsconfig.json "${PI_USER}@${PI_HOST}:${DEST_DIR}/"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Sync failed!" -ForegroundColor Red
    exit $LASTEXITCODE
}

# 2. Rebuild and Restart on Pi
Write-Host "🔨 Rebuilding and Restarting on Pi..." -ForegroundColor Yellow
ssh "${PI_USER}@${PI_HOST}" "cd $DEST_DIR && npm install --no-audit --no-fund && ./node_modules/.bin/tsc && pm2 restart waddling-push"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Remote build/restart failed!" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "✅ Deployment Successful!" -ForegroundColor Green

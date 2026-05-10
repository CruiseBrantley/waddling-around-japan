# deploy.ps1
# Master deployment script for the whole "Waddling Around Japan" system

$VERSION_TYPE = "patch" # Can be "patch", "minor", or "major"

Write-Host "🏷️ Bumping version ($VERSION_TYPE)..." -ForegroundColor Cyan
npm version $VERSION_TYPE --no-git-tag-version

# Get the new version for the message
$NEW_VERSION = (Get-Content package.json | ConvertFrom-Json).version
Write-Host "🚀 Deploying Version $NEW_VERSION" -ForegroundColor Green -FontWeight Bold

# 1. Deploy Backend to Raspberry Pi
Write-Host "📡 Deploying Backend to Raspberry Pi..." -ForegroundColor Yellow
powershell.exe -File .\deploy-server.ps1

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Backend deployment failed!" -ForegroundColor Red
    exit $LASTEXITCODE
}

# 2. Build and Deploy Frontend to Firebase
Write-Host "🎨 Building and Deploying Frontend to Firebase..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Frontend build failed!" -ForegroundColor Red
    exit $LASTEXITCODE
}

npx firebase-tools deploy
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Firebase deployment failed!" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "🎊 All systems deployed successfully! Running version: $NEW_VERSION" -ForegroundColor Green

# deploy.ps1
# Master deployment script for the whole "Waddling Around Japan" system

$VERSION_TYPE = "patch"

Write-Host "Bumping version ($VERSION_TYPE)..."
npm version $VERSION_TYPE --no-git-tag-version

$package = Get-Content package.json | ConvertFrom-Json
$NEW_VERSION = $package.version
Write-Host "Deploying Version $NEW_VERSION"

# 1. Deploy Backend to Raspberry Pi
Write-Host "Deploying Backend to Raspberry Pi..."
powershell.exe -File .\deploy-server.ps1

# 2. Build and Deploy Frontend to Firebase
Write-Host "Building and Deploying Frontend to Firebase..."
npm run build
npx firebase-tools deploy

Write-Host "All systems deployed successfully!"
Write-Host "Version: $NEW_VERSION"

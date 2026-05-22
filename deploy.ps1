#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Unified deployment script for the "Waddling Around Japan" system.
  Allows deploying the backend server, the frontend PWA, or both.
.EXAMPLE
  # Deploy everything:
  .\deploy.ps1
.EXAMPLE
  # Deploy backend only:
  .\deploy.ps1 -Backend
.EXAMPLE
  # Deploy frontend only:
  .\deploy.ps1 -Frontend
#>

param (
    [switch]$Backend,
    [switch]$Frontend,
    [string]$VersionType = "patch",
    [switch]$NoBump,
    [string]$PiHost = "192.168.50.61",
    [string]$PiUser = "pi",
    [string]$DestDir = "~/waddling-push-server",
    [string]$ApiUrl = "https://sirian.ddns.net"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# If neither switch is explicitly provided, default to deploying both
if (-not $Backend -and -not $Frontend) {
    $Backend = $true
    $Frontend = $true
}

$TODAY = (Get-Date -Format 'yyyy-MM-dd')

# 1. Version Bump (if applicable)
if ($Frontend -and -not $NoBump) {
    Write-Host ">>> Bumping version ($VersionType)..." -ForegroundColor Cyan
    # Run npm version locally (does not tag git by default here)
    & npm version $VersionType --no-git-tag-version
    if ($LASTEXITCODE -ne 0) { Write-Host "Version bump failed!" -ForegroundColor Red; exit 1 }
}

$package = Get-Content package.json | ConvertFrom-Json
$NEW_VERSION = $package.version

Write-Host ">>> Starting consolidated deployment for version $NEW_VERSION..." -ForegroundColor Green
Write-Host "Targets: Backend=$Backend, Frontend=$Frontend" -ForegroundColor Cyan

# 2. Deploy Backend to Raspberry Pi
if ($Backend) {
    Write-Host ">>> [BACKEND] Starting deployment to $PiHost..." -ForegroundColor Cyan
    
    # Verify Pi connectivity
    Write-Host "Verifying Pi connectivity..." -ForegroundColor Cyan
    if (Test-Connection -ComputerName $PiHost -Count 1 -Quiet) {
        Write-Host "Pi is reachable over LAN." -ForegroundColor Green
    } else {
        Write-Host "WARNING: Pi host ($PiHost) is not reachable via ping. SSH/SCP might time out." -ForegroundColor Yellow
    }

    Write-Host "[SYNC] Syncing backend files..." -ForegroundColor Yellow
    # Ensure remote directory structure
    & ssh "${PiUser}@${PiHost}" "mkdir -p ${DestDir}/src"
    if ($LASTEXITCODE -ne 0) { Write-Host "Failed to create remote directory!" -ForegroundColor Red; exit 1 }

    & scp server/src/*.ts "${PiUser}@${PiHost}:${DestDir}/src/"
    if ($LASTEXITCODE -ne 0) { Write-Host "Failed to copy source files!" -ForegroundColor Red; exit 1 }

    & scp server/package.json "${PiUser}@${PiHost}:${DestDir}/"
    & scp server/package-lock.json "${PiUser}@${PiHost}:${DestDir}/"
    & scp server/tsconfig.json "${PiUser}@${PiHost}:${DestDir}/"
    if ($LASTEXITCODE -ne 0) { Write-Host "Failed to copy package/tsconfig files!" -ForegroundColor Red; exit 1 }

    Write-Host "[BUILD] Rebuilding and restarting server on Pi..." -ForegroundColor Yellow
    & ssh "${PiUser}@${PiHost}" "cd ${DestDir} && npm install --no-audit --no-fund && npm run build && (pm2 restart waddling-push || pm2 start dist/index.js --name waddling-push) && pm2 save"
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Remote Pi build or PM2 restart failed!" -ForegroundColor Red
        exit $LASTEXITCODE
    }
    
    Write-Host "[SUCCESS] Backend deployed and restarted on Pi!" -ForegroundColor Green
}

# 3. Deploy Frontend to Firebase Hosting
if ($Frontend) {
    Write-Host ">>> [FRONTEND] Starting deployment..." -ForegroundColor Cyan

    # Verify endpoint is online (with retry loop to allow backend boot/init time)
    Write-Host "Checking API endpoint ($ApiUrl)..." -ForegroundColor Cyan
    $maxAttempts = 5
    $attempt = 1
    $success = $false
    while ($attempt -le $maxAttempts -and -not $success) {
        try {
            if ($attempt -gt 1) {
                Write-Host "Retrying check (attempt $attempt of $maxAttempts)..." -ForegroundColor Yellow
            }
            $weatherUri = "${ApiUrl}/weather?region=tokyo`&date=${TODAY}"
            $resp = Invoke-WebRequest -Uri $weatherUri `
                -Headers @{"Bypass-Tunnel-Reminder"="true"; "Accept"="application/json"} `
                -UseBasicParsing -TimeoutSec 5
            
            # Note: We check if status code is 200 OK
            if ($resp.StatusCode -eq 200) {
                Write-Host "API responds OK (HTTP $($resp.StatusCode))" -ForegroundColor Green
                $success = $true
            } else {
                throw "HTTP Status Code $($resp.StatusCode)"
            }
        } catch {
            if ($attempt -lt $maxAttempts) {
                Start-Sleep -Seconds 2
            } else {
                Write-Host "WARNING: API not responding at ${ApiUrl} after $maxAttempts attempts: $_" -ForegroundColor Yellow
                Write-Host "Continuing anyway (could be hairpin NAT or local loopback restrictions)." -ForegroundColor Yellow
            }
        }
        $attempt++
    }


    # Generate untracked api-config.json and update .env falling back cleanly
    Write-Host "Updating local api-config.json..." -ForegroundColor Cyan
    $configPath = "$PSScriptRoot\public\api-config.json"
    $config = "{`n  `"apiUrl`": `"$ApiUrl`"`n}`n"
    [System.IO.File]::WriteAllText($configPath, $config, [System.Text.UTF8Encoding]::new($false))

    Write-Host "Updating .env..." -ForegroundColor Cyan
    $envPath = "$PSScriptRoot\.env"
    if (Test-Path $envPath) {
        $envContent = [System.IO.File]::ReadAllText($envPath, [System.Text.Encoding]::UTF8)
        $envContent = $envContent -replace 'VITE_API_URL=.*(\r?\n|$)', "VITE_API_URL=$ApiUrl`n"
        [System.IO.File]::WriteAllText($envPath, $envContent, [System.Text.UTF8Encoding]::new($false))
    }

    # Compile/Build Frontend
    Write-Host "Building React PWA frontend..." -ForegroundColor Yellow
    & npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Frontend compilation failed!" -ForegroundColor Red
        exit $LASTEXITCODE
    }

    # Upload to Firebase Hosting
    Write-Host "Uploading to Firebase Hosting..." -ForegroundColor Yellow
    & npx -y firebase-tools@latest deploy --only hosting
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Firebase Hosting deploy failed!" -ForegroundColor Red
        exit $LASTEXITCODE
    }

    Write-Host "[SUCCESS] Frontend deployed to https://waddling-around-japan.web.app!" -ForegroundColor Green
}

Write-Host ">>> [FINISHED] All systems updated successfully. Version: $NEW_VERSION" -ForegroundColor Green

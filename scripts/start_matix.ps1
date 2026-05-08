<#
.SYNOPSIS
  Demarre la stack Matix complete (Docker: Postgres + Keycloak / Local: API + Web).

.DESCRIPTION
  - Verifie que Docker Desktop tourne, lance la stack Compose si besoin.
  - Lance API et Web dans des fenetres PowerShell separees (logs visibles).
  - Attend que chaque service soit pret, affiche un recap.

  Postgres + Keycloak tournent en conteneurs Docker (cf. docker-compose.yml).
  API + Web tournent en local (Node) avec hot-reload.

.PARAMETER Mode
  'keycloak' (defaut) : auth reelle via Keycloak (port 8080, Docker).
  'dev' : auth simulee via headers X-Dev-* (Keycloak pas requis cote API).
  Note : Keycloak tourne quand meme dans la stack Docker — c'est gratuit
  niveau ressources et evite de le redemarrer plus tard.

.PARAMETER SkipPreflight
  Skip les verifications pre-flight (Docker daemon, repo, pnpm).

.PARAMETER StopFirst
  Tue les eventuelles instances API/Web deja en cours sur :3000, :3001.

.EXAMPLE
  .\scripts\start_matix.ps1
  Demarre tout en mode keycloak.

.EXAMPLE
  .\scripts\start_matix.ps1 -Mode dev -StopFirst
  Demarre en mode dev apres avoir tue les anciens process API/Web.
#>
[CmdletBinding()]
param(
  [ValidateSet('keycloak', 'dev')]
  [string]$Mode = 'keycloak',
  [switch]$SkipPreflight,
  [switch]$StopFirst
)

$ErrorActionPreference = 'Stop'

# ============================================================================
# Configuration
# ============================================================================
$RepoRoot = 'C:\Mata\Matix2.0'

# Variables transmises a l'API (matchent ce que docker-compose.yml expose)
$PgEnv = @{
  POSTGRES_HOST           = 'localhost'
  POSTGRES_PORT           = '5432'
  POSTGRES_DB             = 'matix'
  POSTGRES_APP_USER       = 'matix_app'
  POSTGRES_APP_PASSWORD   = 'matix_app_dev'
  POSTGRES_ADMIN_USER     = 'matix_admin'
  POSTGRES_ADMIN_PASSWORD = 'matix_admin_dev'
}
$KcEnv = @{
  KEYCLOAK_ISSUER         = 'http://localhost:8080/realms/matix'
  KEYCLOAK_AUDIENCE       = 'matix-api'
  KEYCLOAK_ADMIN_USER     = 'admin'
  KEYCLOAK_ADMIN_PASSWORD = 'admin'
}

# ============================================================================
# Helpers
# ============================================================================
function Write-Section($text) {
  Write-Host ""
  Write-Host ('-' * 70) -ForegroundColor DarkGray
  Write-Host "  $text" -ForegroundColor Cyan
  Write-Host ('-' * 70) -ForegroundColor DarkGray
}

function Write-OK($text)   { Write-Host "  [OK]   $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "  [WARN] $text" -ForegroundColor Yellow }
function Write-Err($text)  { Write-Host "  [FAIL] $text" -ForegroundColor Red }
function Write-Info($text) { Write-Host "  ..     $text" -ForegroundColor Gray }

function Test-PortListening($port) {
  $null -ne (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Stop-Port($port) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Info "Killed PID $($_.OwningProcess) sur :$port"
  }
}

function Wait-ForUrl($url, $name, $timeoutSec = 90) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 | Out-Null
      Write-OK "$name est pret ($url)"
      return $true
    } catch {
      Start-Sleep -Milliseconds 1500
    }
  }
  Write-Err "$name n'a pas repondu dans les ${timeoutSec}s ($url)"
  return $false
}

function Start-InNewWindow($title, $command) {
  $args = @('-NoExit', '-Command', "`$Host.UI.RawUI.WindowTitle = '$title'; $command")
  Start-Process powershell -ArgumentList $args -WindowStyle Normal | Out-Null
}

# Wrapper docker — capture stdout+stderr en strings sans declencher
# NativeCommandError (PowerShell 5.1 wrap stderr en ErrorRecord avec 2>&1,
# ce qui tue le script avec $ErrorActionPreference='Stop').
function Invoke-Docker {
  $savedEAP = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = (& docker @args 2>&1) | ForEach-Object { $_.ToString() }
    return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $output }
  } finally {
    $ErrorActionPreference = $savedEAP
  }
}

function Test-DockerDaemon {
  $r = Invoke-Docker version --format '{{.Server.Version}}'
  return ($r.ExitCode -eq 0)
}

# ============================================================================
# Preflight
# ============================================================================
Write-Host ""
Write-Host "  =================================================================" -ForegroundColor Cyan
Write-Host "                       Matix - Demarrage stack                     " -ForegroundColor Cyan
Write-Host "                       Mode: $Mode                                  " -ForegroundColor Cyan
Write-Host "  =================================================================" -ForegroundColor Cyan

if (-not $SkipPreflight) {
  Write-Section "Pre-flight checks"

  # Docker daemon
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Err "docker introuvable dans le PATH (Docker Desktop non installe ?)"
    exit 1
  }
  if (-not (Test-DockerDaemon)) {
    Write-Err "Docker daemon ne repond pas - lance Docker Desktop et attends que l'icone soit verte."
    exit 1
  }
  Write-OK "Docker daemon"

  # Repo
  if (-not (Test-Path "$RepoRoot\package.json")) {
    Write-Err "Repo introuvable a $RepoRoot"
    exit 1
  }
  Write-OK "Repo Matix ($RepoRoot)"

  # docker-compose.yml
  if (-not (Test-Path "$RepoRoot\docker-compose.yml")) {
    Write-Err "docker-compose.yml introuvable dans $RepoRoot"
    exit 1
  }
  Write-OK "docker-compose.yml"

  # pnpm
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Err "pnpm introuvable dans le PATH"
    exit 1
  }
  Write-OK "pnpm"

  # node_modules
  if (-not (Test-Path "$RepoRoot\node_modules")) {
    Write-Warn "node_modules absent - execute 'pnpm install' dans $RepoRoot"
    exit 1
  }
  Write-OK "node_modules present"
}

# ============================================================================
# Stop existing local processes (API/Web)
# ============================================================================
if ($StopFirst) {
  Write-Section "Stop des instances API/Web existantes"
  Stop-Port 3000
  Stop-Port 3001
  Start-Sleep 2
} else {
  $busy = @()
  if (Test-PortListening 3000) { $busy += '3000' }
  if (Test-PortListening 3001) { $busy += '3001' }
  if ($busy.Count -gt 0) {
    Write-Section "Ports occupes"
    Write-Warn "Ports deja en ecoute : $($busy -join ', ')"
    Write-Info "Relance avec -StopFirst pour les tuer, ou ferme manuellement."
    exit 1
  }
}

# ============================================================================
# Start Docker stack (Postgres + Keycloak)
# ============================================================================
Write-Section "Demarrage stack Docker (Postgres + Keycloak)"
Push-Location $RepoRoot
try {
  $r = Invoke-Docker compose up -d
  if ($r.ExitCode -ne 0) {
    Write-Err "docker compose up a echoue (exit $($r.ExitCode)):"
    $r.Output | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    exit 1
  }
  $r.Output | Where-Object { $_ -match 'Created|Started|Running|Healthy' } | ForEach-Object {
    Write-Info $_.Trim()
  }
} finally {
  Pop-Location
}

# Wait for Postgres healthcheck
Write-Info "Attente du healthcheck Postgres..."
$health = $null
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
  $r = Invoke-Docker inspect --format '{{.State.Health.Status}}' matix-postgres
  $health = if ($r.ExitCode -eq 0) { ($r.Output | Select-Object -First 1).Trim() } else { $null }
  if ($health -eq 'healthy') {
    Write-OK "Postgres est healthy (localhost:5432)"
    break
  }
  Start-Sleep -Milliseconds 1500
}
if ($health -ne 'healthy') {
  Write-Err "Postgres pas healthy dans les 60s — verifie 'docker logs matix-postgres'"
  exit 1
}

# Wait for Keycloak (dev-mem est rapide ~20-30s au premier boot)
if (-not (Wait-ForUrl 'http://localhost:8080/realms/matix' 'Keycloak (realm matix)' 120)) {
  Write-Warn "Keycloak pas pret — il continue de booter en arriere-plan ('docker logs -f matix-keycloak')"
  if ($Mode -eq 'keycloak') {
    Write-Err "Mode keycloak requis mais Keycloak indisponible. Abandon."
    exit 1
  }
}

# ============================================================================
# Start API
# ============================================================================
Write-Section "Demarrage API NestJS (port 3001) en mode '$Mode'"

$apiEnvParts = @()
foreach ($k in $PgEnv.Keys) { $apiEnvParts += "`$env:$k='$($PgEnv[$k])'" }
$apiEnvParts += "`$env:AUTH_MODE='$Mode'"
if ($Mode -eq 'keycloak') {
  foreach ($k in $KcEnv.Keys) { $apiEnvParts += "`$env:$k='$($KcEnv[$k])'" }
}
$apiCmd = ($apiEnvParts -join '; ') + "; cd '$RepoRoot'; pnpm --filter @matix/api dev"
Start-InNewWindow "Matix - API ($Mode)" $apiCmd
Write-Info "Fenetre 'Matix - API ($Mode)' lancee"
if (-not (Wait-ForUrl 'http://localhost:3001/health' 'API' 60)) {
  Write-Err "Abandon - API n'a pas demarre"
  exit 1
}

# Verification readiness (DB + Keycloak)
try {
  $ready = Invoke-RestMethod -Uri 'http://localhost:3001/readyz' -TimeoutSec 5
  if ($ready.status -eq 'ready') {
    $msg = "Readiness : DB $($ready.checks.database.latency_ms)ms"
    if ($ready.checks.keycloak) { $msg += ", Keycloak $($ready.checks.keycloak.latency_ms)ms" }
    Write-OK $msg
  } else {
    Write-Warn "Readiness 'degraded' : $((ConvertTo-Json $ready.checks -Compress))"
  }
} catch {
  Write-Warn "Readiness non joignable : $_"
}

# ============================================================================
# Start Web
# ============================================================================
Write-Section "Demarrage Frontend Next.js (port 3000)"

$webCmd = "cd '$RepoRoot'; pnpm --filter @matix/web dev"
Start-InNewWindow "Matix - Web" $webCmd
Write-Info "Fenetre 'Matix - Web' lancee"
if (-not (Wait-ForUrl 'http://localhost:3000/login' 'Web' 90)) {
  Write-Warn "Web pas encore pret - la premiere compilation Next.js peut etre longue"
}

# ============================================================================
# Recapitulatif
# ============================================================================
Write-Host ""
Write-Host "  =================================================================" -ForegroundColor Green
Write-Host "                          Stack demarree                           " -ForegroundColor Green
Write-Host "  =================================================================" -ForegroundColor Green

Write-Host ""
Write-Host "  SERVICES" -ForegroundColor Cyan
Write-Host "  --------"
$rows = @()
$rows += [pscustomobject]@{ Service = 'Postgres'         ; URL = 'localhost:5432'                            ; Source = 'Docker (matix-postgres)' }
$rows += [pscustomobject]@{ Service = 'Keycloak admin'   ; URL = 'http://localhost:8080/admin'               ; Source = 'Docker (matix-keycloak)' }
$rows += [pscustomobject]@{ Service = 'Keycloak realm'   ; URL = 'http://localhost:8080/realms/matix/account'; Source = 'Docker (matix-keycloak)' }
$rows += [pscustomobject]@{ Service = "API ($Mode)"      ; URL = 'http://localhost:3001'                     ; Source = "Fenetre 'Matix - API ($Mode)'" }
$rows += [pscustomobject]@{ Service = 'API health'       ; URL = 'http://localhost:3001/health'              ; Source = '-' }
$rows += [pscustomobject]@{ Service = 'API readyz'       ; URL = 'http://localhost:3001/readyz'              ; Source = '-' }
$rows += [pscustomobject]@{ Service = 'Frontend (PWA)'   ; URL = 'http://localhost:3000'                     ; Source = "Fenetre 'Matix - Web'" }
$rows | Format-Table -AutoSize

if ($Mode -eq 'keycloak') {
  Write-Host "  COMPTES DE TEST KEYCLOAK" -ForegroundColor Cyan
  Write-Host "  ------------------------"
  Write-Host "  Realm administrateur Keycloak :"
  Write-Host "    URL       : http://localhost:8080/admin" -ForegroundColor Gray
  Write-Host "    Login     : admin / admin" -ForegroundColor Gray
  Write-Host ""
  Write-Host "  Logins Matix (frontend -> /login -> bouton 'Se connecter') :"
  Write-Host ""
  $logins = @(
    [pscustomobject]@{ Email = 'owner@mata-mbao.test'        ; Password = 'Maas2026!'         ; Tenant = 'Mata Mbao'         ; Donnees = '267 produits Maas' }
    [pscustomobject]@{ Email = 'owner@mata-keur-massar.test' ; Password = 'Maas2026!'         ; Tenant = 'Mata Keur Massar'  ; Donnees = '260 produits Maas' }
    [pscustomobject]@{ Email = 'owner@acme.test'             ; Password = 'acme-dev-password' ; Tenant = 'Acme SARL (test)'  ; Donnees = 'donnees seed' }
    [pscustomobject]@{ Email = 'owner@beta.test'             ; Password = 'beta-dev-password' ; Tenant = 'Beta SUARL (test)' ; Donnees = '(vide)' }
    [pscustomobject]@{ Email = 'alice@demo-corp.test'        ; Password = 'DemoPass2026!'     ; Tenant = 'Demo Corp'         ; Donnees = 'demo provisioning' }
  )
  $logins | Format-Table -AutoSize
} else {
  Write-Host "  MODE DEV" -ForegroundColor Cyan
  Write-Host "  --------"
  Write-Host "  Pas de login Keycloak - utilise le dropdown tenant en haut a droite."
  Write-Host "  Tenants disponibles : Acme SARL, Beta SUARL."
  Write-Host ""
}

Write-Host "  COMMANDES UTILES" -ForegroundColor Cyan
Write-Host "  ----------------"
Write-Host "  Logs Postgres      : docker logs -f matix-postgres" -ForegroundColor Gray
Write-Host "  Logs Keycloak      : docker logs -f matix-keycloak" -ForegroundColor Gray
Write-Host "  Logs API           : voir la fenetre 'Matix - API ($Mode)'" -ForegroundColor Gray
Write-Host "  Logs Web           : voir la fenetre 'Matix - Web'" -ForegroundColor Gray
Write-Host "  Tests anti-fuite   : cd $RepoRoot ; `$env:AUTH_MODE='dev' ; pnpm --filter @matix/api test:e2e" -ForegroundColor Gray
Write-Host "  Stop tout          : .\scripts\stop_matix.ps1" -ForegroundColor Gray
Write-Host "  Stop API/Web seul. : .\scripts\stop_matix.ps1 -KeepDocker" -ForegroundColor Gray
Write-Host ""

Write-Host "  ASTUCE" -ForegroundColor Cyan
Write-Host "  ------"
Write-Host "  Ouvre http://localhost:3000 en navigation privee pour bypasser les"
Write-Host "  cookies de session existants et voir l'ecran de login."
Write-Host ""

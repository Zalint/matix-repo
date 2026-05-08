<#
.SYNOPSIS
  Démarre la stack Matix complète (Postgres + Keycloak + API + Web) en local.

.DESCRIPTION
  Lance les services dans des fenêtres PowerShell séparées et attend qu'ils
  soient prêts. Affiche un récapitulatif des URLs et des comptes de test.

.PARAMETER Mode
  'keycloak' (défaut) : auth réelle via Keycloak. 'dev' : skip Keycloak,
  utilise les headers X-Dev-* (frontend a un dropdown tenant switcher).

.PARAMETER SkipPreflight
  Skip les vérifications pré-flight (Postgres, JDK, Keycloak).

.PARAMETER StopFirst
  Tue les éventuelles instances déjà en cours sur :3000, :3001, :8180.

.EXAMPLE
  .\scripts\start_matix.ps1
  Démarre tout en mode keycloak.

.EXAMPLE
  .\scripts\start_matix.ps1 -Mode dev -StopFirst
  Démarre en mode dev (sans Keycloak) après avoir tué les anciens processus.
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
# Configuration (adapte si tes chemins diffèrent)
# ============================================================================
$RepoRoot      = 'C:\Mata\Matix2.0'
$JdkPath       = 'C:\Users\douco\AppData\Local\Programs\Microsoft\jdk-17.0.10.7-hotspot'
$KeycloakHome  = 'C:\Users\douco\keycloak\keycloak-25.0.6'
$PsqlPath      = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'

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
  KEYCLOAK_ISSUER          = 'http://localhost:8180/realms/matix'
  KEYCLOAK_AUDIENCE        = 'matix-api'
  KEYCLOAK_ADMIN_USER      = 'admin'
  KEYCLOAK_ADMIN_PASSWORD  = 'admin'
}

# ============================================================================
# Helpers
# ============================================================================
function Write-Section($text) {
  Write-Host ""
  Write-Host ("─" * 70) -ForegroundColor DarkGray
  Write-Host "  $text" -ForegroundColor Cyan
  Write-Host ("─" * 70) -ForegroundColor DarkGray
}

function Write-OK($text)    { Write-Host "  ✓ $text" -ForegroundColor Green }
function Write-Warn($text)  { Write-Host "  ⚠ $text" -ForegroundColor Yellow }
function Write-Err($text)   { Write-Host "  ✗ $text" -ForegroundColor Red }
function Write-Info($text)  { Write-Host "  → $text" -ForegroundColor Gray }

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
      Write-OK "$name est prêt ($url)"
      return $true
    } catch {
      Start-Sleep -Milliseconds 1500
    }
  }
  Write-Err "$name n'a pas répondu dans les ${timeoutSec}s ($url)"
  return $false
}

function Start-InNewWindow($title, $command) {
  $args = @('-NoExit', '-Command', "`$Host.UI.RawUI.WindowTitle = '$title'; $command")
  Start-Process powershell -ArgumentList $args -WindowStyle Normal | Out-Null
}

# ============================================================================
# Preflight
# ============================================================================
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║                    Matix — Démarrage stack                       ║" -ForegroundColor Cyan
Write-Host "  ║                       Mode: $($Mode.PadRight(38))║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

if (-not $SkipPreflight) {
  Write-Section "Pré-flight checks"

  # Postgres
  $pgService = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Where-Object Status -eq 'Running' | Select-Object -First 1
  if (-not $pgService) {
    Write-Err "Postgres ne tourne pas. Démarre le service 'postgresql-x64-17'."
    exit 1
  }
  Write-OK "Postgres ($($pgService.Name))"

  if (-not (Test-Path $PsqlPath)) { Write-Err "psql introuvable à $PsqlPath"; exit 1 }
  Write-OK "psql"

  # Repo
  if (-not (Test-Path "$RepoRoot\package.json")) {
    Write-Err "Repo introuvable à $RepoRoot"
    exit 1
  }
  Write-OK "Repo Matix ($RepoRoot)"

  # pnpm
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Err "pnpm introuvable dans le PATH"
    exit 1
  }
  Write-OK "pnpm"

  # node_modules
  if (-not (Test-Path "$RepoRoot\node_modules")) {
    Write-Warn "node_modules absent — exécute 'pnpm install' dans $RepoRoot"
    exit 1
  }
  Write-OK "node_modules présent"

  # Keycloak / JDK (uniquement si mode keycloak)
  if ($Mode -eq 'keycloak') {
    if (-not (Test-Path "$JdkPath\bin\java.exe")) {
      Write-Err "JDK 17 introuvable à $JdkPath"
      exit 1
    }
    Write-OK "JDK 17"

    if (-not (Test-Path "$KeycloakHome\bin\kc.bat")) {
      Write-Err "Keycloak introuvable à $KeycloakHome"
      exit 1
    }
    Write-OK "Keycloak 25"
  }
}

# ============================================================================
# Stop existing
# ============================================================================
if ($StopFirst) {
  Write-Section "Stop des instances existantes"
  Stop-Port 3000
  Stop-Port 3001
  if ($Mode -eq 'keycloak') { Stop-Port 8180 }
  Start-Sleep 2
} else {
  $busy = @()
  if (Test-PortListening 3000) { $busy += '3000' }
  if (Test-PortListening 3001) { $busy += '3001' }
  if ($Mode -eq 'keycloak' -and (Test-PortListening 8180)) { $busy += '8180' }
  if ($busy.Count -gt 0) {
    Write-Section "Ports occupés"
    Write-Warn "Ports déjà en écoute : $($busy -join ', ')"
    Write-Info "Relance avec -StopFirst pour les tuer, ou ferme manuellement."
    exit 1
  }
}

# ============================================================================
# Start Keycloak
# ============================================================================
if ($Mode -eq 'keycloak') {
  Write-Section "Démarrage Keycloak (port 8180)"
  $kcCmd = @"
`$env:JAVA_HOME = '$JdkPath'
`$env:PATH = "`$env:JAVA_HOME\bin;`$env:PATH"
`$env:KEYCLOAK_ADMIN = 'admin'
`$env:KEYCLOAK_ADMIN_PASSWORD = 'admin'
cd '$KeycloakHome'
.\bin\kc.bat start-dev --http-port=8180
"@
  Start-InNewWindow "Matix · Keycloak" $kcCmd
  Write-Info "Fenêtre 'Matix · Keycloak' lancée"
  if (-not (Wait-ForUrl 'http://localhost:8180/realms/master' 'Keycloak' 120)) {
    Write-Err "Abandon — Keycloak n'a pas démarré"
    exit 1
  }
}

# ============================================================================
# Start API
# ============================================================================
Write-Section "Démarrage API NestJS (port 3001) en mode '$Mode'"

$apiEnvLines = @()
foreach ($k in $PgEnv.Keys) { $apiEnvLines += "`$env:$k = '$($PgEnv[$k])'" }
$apiEnvLines += "`$env:AUTH_MODE = '$Mode'"
if ($Mode -eq 'keycloak') {
  foreach ($k in $KcEnv.Keys) { $apiEnvLines += "`$env:$k = '$($KcEnv[$k])'" }
}

$apiCmd = @"
$($apiEnvLines -join "`n")
cd '$RepoRoot'
pnpm --filter @matix/api dev
"@
Start-InNewWindow "Matix · API ($Mode)" $apiCmd
Write-Info "Fenêtre 'Matix · API ($Mode)' lancée"
if (-not (Wait-ForUrl 'http://localhost:3001/health' 'API' 60)) {
  Write-Err "Abandon — API n'a pas démarré"
  exit 1
}

# Vérification readiness (DB + Keycloak)
try {
  $ready = Invoke-RestMethod -Uri 'http://localhost:3001/readyz' -TimeoutSec 5
  if ($ready.status -eq 'ready') {
    Write-OK "Readiness : DB $($ready.checks.database.latency_ms)ms" + $(if ($ready.checks.keycloak) { ", Keycloak $($ready.checks.keycloak.latency_ms)ms" } else { "" })
  } else {
    Write-Warn "Readiness 'degraded' : $((ConvertTo-Json $ready.checks -Compress))"
  }
} catch {
  Write-Warn "Readiness non joignable : $_"
}

# ============================================================================
# Start Web
# ============================================================================
Write-Section "Démarrage Frontend Next.js (port 3000)"

$webCmd = @"
cd '$RepoRoot'
pnpm --filter @matix/web dev
"@
Start-InNewWindow "Matix · Web" $webCmd
Write-Info "Fenêtre 'Matix · Web' lancée"
if (-not (Wait-ForUrl 'http://localhost:3000/login' 'Web' 90)) {
  Write-Warn "Web pas encore prêt — la première compilation Next.js peut être longue"
}

# ============================================================================
# Récapitulatif
# ============================================================================
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║                       Stack démarrée                             ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════════════════════════════╝" -ForegroundColor Green

Write-Host ""
Write-Host "  SERVICES" -ForegroundColor Cyan
Write-Host "  ────────"
$rows = @()
$rows += [pscustomobject]@{ Service = 'Postgres'; URL = 'localhost:5432'; Fenêtre = 'Service Windows' }
if ($Mode -eq 'keycloak') {
  $rows += [pscustomobject]@{ Service = 'Keycloak (admin)'; URL = 'http://localhost:8180/admin'; Fenêtre = 'Matix · Keycloak' }
  $rows += [pscustomobject]@{ Service = 'Keycloak (realm matix)'; URL = 'http://localhost:8180/realms/matix/account'; Fenêtre = 'Matix · Keycloak' }
}
$rows += [pscustomobject]@{ Service = "API NestJS ($Mode)"; URL = 'http://localhost:3001'; Fenêtre = "Matix · API ($Mode)" }
$rows += [pscustomobject]@{ Service = 'API health'; URL = 'http://localhost:3001/health'; Fenêtre = '—' }
$rows += [pscustomobject]@{ Service = 'API readyz'; URL = 'http://localhost:3001/readyz'; Fenêtre = '—' }
$rows += [pscustomobject]@{ Service = 'Frontend (PWA)'; URL = 'http://localhost:3000'; Fenêtre = 'Matix · Web' }
$rows | Format-Table -AutoSize

if ($Mode -eq 'keycloak') {
  Write-Host "  COMPTES DE TEST KEYCLOAK" -ForegroundColor Cyan
  Write-Host "  ────────────────────────"
  Write-Host "  Réalisme administrateur Keycloak :"
  Write-Host "    URL       : http://localhost:8180/admin" -ForegroundColor Gray
  Write-Host "    Login     : admin / admin" -ForegroundColor Gray
  Write-Host ""
  Write-Host "  Logins Matix (frontend → /login → bouton 'Se connecter') :"
  Write-Host ""
  $logins = @(
    [pscustomobject]@{ Email = 'owner@mata-mbao.test'         ; Password = 'Maas2026!'           ; Tenant = 'Mata Mbao'         ; Données = '267 produits Maas' }
    [pscustomobject]@{ Email = 'owner@mata-keur-massar.test'  ; Password = 'Maas2026!'           ; Tenant = 'Mata Keur Massar'  ; Données = '260 produits Maas' }
    [pscustomobject]@{ Email = 'owner@acme.test'              ; Password = 'acme-dev-password'   ; Tenant = 'Acme SARL (test)'  ; Données = 'données seed' }
    [pscustomobject]@{ Email = 'owner@beta.test'              ; Password = 'beta-dev-password'   ; Tenant = 'Beta SUARL (test)' ; Données = '(vide)' }
    [pscustomobject]@{ Email = 'alice@demo-corp.test'         ; Password = 'DemoPass2026!'       ; Tenant = 'Demo Corp'         ; Données = 'demo provisioning' }
  )
  $logins | Format-Table -AutoSize
} else {
  Write-Host "  MODE DEV" -ForegroundColor Cyan
  Write-Host "  ────────"
  Write-Host "  Pas de login Keycloak — utilise le dropdown tenant en haut à droite."
  Write-Host "  Tenants disponibles : Acme SARL, Beta SUARL."
  Write-Host ""
}

Write-Host "  COMMANDES UTILES" -ForegroundColor Cyan
Write-Host "  ────────────────"
Write-Host "  Tests anti-fuite   : cd $RepoRoot ; `$env:AUTH_MODE='dev' ; pnpm --filter @matix/api test:e2e" -ForegroundColor Gray
Write-Host "  Suivre log API     : voir la fenêtre 'Matix · API ($Mode)'" -ForegroundColor Gray
Write-Host "  Stop tout          : .\scripts\stop_matix.ps1   (ou ferme les 3 fenêtres)" -ForegroundColor Gray
Write-Host "  Reset complet      : voir infra/keycloak/README.md" -ForegroundColor Gray
Write-Host ""

Write-Host "  ASTUCE" -ForegroundColor Cyan
Write-Host "  ──────"
Write-Host "  Ouvre http://localhost:3000 en navigation privée pour bypasser les"
Write-Host "  cookies de session existants et voir l'écran de login."
Write-Host ""

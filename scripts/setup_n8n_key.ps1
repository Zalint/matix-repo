<#
.SYNOPSIS
  Guide la creation d'une API key n8n et l'ecrit dans apps/api/.env.

.DESCRIPTION
  - Verifie que n8n est UP sur http://localhost:5678
  - Affiche les etapes pour creer la cle (UI n8n)
  - Ouvre n8n dans le navigateur a la bonne page
  - Prompt l'utilisateur pour coller la cle
  - Ecrit/append N8N_URL et N8N_API_KEY dans apps/api/.env
  - Aussi MATIX_SERVICE_TOKEN (genere automatiquement, 32 bytes random)
  - Confirme avec un test API n8n

.EXAMPLE
  .\scripts\setup_n8n_key.ps1
  Lance l'assistant interactif.

.EXAMPLE
  .\scripts\setup_n8n_key.ps1 -ApiKey "n8n_api_xxx..."
  Si tu as deja la cle, la passe directement (skip le prompt).
#>
[CmdletBinding()]
param(
  [string]$ApiKey,
  [string]$EnvFile = 'C:\Mata\Matix2.0\apps\api\.env'
)

$ErrorActionPreference = 'Stop'

function Write-Section($text) {
  Write-Host ""
  Write-Host ('-' * 70) -ForegroundColor DarkGray
  Write-Host "  $text" -ForegroundColor Cyan
  Write-Host ('-' * 70) -ForegroundColor DarkGray
}
function Write-OK($text)   { Write-Host "  [OK]   $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "  [WARN] $text" -ForegroundColor Yellow }
function Write-Err($text)  { Write-Host "  [FAIL] $text" -ForegroundColor Red }

Write-Host ""
Write-Host "  =================================================================" -ForegroundColor Cyan
Write-Host "                   Matix - Setup N8N API Key                       " -ForegroundColor Cyan
Write-Host "  =================================================================" -ForegroundColor Cyan

# 1. Check n8n UP
Write-Section "Verification n8n"
try {
  $r = Invoke-WebRequest -Uri "http://localhost:5678/healthz" -UseBasicParsing -TimeoutSec 5
  if ($r.StatusCode -eq 200) {
    Write-OK "n8n est UP (http://localhost:5678)"
  } else {
    Write-Err "n8n a repondu HTTP $($r.StatusCode)"
    exit 1
  }
} catch {
  Write-Err "n8n ne repond pas. Demarre-le avec : .\scripts\start_matix.ps1"
  exit 1
}

# 2. Recuperer la cle
if (-not $ApiKey) {
  Write-Section "Generation de la cle dans n8n"
  Write-Host "  Suis ces etapes (j'ouvre n8n pour toi) :" -ForegroundColor Gray
  Write-Host ""
  Write-Host "    1. Login avec ton compte owner (email/password)" -ForegroundColor Gray
  Write-Host "    2. Click sur ton avatar (haut droite) -> Settings" -ForegroundColor Gray
  Write-Host "    3. Onglet 'n8n API' (sidebar gauche)" -ForegroundColor Gray
  Write-Host "    4. Click 'Create an API Key'" -ForegroundColor Gray
  Write-Host "    5. Label : matix-api-dev | Expiration : Never (en dev)" -ForegroundColor Gray
  Write-Host "    6. Click Save -> COPIE le token affiche (tu ne le reverras pas)" -ForegroundColor Gray
  Write-Host "    7. Reviens ici et colle le token" -ForegroundColor Gray
  Write-Host ""
  Write-Host "  Ouverture de n8n dans le navigateur..." -ForegroundColor Gray
  Start-Process "http://localhost:5678/settings/api"
  Write-Host ""
  $ApiKey = Read-Host "Colle ta N8N_API_KEY ici"
  if (-not $ApiKey -or $ApiKey.Length -lt 20) {
    Write-Err "Cle vide ou trop courte. Abandon."
    exit 1
  }
}

# 3. Test rapide de la cle
Write-Section "Test de la cle"
try {
  $headers = @{
    'X-N8N-API-KEY' = $ApiKey
    'Accept' = 'application/json'
  }
  $resp = Invoke-WebRequest -Uri "http://localhost:5678/api/v1/workflows" -Headers $headers -UseBasicParsing -TimeoutSec 5
  if ($resp.StatusCode -eq 200) {
    $data = $resp.Content | ConvertFrom-Json
    $count = if ($data.data) { $data.data.Count } else { 0 }
    Write-OK "Cle valide. n8n a $count workflows."
  } else {
    Write-Warn "Reponse HTTP $($resp.StatusCode) - cle peut-etre invalide ?"
  }
} catch {
  Write-Err "La cle ne marche pas. Erreur : $($_.Exception.Message)"
  Write-Warn "Verifie que tu l'as bien copiee. Pas de retour a la ligne."
  exit 1
}

# 4. Generer un MATIX_SERVICE_TOKEN si pas deja present
Write-Section "Generation du MATIX_SERVICE_TOKEN"
# Syntaxe compatible PowerShell 5.1 ET 7+ (la methode statique GetBytes() requiert PS 7+).
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = [byte[]]::new(32)
$rng.GetBytes($bytes)
$serviceToken = [Convert]::ToBase64String($bytes)
$rng.Dispose()
Write-OK "Token genere (32 bytes random base64)"

# 5. Ecrire dans .env
Write-Section "Mise a jour de $EnvFile"

# Cree le fichier s'il n'existe pas
if (-not (Test-Path $EnvFile)) {
  New-Item -Path $EnvFile -ItemType File -Force | Out-Null
  Write-OK "Cree : $EnvFile"
}

$content = if (Test-Path $EnvFile) { Get-Content $EnvFile -Raw } else { '' }
if ($null -eq $content) { $content = '' }

# Helper : remplace une variable existante OU append
function Set-EnvVar {
  param([string]$Name, [string]$Value)

  $script:content = $script:content -replace "(?m)^\s*#?\s*$Name\s*=.*$", ''
  # Trim multiple newlines
  $script:content = $script:content -replace "(?m)\r?\n\r?\n+", "`r`n"
  if (-not $script:content.EndsWith("`n") -and $script:content.Length -gt 0) {
    $script:content += "`r`n"
  }
  $script:content += "$Name=$Value`r`n"
}

Set-EnvVar -Name 'N8N_URL' -Value 'http://localhost:5678'
Set-EnvVar -Name 'N8N_API_KEY' -Value $ApiKey

# Set MATIX_SERVICE_TOKEN seulement si pas deja present (preserve ancien token)
if ($content -notmatch '(?m)^\s*MATIX_SERVICE_TOKEN\s*=\s*\S') {
  Set-EnvVar -Name 'MATIX_SERVICE_TOKEN' -Value $serviceToken
  Write-OK "MATIX_SERVICE_TOKEN ajoute (nouveau)"
} else {
  Write-OK "MATIX_SERVICE_TOKEN deja present (preserve)"
}

# Set WORKFLOWS_CRON_ENABLED a 0 par defaut (opt-in)
if ($content -notmatch '(?m)^\s*WORKFLOWS_CRON_ENABLED\s*=') {
  Set-EnvVar -Name 'WORKFLOWS_CRON_ENABLED' -Value '0'
}

# Trim final
$content = $content.TrimStart()
Set-Content -Path $EnvFile -Value $content -NoNewline -Encoding UTF8

Write-OK "$EnvFile mis a jour"

# 6. Recap
Write-Section "Termine"
Write-Host "  Variables ecrites dans apps/api/.env :" -ForegroundColor Gray
Write-Host "    N8N_URL                   = http://localhost:5678" -ForegroundColor Gray
Write-Host "    N8N_API_KEY               = $($ApiKey.Substring(0, [Math]::Min(20, $ApiKey.Length)))..." -ForegroundColor Gray
Write-Host "    MATIX_SERVICE_TOKEN       = (32 bytes random)" -ForegroundColor Gray
Write-Host "    WORKFLOWS_CRON_ENABLED    = 0  (opt-in, change en 1 pour activer)" -ForegroundColor Gray
Write-Host ""
Write-Host "  Pour activer dans l'API NestJS :" -ForegroundColor Yellow
Write-Host "    1. Si l'API tourne deja, redemarre-la (ferme la fenetre puis relance start_matix)" -ForegroundColor Gray
Write-Host "    2. Sinon : .\scripts\start_matix.ps1" -ForegroundColor Gray
Write-Host ""
Write-Host "  L'API va lire le .env au boot et connecter le N8nClientService." -ForegroundColor Gray
Write-Host ""

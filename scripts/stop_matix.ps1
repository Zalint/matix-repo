<#
.SYNOPSIS
  Arrete la stack Matix locale : API + Web (process Node) + tous les conteneurs
  Docker (Postgres + Keycloak + extras n8n/Redis/MailHog s'ils tournent).

.PARAMETER KeepDocker
  Stop uniquement les process API/Web, laisse la stack Docker tourner.
  Utile pour redemarrer rapidement l'API apres une grosse modif sans
  reattendre Keycloak.

.PARAMETER Down
  Equivalent a 'docker compose down' apres l'arret des process Node :
  retire les conteneurs (mais garde les volumes / les donnees).

.PARAMETER WipeData
  ATTENTION : 'docker compose down -v' = supprime aussi les volumes,
  donc la DB Postgres et l'etat Keycloak. A reserver aux resets propres.

.EXAMPLE
  .\scripts\stop_matix.ps1
  Stop API + Web + tous les conteneurs Docker (incluant extras
  n8n/Redis/MailHog s'ils tournent). Conteneurs + volumes preserves.

.EXAMPLE
  .\scripts\stop_matix.ps1 -KeepDocker
  Stop uniquement API + Web. La stack Docker entiere (Postgres + Keycloak
  + n8n + extras) continue de tourner.

.EXAMPLE
  .\scripts\stop_matix.ps1 -WipeData
  Reset complet : tue tout + supprime conteneurs ET volumes Docker
  (perd la DB, Keycloak, n8n workflows).
#>
[CmdletBinding()]
param(
  [switch]$KeepDocker,
  [switch]$Down,
  [switch]$WipeData
)

$ErrorActionPreference = 'Continue'
$RepoRoot = 'C:\Mata\Matix2.0'

# Wrapper docker — capture stdout+stderr en strings sans declencher
# NativeCommandError (PowerShell 5.1 wrap stderr en ErrorRecord avec 2>&1).
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

function Stop-Port($port, $name) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if (-not $conns) {
    Write-Host "  ..   $name (:$port) - deja arrete" -ForegroundColor DarkGray
    return
  }
  foreach ($c in $conns) {
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Host "  [OK] $name (:$port, PID $($c.OwningProcess)) arrete" -ForegroundColor Green
  }
}

Write-Host ""
Write-Host "  Arret de la stack Matix" -ForegroundColor Cyan
Write-Host "  -----------------------"

# 1. Stop process Node (API + Web)
Stop-Port 3000 'Web Next.js'
Stop-Port 3001 'API NestJS'

# 2. Stop / Down de la stack Docker
if ($KeepDocker) {
  Write-Host ""
  Write-Host "  Stack Docker laissee active (Postgres + Keycloak + extras n8n/Redis/MailHog si UP)." -ForegroundColor DarkGray
} else {
  Write-Host ""
  Push-Location $RepoRoot
  try {
    # --profile extras est passe a 'down' pour cibler aussi les conteneurs
    # n8n/Redis/MailHog s'ils existent (sinon ils resteraient orphelins).
    # 'stop' n'en a pas besoin: il stoppe tous les conteneurs running du projet.
    if ($WipeData) {
      Write-Host "  [!] Reset complet : suppression conteneurs + volumes (donnees perdues)..." -ForegroundColor Yellow
      $r = Invoke-Docker compose --profile extras down -v
    } elseif ($Down) {
      Write-Host "  Suppression des conteneurs (volumes preserves)..." -ForegroundColor DarkGray
      $r = Invoke-Docker compose --profile extras down
    } else {
      Write-Host "  Stop des conteneurs Docker incluant extras (conteneurs + volumes preserves)..." -ForegroundColor DarkGray
      $r = Invoke-Docker compose --profile extras stop
    }
    if ($r.ExitCode -ne 0) {
      Write-Host "  [WARN] docker compose a renvoye exit $($r.ExitCode):" -ForegroundColor Yellow
      $r.Output | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkYellow }
    } else {
      $r.Output | Where-Object { $_ -match 'Removing|Removed|Stopping|Stopped' } | ForEach-Object {
        Write-Host "  [OK] $($_.Trim())" -ForegroundColor Green
      }
    }
  } finally {
    Pop-Location
  }
}

Write-Host ""
if ($WipeData) {
  Write-Host "  Reset complet termine. Au prochain start_matix : init scripts" -ForegroundColor DarkGray
  Write-Host "  + realm-import + migrations seront rejoues." -ForegroundColor DarkGray
} elseif ($KeepDocker) {
  Write-Host "  API/Web stoppes. La stack Docker continue de tourner :" -ForegroundColor DarkGray
  Write-Host "    docker compose ps    # voir l'etat" -ForegroundColor DarkGray
  Write-Host "    .\scripts\start_matix.ps1   # redemarrer API+Web" -ForegroundColor DarkGray
} else {
  Write-Host "  Stack stoppee. Pour redemarrer :" -ForegroundColor DarkGray
  Write-Host "    .\scripts\start_matix.ps1" -ForegroundColor DarkGray
}
Write-Host ""

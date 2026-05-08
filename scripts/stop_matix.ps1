<#
.SYNOPSIS
  Arrête la stack Matix locale (Keycloak, API, Web) en tuant les processus
  qui écoutent sur les ports 3000, 3001, 8180.
#>
[CmdletBinding()]
param()

function Stop-Port($port, $name) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if (-not $conns) {
    Write-Host "  · $name (:$port) — déjà arrêté" -ForegroundColor DarkGray
    return
  }
  foreach ($c in $conns) {
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Host "  ✓ $name (:$port, PID $($c.OwningProcess)) arrêté" -ForegroundColor Green
  }
}

Write-Host ""
Write-Host "  Arrêt de la stack Matix" -ForegroundColor Cyan
Write-Host "  ───────────────────────"
Stop-Port 3000 'Web Next.js'
Stop-Port 3001 'API NestJS'
Stop-Port 8180 'Keycloak'
Write-Host ""
Write-Host "  Postgres reste actif (service Windows)." -ForegroundColor DarkGray
Write-Host ""

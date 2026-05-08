<#
.SYNOPSIS
  Arrete la stack Matix locale (Keycloak, API, Web) en tuant les processus
  qui ecoutent sur les ports 3000, 3001, 8180.
#>
[CmdletBinding()]
param()

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
Stop-Port 3000 'Web Next.js'
Stop-Port 3001 'API NestJS'
Stop-Port 8180 'Keycloak'
Write-Host ""
Write-Host "  Postgres reste actif (service Windows)." -ForegroundColor DarkGray
Write-Host ""

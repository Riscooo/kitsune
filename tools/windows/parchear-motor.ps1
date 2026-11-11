<#
.SYNOPSIS
  Pone el Zero y el chrome de este repositorio en un motor de Kitsune (o Kitsune Zero) para Windows ya compilado, sin
  recompilar Gecko: sustituye sus archivos dentro de browser/omni.ja.

.DESCRIPTION
  La compilación de verdad (install/kitsune-engine.py) mete los mismos archivos en el mismo sitio:
  chrome://browser/content/zero/ (jar: chrome/browser/content/browser/zero/) y
  chrome://browser/content/kitsune-chrome/ (jar: chrome/browser/content/browser/kitsune-chrome/).

  Dos formas:
  - Con -Destino: copia el motor ahí y parchea la copia (para probar sin tocar nada).
  - Con -EnSuSitio: parchea el motor instalado. Antes guarda browser\omni.ja.antes-zero (la primera vez; si ya está, la
    conserva), y -Deshacer lo devuelve. Kitsune tiene que estar cerrado. Una actualización de Kitsune lo sustituye todo.

  Necesita 7-Zip (winget install 7zip.7zip).

.EXAMPLE
  .\tools\windows\parchear-motor.ps1 -Motor .\instalador\core -Destino $env:TEMP\kitsune-zero-parcheado
  .\tools\windows\parchear-motor.ps1 -Motor "$env:LOCALAPPDATA\Kitsune Zero" -EnSuSitio
  .\tools\windows\parchear-motor.ps1 -Motor "$env:LOCALAPPDATA\Kitsune Zero" -Deshacer
#>
param(
  [Parameter(Mandatory)] [string] $Motor,
  [string] $Destino,
  [switch] $EnSuSitio,
  [switch] $Deshacer,
  [string] $Repo = (Resolve-Path "$PSScriptRoot\..\.."),
  [string] $SieteZip = 'C:\Program Files\7-Zip\7z.exe'
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path "$Motor\kitsune.exe")) { throw "No hay kitsune.exe en $Motor" }
$Motor = (Resolve-Path $Motor).Path
$abierto = Get-CimInstance Win32_Process -Filter "Name='kitsune.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($Motor, [StringComparison]::OrdinalIgnoreCase) }

if ($Deshacer) {
  $copia = "$Motor\browser\omni.ja.antes-zero"
  if (-not (Test-Path $copia)) { throw "No hay copia que devolver ($copia)" }
  if ($abierto) { throw 'Cierra Kitsune antes (este motor está abierto)' }
  Copy-Item $copia "$Motor\browser\omni.ja" -Force
  Remove-Item $copia
  Write-Host "Devuelto el omni.ja de antes en $Motor"
  return
}

if (-not (Test-Path $SieteZip)) { throw "Falta 7-Zip ($SieteZip): winget install 7zip.7zip" }
if ($EnSuSitio) {
  if ($abierto) { throw 'Cierra Kitsune antes (este motor está abierto)' }
  $Destino = $Motor
  $copia = "$Motor\browser\omni.ja.antes-zero"
  if (-not (Test-Path $copia)) { Copy-Item "$Motor\browser\omni.ja" $copia; Write-Host "Copia de seguridad: $copia" }
} else {
  if (-not $Destino) { throw 'Falta -Destino (o -EnSuSitio)' }
  if ($Motor -eq [IO.Path]::GetFullPath($Destino)) { throw 'El destino tiene que ser otra carpeta (o usa -EnSuSitio)' }
  # La copia del motor (si ya existe, se rehace).
  if (Test-Path $Destino) { Remove-Item -Recurse -Force $Destino }
  New-Item -ItemType Directory -Force $Destino | Out-Null
  Copy-Item -Recurse -Force "$Motor\*" $Destino
}

# Los archivos, con las rutas que tienen dentro de omni.ja.
$staging = Join-Path ([IO.Path]::GetTempPath()) ("kitsune-omni-" + [guid]::NewGuid())
$zero = Join-Path $staging 'chrome\browser\content\browser\zero'
$chrome = Join-Path $staging 'chrome\browser\content\browser\kitsune-chrome'
New-Item -ItemType Directory -Force $zero, $chrome | Out-Null
foreach ($part in 'modules', 'chrome', 'assets') {
  Get-ChildItem "$Repo\zero\$part" -File | Copy-Item -Destination $zero
}
Get-ChildItem "$Repo\chrome" -File -Filter *.css | Copy-Item -Destination $chrome

try {
  Push-Location $staging
  & $SieteZip u -tzip -mx=5 "$Destino\browser\omni.ja" 'chrome' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "7-Zip terminó con $LASTEXITCODE" }
} finally {
  Pop-Location
  Remove-Item -Recurse -Force $staging
}

Write-Host "Motor parcheado en $Destino"
Write-Host 'Al arrancarlo, usa -purgecaches la primera vez (la caché de arranque guarda los módulos viejos).'

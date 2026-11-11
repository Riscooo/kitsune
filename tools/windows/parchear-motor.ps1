<#
.SYNOPSIS
  Copia un motor de Kitsune (o Kitsune Zero) para Windows ya compilado y le pone el Zero y el chrome de este repositorio,
  sin recompilar Gecko: sustituye sus archivos dentro de browser/omni.ja.

.DESCRIPTION
  Sirve para probar en Windows los cambios de zero/ (módulos, zero.css, recursos) y de chrome/ con un motor publicado.
  La compilación de verdad (install/kitsune-engine.py) mete los mismos archivos en el mismo sitio:
  chrome://browser/content/zero/ (jar: chrome/browser/content/browser/zero/) y
  chrome://browser/content/kitsune-chrome/ (jar: chrome/browser/content/browser/kitsune-chrome/).

  No toca el motor de origen: trabaja en una copia. Necesita 7-Zip (winget install 7zip.7zip).

.EXAMPLE
  # Del instalador publicado: 7z x Kitsune-Zero-...-Windows-x64.exe -oinstalador
  .\tools\windows\parchear-motor.ps1 -Motor .\instalador\core -Destino $env:TEMP\kitsune-zero-parcheado
#>
param(
  [Parameter(Mandatory)] [string] $Motor,
  [Parameter(Mandatory)] [string] $Destino,
  [string] $Repo = (Resolve-Path "$PSScriptRoot\..\.."),
  [string] $SieteZip = 'C:\Program Files\7-Zip\7z.exe'
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path "$Motor\kitsune.exe")) { throw "No hay kitsune.exe en $Motor" }
if (-not (Test-Path $SieteZip)) { throw "Falta 7-Zip ($SieteZip): winget install 7zip.7zip" }
if ((Resolve-Path $Motor).Path -eq [IO.Path]::GetFullPath($Destino)) { throw 'El destino tiene que ser otra carpeta' }

# La copia del motor (si ya existe, se rehace).
if (Test-Path $Destino) { Remove-Item -Recurse -Force $Destino }
New-Item -ItemType Directory -Force $Destino | Out-Null
Copy-Item -Recurse -Force "$Motor\*" $Destino

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

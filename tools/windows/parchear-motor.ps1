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
    conserva), y -Deshacer lo devuelve. Kitsune tiene que estar cerrado. Una actualización de Kitsune pone un omni.ja
    nuevo pero no borra la copia, y puede no cambiar el BuildID (0.8.0-beta.7 trae el mismo Gecko que la beta.6; solo
    cambia omni.ja). Por eso, al parchear, se apunta la suma SHA-256 del omni.ja parcheado (omni.ja.antes-zero.sha256):
    si al volver el omni.ja ya no es ese, algo lo sustituyó (una actualización) y la copia se rehace con el que hay; y
    -Deshacer solo devuelve la copia si el omni.ja sigue siendo el que dejó este script. Así nunca se mete el omni.ja
    de una versión vieja en una nueva.

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

$omni = "$Motor\browser\omni.ja"
$copia = "$omni.antes-zero"
$marca = "$copia.sha256"   # la suma del omni.ja que dejó parcheado este script
function Get-Suma([string] $archivo) { (Get-FileHash $archivo -Algorithm SHA256).Hash.ToLowerInvariant() }
# La copia vale si el omni.ja de ahora es el que dejó este script. Una copia sin marca es de antes de que hubiera marca:
# no se puede saber si hubo una actualización por medio, así que no vale (se rehace al parchear; -Deshacer no la usa).
$copiaVale = (Test-Path $copia) -and (Test-Path $marca) -and ((Get-Content $marca -Raw).Trim() -eq (Get-Suma $omni))

if ($Deshacer) {
  if (-not (Test-Path $copia)) { throw "No hay copia que devolver ($copia)" }
  if (-not $copiaVale) { throw "El omni.ja de $Motor no es el que dejó este script (¿Kitsune se actualizó?): la copia sería de otra versión y no se devuelve. Para quitar Zero, reinstala Kitsune." }
  if ($abierto) { throw 'Cierra Kitsune antes (este motor está abierto)' }
  Copy-Item $copia $omni -Force
  Remove-Item $copia, $marca
  Write-Host "Devuelto el omni.ja de antes en $Motor"
  return
}

if (-not (Test-Path $SieteZip)) { throw "Falta 7-Zip ($SieteZip): winget install 7zip.7zip" }
if ($EnSuSitio) {
  if ($abierto) { throw 'Cierra Kitsune antes (este motor está abierto)' }
  $Destino = $Motor
  if ((Test-Path $copia) -and -not $copiaVale) {
    # Algo sustituyó el omni.ja parcheado (una actualización de Kitsune): el de ahora es el original de esta versión.
    Remove-Item $copia; Remove-Item $marca -ErrorAction SilentlyContinue
    Write-Host 'La copia anterior era de otra versión de Kitsune; se rehace con el omni.ja instalado.'
  }
  if (-not (Test-Path $copia)) { Copy-Item $omni $copia; Write-Host "Copia de seguridad: $copia" }
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
if ($EnSuSitio) { Set-Content -Path $marca -Value (Get-Suma $omni) -Encoding ascii -NoNewline }

Write-Host "Motor parcheado en $Destino"
Write-Host 'Al arrancarlo, usa -purgecaches la primera vez (la caché de arranque guarda los módulos viejos).'

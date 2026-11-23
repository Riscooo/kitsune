# Kitsune Zero: lo que suena en la app de Spotify, con los controles multimedia de Windows (los mismos de las teclas del
# teclado). Lee una orden por linea y contesta un JSON por linea. Solo mira la sesion de Spotify; no toca nada mas.
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
$salida = New-Object System.IO.StreamWriter ([Console]::OpenStandardOutput()), $utf8
$salida.AutoFlush = $true
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$gestor = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$medios = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$flujo = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$aTarea = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
$aFlujo = ([System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsStreamForRead' -and $_.GetParameters().Count -eq 1 })[0]
function Esperar($operacion, $tipo) {
  $tarea = $aTarea.MakeGenericMethod($tipo).Invoke($null, @($operacion))
  if (-not $tarea.Wait(4000)) { throw 'tarda' }
  $tarea.Result
}
$todas = Esperar ($gestor::RequestAsync()) $gestor
$ultima = ''
$portada = ''
while ($true) {
  $linea = [Console]::In.ReadLine()
  if ($null -eq $linea) { break }
  $r = @{ ok = $false; abierta = $false }
  try {
    $partes = $linea.Trim().Split(' ')
    if ($partes[0] -eq 'abrir') { Start-Process 'spotify:'; $r.ok = $true }
    else {
      $s = $todas.GetSessions() | Where-Object { $_.SourceAppUserModelId -like '*Spotify*' } | Select-Object -First 1
      if ($s) {
        $r.abierta = $true
        switch ($partes[0]) {
          'alternar'  { [void](Esperar ($s.TryTogglePlayPauseAsync()) ([bool])) }
          'siguiente' { [void](Esperar ($s.TrySkipNextAsync()) ([bool])) }
          'anterior'  { [void](Esperar ($s.TrySkipPreviousAsync()) ([bool])) }
          'ir'        { [void](Esperar ($s.TryChangePlaybackPositionAsync([long]([double]::Parse($partes[1], [Globalization.CultureInfo]::InvariantCulture) * 10000000))) ([bool])) }
        }
        $p = Esperar ($s.TryGetMediaPropertiesAsync()) $medios
        $t = $s.GetTimelineProperties()
        $i = $s.GetPlaybackInfo()
        $r.titulo = [string]$p.Title; $r.artista = [string]$p.Artist; $r.album = [string]$p.AlbumTitle
        $r.suena = ([string]$i.PlaybackStatus -eq 'Playing')
        $r.dura = [math]::Round($t.EndTime.TotalSeconds, 1)
        $va = $t.Position.TotalSeconds
        if ($r.suena) { $va += ([DateTimeOffset]::Now - $t.LastUpdatedTime).TotalSeconds }
        $r.va = [math]::Round([math]::Max(0, [math]::Min($va, $t.EndTime.TotalSeconds)), 1)
        $r.puede = @{ siguiente = [bool]$i.Controls.IsNextEnabled; anterior = [bool]$i.Controls.IsPreviousEnabled; ir = [bool]$i.Controls.IsPlaybackPositionEnabled }
        $cual = "$($p.Title)|$($p.Artist)"
        if ($cual -ne $ultima -or $partes[0] -eq 'portada') {
          $portada = ''
          if ($p.Thumbnail) {
            $f = Esperar ($p.Thumbnail.OpenReadAsync()) $flujo
            $lee = $aFlujo.Invoke($null, @($f))
            $m = New-Object System.IO.MemoryStream
            $lee.CopyTo($m)
            if ($m.Length -gt 0 -and $m.Length -lt 3000000) { $portada = "data:$(if ($f.ContentType -match '^image/(png|jpeg)$') { $f.ContentType } else { 'image/png' });base64," + [Convert]::ToBase64String($m.ToArray()) }
            $lee.Dispose()
          }
          $ultima = $cual
          $r.portada = $portada
        }
        $r.ok = $true
      }
    }
  } catch { $r.error = [string]$_.Exception.Message }
  $salida.WriteLine((ConvertTo-Json $r -Compress -Depth 3))
}

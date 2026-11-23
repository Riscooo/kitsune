<#
  Ayudante de las pruebas nativas de Windows (zero_windows_native.mjs): lo que Gecko no puede ver de su propia ventana.

  ventana.ps1 -Hwnd 0x1234 -Que backdrop    → el material que DWM tiene puesto (DWMWA_SYSTEMBACKDROP_TYPE, 38):
                                              0 auto, 1 ninguno, 2 Mica, 3 Acrílico, 4 Mica Alt; y el modo oscuro (20)
  ventana.ps1 -Hwnd 0x1234 -Que foto -Png x → captura lo que se ve de la ventana en pantalla (con el material de DWM)
  ventana.ps1 -Hwnd 0x1234 -Que delante     → la trae al frente
  ventana.ps1 -Hwnd 0x1234 -Que rect        → su rectángulo en pantalla y sus DPI
  ventana.ps1 -Hwnd 0 -Que transparencia [-Valor 0|1]
                                            → lee (y, con -Valor, cambia y avisa a las aplicaciones) «Efectos de
                                              transparencia» de Windows (HKCU, EnableTransparency)
#>
param(
  [Parameter(Mandatory)] [string] $Hwnd,
  [Parameter(Mandatory)] [ValidateSet('backdrop', 'foto', 'delante', 'rect', 'transparencia')] [string] $Que,
  [string] $Png,
  [ValidateSet('', '0', '1')] [string] $Valor = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class KitsuneVentana {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT value, int size);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, int flags);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, UIntPtr w, string l, uint flags, uint timeout, out UIntPtr result);
}
'@
[KitsuneVentana]::SetProcessDPIAware() | Out-Null
$h = [IntPtr][Convert]::ToInt64(($Hwnd -replace '^0x', ''), 16)
# La ventana de nivel superior (por si Gecko da la de un hijo).
if ($h -ne [IntPtr]::Zero) {
  $top = [KitsuneVentana]::GetAncestor($h, 2)
  if ($top -ne [IntPtr]::Zero) { $h = $top }
}

function Rect {
  $r = New-Object KitsuneVentana+RECT
  # DWMWA_EXTENDED_FRAME_BOUNDS (9): el rectángulo que se ve, sin la sombra invisible.
  [void][KitsuneVentana]::DwmGetWindowAttribute($h, 9, [ref]$r, 16)
  return $r
}

switch ($Que) {
  'transparencia' {
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
    if ($Valor -ne '') {
      Set-ItemProperty -Path $key -Name EnableTransparency -Value ([int]$Valor) -Type DWord
      # WM_SETTINGCHANGE «ImmersiveColorSet»: lo que manda Configuración al cambiarlo.
      $r = [UIntPtr]::Zero
      [void][KitsuneVentana]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'ImmersiveColorSet', 2, 3000, [ref]$r)
    }
    [pscustomobject]@{ transparencia = (Get-ItemProperty -Path $key -Name EnableTransparency -ErrorAction SilentlyContinue).EnableTransparency } | ConvertTo-Json -Compress
    return
  }
  'backdrop' {
    $type = 0; $dark = 0
    $hr = [KitsuneVentana]::DwmGetWindowAttribute($h, 38, [ref]$type, 4)
    [void][KitsuneVentana]::DwmGetWindowAttribute($h, 20, [ref]$dark, 4)
    [pscustomobject]@{ hwnd = ('0x{0:X}' -f $h.ToInt64()); hr = $hr; backdrop = $type; dark = $dark } | ConvertTo-Json -Compress
  }
  'delante' {
    [void][KitsuneVentana]::ShowWindow($h, 9)
    [void][KitsuneVentana]::SetForegroundWindow($h)
    '{"ok":true}'
  }
  'rect' {
    $r = Rect
    [pscustomobject]@{ left = $r.Left; top = $r.Top; width = $r.Right - $r.Left; height = $r.Bottom - $r.Top; dpi = [KitsuneVentana]::GetDpiForWindow($h) } | ConvertTo-Json -Compress
  }
  'foto' {
    if (-not $Png) { throw 'Falta -Png' }
    $r = Rect
    $w = $r.Right - $r.Left; $hgt = $r.Bottom - $r.Top
    $bmp = New-Object System.Drawing.Bitmap $w, $hgt
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size $w, $hgt))
    $bmp.Save($Png, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    [pscustomobject]@{ png = $Png; width = $w; height = $hgt } | ConvertTo-Json -Compress
  }
}

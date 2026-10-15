#!/bin/sh
# Kitsune Zero para Linux: lo instala para tu usuario (sin sudo) en ~/.local/share/kitsune-zero y lo añade al menú de
# aplicaciones. Para actualizar, descarga la versión nueva y vuelve a ejecutar este archivo: tus datos no se tocan.
# La primera vez que lo abras trae una copia de tu perfil de Kitsune (si Kitsune está abierto, te pide cerrarlo).
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
data="${XDG_DATA_HOME:-${HOME}/.local/share}"
destino="${data}/kitsune-zero"
if [ ! -x "${here}/kitsune" ] || [ ! -x "${here}/kitsune-zero" ]; then
    printf '%s\n' 'No encuentro el programa de Kitsune Zero junto a este instalador.' >&2
    exit 1
fi
if [ "${here}" != "${destino}" ]; then
    # Copia nueva al lado y cambio de golpe. La anterior se guarda en kitsune-zero.anterior (un Kitsune Zero abierto
    # sigue con ella hasta que lo cierres) y se borra en la siguiente instalación.
    mkdir -p "${data}"
    rm -rf "${destino}.nuevo" "${destino}.anterior"
    cp -a "${here}" "${destino}.nuevo"
    if [ -d "${destino}" ]; then mv "${destino}" "${destino}.anterior"; fi
    mv "${destino}.nuevo" "${destino}"
fi
for size in 16 32 48 64 128; do
    mkdir -p "${data}/icons/hicolor/${size}x${size}/apps"
    cp "${destino}/browser/chrome/icons/default/default${size}.png" "${data}/icons/hicolor/${size}x${size}/apps/kitsune-zero.png"
done
mkdir -p "${data}/applications"
cat > "${data}/applications/kitsune-zero.desktop" <<DESKTOP
[Desktop Entry]
Version=1.0
Type=Application
Name=Kitsune Zero
GenericName=Web Browser
GenericName[es]=Navegador web
Comment=Browse the web on a sheet of glass
Comment[es]=Navega por la web en una lámina de cristal
Exec="${destino}/kitsune-zero" %u
Icon=kitsune-zero
Terminal=false
StartupNotify=true
StartupWMClass=kitsune-zero
Categories=Network;WebBrowser;
MimeType=text/html;text/xml;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;
Actions=nueva-ventana;ventana-privada;

[Desktop Action nueva-ventana]
Name=New Window
Name[es]=Nueva ventana
Exec="${destino}/kitsune-zero" --new-window

[Desktop Action ventana-privada]
Name=New Private Window
Name[es]=Nueva ventana privada
Exec="${destino}/kitsune-zero" --private-window
DESKTOP
update-desktop-database "${data}/applications" >/dev/null 2>&1 || :
gtk-update-icon-cache -q -t "${data}/icons/hicolor" >/dev/null 2>&1 || :
# La regla de su ventana de cristal en niri 26.04+ y, si su complemento ya está, en Hyprland (hyprglass) y GNOME
# (Liquid Glass); en KDE solo explica qué haría (cristal.py poner --forzar). Sin nada de eso, Zero pone detrás una
# foto de la web, que su borde dobla como una lente.
if [ -d "${destino}/zero-linux" ]; then
    sh "${destino}/zero-linux/install-niri.sh" >/dev/null 2>&1 || :
    if command -v python3 >/dev/null 2>&1; then python3 "${destino}/zero-linux/cristal.py" poner || :; fi
fi
printf '%s\n' "Kitsune Zero está instalado en ${destino}." 'Ya lo tienes en el menú de aplicaciones.'

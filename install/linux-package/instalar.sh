#!/bin/sh
# Kitsune para Linux: lo instala para tu usuario (sin sudo) en ~/.local/share/kitsune
# y lo añade al menú de aplicaciones. Para actualizar, descarga la versión nueva y
# vuelve a ejecutar este archivo: tus datos (perfil, marcadores, contraseñas) no se tocan.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
data="${XDG_DATA_HOME:-${HOME}/.local/share}"
destino="${data}/kitsune"
if [ ! -x "${here}/kitsune" ]; then
    printf '%s\n' 'No encuentro el programa de Kitsune junto a este instalador.' >&2
    exit 1
fi
if [ "${here}" != "${destino}" ]; then
    # Copia nueva al lado y cambio de golpe. La versión anterior se guarda en kitsune.anterior
    # (un Kitsune abierto sigue con ella hasta que lo cierres) y se borra en la siguiente instalación.
    mkdir -p "${data}"
    rm -rf "${destino}.nuevo" "${destino}.anterior"
    cp -a "${here}" "${destino}.nuevo"
    if [ -d "${destino}" ]; then mv "${destino}" "${destino}.anterior"; fi
    mv "${destino}.nuevo" "${destino}"
fi
for size in 16 32 48 64 128; do
    mkdir -p "${data}/icons/hicolor/${size}x${size}/apps"
    cp "${destino}/browser/chrome/icons/default/default${size}.png" "${data}/icons/hicolor/${size}x${size}/apps/kitsune.png"
done
mkdir -p "${data}/applications"
cat > "${data}/applications/kitsune.desktop" <<DESKTOP
[Desktop Entry]
Version=1.0
Type=Application
Name=Kitsune
GenericName=Web Browser
GenericName[es]=Navegador web
Comment=Browse the web with Kitsune
Comment[es]=Navega por la web con Kitsune
Exec="${destino}/kitsune" %u
Icon=kitsune
Terminal=false
StartupNotify=true
StartupWMClass=kitsune
Categories=Network;WebBrowser;
MimeType=text/html;text/xml;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;
Actions=nueva-ventana;ventana-privada;

[Desktop Action nueva-ventana]
Name=New Window
Name[es]=Nueva ventana
Exec="${destino}/kitsune" --new-window

[Desktop Action ventana-privada]
Name=New Private Window
Name[es]=Nueva ventana privada
Exec="${destino}/kitsune" --private-window
DESKTOP
update-desktop-database "${data}/applications" >/dev/null 2>&1 || :
gtk-update-icon-cache -q -t "${data}/icons/hicolor" >/dev/null 2>&1 || :
printf '%s\n' "Kitsune está instalado en ${destino}." 'Ya lo tienes en el menú de aplicaciones.'

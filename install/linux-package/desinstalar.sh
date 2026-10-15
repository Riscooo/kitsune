#!/bin/sh
# Quita Kitsune del menú de aplicaciones y borra el programa de ~/.local/share/kitsune.
# Tus datos (perfil, marcadores, contraseñas) se quedan donde están.
set -eu
data="${XDG_DATA_HOME:-${HOME}/.local/share}"
# Lo que puso cristal.py para Kitsune Zero (Hyprland, KDE, GNOME), como estaba.
if [ -f "${data}/kitsune/zero-linux/cristal.py" ] && command -v python3 >/dev/null 2>&1; then
    python3 "${data}/kitsune/zero-linux/cristal.py" quitar >/dev/null 2>&1 || :
fi
rm -f "${data}/applications/kitsune.desktop"
for size in 16 32 48 64 128; do rm -f "${data}/icons/hicolor/${size}x${size}/apps/kitsune.png"; done
rm -rf "${data}/kitsune" "${data}/kitsune.anterior" "${data}/kitsune.nuevo"
update-desktop-database "${data}/applications" >/dev/null 2>&1 || :
printf '%s\n' 'Kitsune se ha quitado de este equipo. Tus datos siguen guardados.'

#!/bin/sh
# Instala niri con la refracción de Kitsune Zero (niri-vidrio) para la próxima sesión.
#
# Uso: instalar.sh <ruta al niri compilado con 0001-refraccion.patch>
#      instalar.sh --quitar   (vuelve al niri de siempre en la próxima sesión)
#
# Deja el binario y sus guiones en ~/.local/lib/niri-vidrio y añade al servicio niri.service (systemd de
# usuario) que arranque ese niri; si falta o no acepta la configuración, arranca el de siempre. La regla de
# la refracción se pone al empezar la sesión y se quita al cerrarla. No reinicia nada.
set -eu
here="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
lib="$HOME/.local/lib/niri-vidrio"
dropin="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/niri.service.d"
if [ "${1:-}" = "--quitar" ]; then
    rm -f "$dropin/vidrio.conf"
    [ -x "$lib/regla.sh" ] && "$lib/regla.sh" quitar || true
    systemctl --user daemon-reload
    echo "Hecho: en la próxima sesión, el niri de siempre."
    exit 0
fi
bin="${1:?falta la ruta al niri compilado}"
"$bin" --version >/dev/null
mkdir -p "$lib" "$dropin"
install -m 755 "$bin" "$lib/niri.nuevo"
strip "$lib/niri.nuevo" 2>/dev/null || true
mv "$lib/niri.nuevo" "$lib/niri"
install -m 755 "$here/arrancar.sh" "$here/regla.sh" "$lib/"
install -m 644 "$here/kitsune-zero-vidrio.kdl" "$lib/"
cat > "$dropin/vidrio.conf" <<CONF
# niri con la refracción de Kitsune Zero (instalar.sh de zero/linux/niri-vidrio). Para quitarlo:
# instalar.sh --quitar (o borrar este archivo) y volver a entrar en la sesión.
[Service]
ExecStartPre=$lib/regla.sh poner
ExecStart=
ExecStart=$lib/arrancar.sh --session
ExecStopPost=$lib/regla.sh quitar
CONF
systemctl --user daemon-reload
echo "Hecho: al volver a entrar en la sesión, niri con la refracción ($("$lib/niri" --version))."

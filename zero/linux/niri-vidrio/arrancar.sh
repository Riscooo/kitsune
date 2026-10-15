#!/bin/sh
# niri con la refracción de Kitsune Zero (niri-vidrio); si falta o no acepta la configuración, el de
# siempre (y sin la regla de la refracción).
here="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
conf="${XDG_CONFIG_HOME:-$HOME/.config}/niri/config.kdl"
if [ -x "$here/niri" ] && "$here/niri" validate -c "$conf" >/dev/null 2>&1; then
    exec "$here/niri" "$@"
fi
"$here/regla.sh" quitar || true
exec /usr/bin/niri "$@"

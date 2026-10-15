#!/bin/sh
# poner | quitar: el «include» de la refracción en la regla de Kitsune Zero para niri.
set -eu
conf="${NIRI_CONF_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/niri}"
here="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
rule="$conf/kitsune-zero.kdl"
line='include "kitsune-zero-vidrio.kdl"'
[ -f "$rule" ] || exit 0
case "${1:-}" in
    poner)
        install -m 644 "$here/kitsune-zero-vidrio.kdl" "$conf/kitsune-zero-vidrio.kdl"
        grep -qxF "$line" "$rule" || printf '%s\n' "$line" >> "$rule" ;;
    quitar)
        if grep -qxF "$line" "$rule"; then
            tmp="$rule.tmp.$$"; grep -vxF "$line" "$rule" > "$tmp" && mv "$tmp" "$rule"
        fi ;;
    *) echo "uso: $0 poner|quitar" >&2; exit 2 ;;
esac

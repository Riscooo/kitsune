#!/bin/sh
# Kitsune Zero en niri: la regla de desenfoque (kitsune-zero.kdl) junto a la configuración de niri,
# y un «include» en config.kdl con copia de seguridad, como hace InkShadow con sus animaciones.
# Solo con niri 26.04 o posterior (antes no había desenfoque de fondo) y con una configuración ya
# existente; si no, no toca nada. Se puede repetir: no vuelve a añadir el include.
set -eu

here="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
niri_dir="${XDG_CONFIG_HOME:-${HOME}/.config}/niri"
config="${niri_dir}/config.kdl"

command -v niri >/dev/null 2>&1 || exit 0
[ -f "${config}" ] || exit 0
version="$(niri --version 2>/dev/null | awk '{print $2}')"
major="${version%%.*}"
rest="${version#*.}"
minor="${rest%%.*}"
case "${major}${minor}" in *[!0-9]*|'') exit 0 ;; esac
if [ "${major}" -lt 26 ] || { [ "${major}" -eq 26 ] && [ "${minor#0}" -lt 4 ]; }; then
    exit 0
fi

install -m 644 "${here}/kitsune-zero.kdl" "${niri_dir}/kitsune-zero.kdl"
if ! grep -q 'include "kitsune-zero.kdl"' "${config}"; then
    cp -a "${config}" "${config}.pre-kitsune-zero-$(date +%Y%m%d-%H%M%S)"
    printf '\n// Kitsune Zero: desenfoque detrás de su ventana de cristal.\ninclude "kitsune-zero.kdl"\n' >> "${config}"
fi

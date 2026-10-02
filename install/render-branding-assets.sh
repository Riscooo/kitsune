#!/bin/sh
# Deterministic raster sizes from Kitsune's SVG logo (tools/logo/generate.py). Runtime preparation
# only copies these assets; it does not need librsvg installed on launch.
set -eu
install_root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
brand_root="${install_root}/branding"
source_icon="${install_root}/../chrome/assets/kitsune.svg"
mkdir -p "${brand_root}"
cp -- "${source_icon}" "${brand_root}/icon.svg"
small_icon="${brand_root}/icon-small.svg"
# 16 y 32 px salen del icono simplificado (el contorno fino de la máscara no se ve).
for size in 16 32; do
    rsvg-convert --width "${size}" --height "${size}" \
        --output "${brand_root}/icon-${size}.png" "${small_icon}"
done
for size in 48 64 128 192 384; do
    rsvg-convert --width "${size}" --height "${size}" \
        --output "${brand_root}/icon-${size}.png" "${source_icon}"
done
rsvg-convert --width 236 --height 236 --page-width 300 --page-height 236 --left 32 \
    --output "${brand_root}/about-300x236.png" "${source_icon}"

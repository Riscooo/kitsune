#!/bin/sh
# Kitsune 0.7: instala la app en las rutas del usuario (no el motor: ese lo
# compila y activa kitsune-engine.py). Guarda antes una copia de todo lo que
# reemplaza. El perfil no se copia aquí: puede estar abierto, y una copia de un
# perfil en uso deja las bases de datos a medias. Lo copia el lanzador, cerrado,
# justo antes de que el motor propio lo abra por primera vez.
set -eu

repo="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
data="${XDG_DATA_HOME:-${HOME}/.local/share}"
root="${data}/kitsune-browser"
state="${XDG_STATE_HOME:-${HOME}/.local/state}/kitsune-browser"
units="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"
bin="${HOME}/.local/bin"

if [ ! -x "${root}/engine/current/kitsune" ]; then
    printf '%s\n' 'Primero hay que compilar y activar el motor: python3 install/kitsune-engine.py build' >&2
    exit 1
fi

backup="$(mktemp -d "${data}/kitsune-0.6-backup.XXXXXX")"
for item in start templates native branding mascot appearance.py home-server.py media.py profiles.py wallpapers.py prepare-runtime.py version.json; do
    [ -e "${root}/${item}" ] && cp -a "${root}/${item}" "${backup}/"
done
mkdir -p "${backup}/profile" "${backup}/state" "${backup}/systemd"
cp -a "${root}/profile/user.js" "${root}/profile/chrome" "${backup}/profile/"
for file in profiles.json home.json; do
    [ -e "${state}/${file}" ] && cp -a "${state}/${file}" "${backup}/state/"
done
cp -a "${bin}/kitsune-browser" "${backup}/"
for unit in kitsune-home.service kitsune-home@.service; do
    [ -e "${units}/${unit}" ] && cp -a "${units}/${unit}" "${backup}/systemd/"
done
printf 'Copia previa a Kitsune 0.6 (%s). El perfil se copia aparte, cerrado, en kitsune-0.6-profile-backup.*\n' \
    "$(date -Iseconds)" > "${backup}/LEEME.txt"

# Programa, módulos y receta del motor.
for file in appearance.py home-server.py media.py profiles.py wallpapers.py kitsune-engine.py engine_probe.py version.json; do
    install -m 600 "${repo}/install/${file}" "${root}/${file}"
done
chmod 700 "${root}/kitsune-engine.py"
rm -f "${root}/prepare-runtime.py"
for directory in native branding recipe mascot; do
    rm -rf "${root:?}/${directory}.new"
    cp -r "${repo}/install/${directory}" "${root}/${directory}.new"
    rm -rf "${root:?}/${directory}"
    mv "${root}/${directory}.new" "${root}/${directory}"
done
find "${root}/branding" -name README.md -delete

# Inicio y plantillas limpias.
rm -rf "${root:?}/start.new"
cp -r "${repo}/start" "${root}/start.new"
rm -rf "${root:?}/start"
mv "${root}/start.new" "${root}/start"
install -m 600 "${repo}/install/user.js" "${root}/templates/user.js"
cp -r "${repo}/chrome/." "${root}/templates/chrome/"

# Cada perfil: chrome nuevo y user.js de la plantilla, conservando sus marcas
# kitsune.migrations.* y la página de inicio propia de los perfiles adicionales.
for profile in "${root}/profile" "${root}"/profiles/*/profile; do
    [ -d "${profile}" ] || continue
    cp -r "${repo}/chrome/." "${profile}/chrome/"
    python3 - "${repo}/install/user.js" "${profile}/user.js" <<'PY'
import sys
from pathlib import Path
template, target = Path(sys.argv[1]).read_text(), Path(sys.argv[2])
old = target.read_text().splitlines() if target.exists() else []
keep = [line for line in old if line.startswith('user_pref("kitsune.migrations.')]
if "// Kitsune local profile home; independent origin and storage." in old:
    index = old.index("// Kitsune local profile home; independent origin and storage.")
    keep += ["", *old[index:index + 2]]
text = template.rstrip("\n") + "\n" + ("\n".join(keep) + "\n" if keep else "")
target.write_text(text)
target.chmod(0o600)
PY
done

# Fondos de serie (los de la nueva pestaña de Gecko, comprobados con su sha256).
# Sin conexión no pasa nada: se quedan «Original» y «Elegir imagen».
python3 "${root}/wallpapers.py" sync || printf '%s\n' 'No se han podido preparar los fondos de serie; se reintentará en la próxima instalación.' >&2

# Icono del escritorio: el logo actual de Kitsune (antes quedaba el de Nightfall).
icons="${data}/icons/hicolor"
install -D -m 644 "${repo}/install/branding/icon.svg" "${icons}/scalable/apps/kitsune-browser.svg"
for size in 16 22 24 32 48 64 128 256; do
    install -D -m 644 "${repo}/install/branding/icon-${size}.png" "${icons}/${size}x${size}/apps/kitsune-browser.png"
done
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -f -t "${icons}" 2>/dev/null || :

# Lanzador y servicios.
install -m 755 "${repo}/install/kitsune-browser" "${bin}/kitsune-browser"
for unit in kitsune-home.service kitsune-home@.service kitsune-engine-update.service kitsune-engine-update.timer; do
    install -m 644 "${repo}/install/${unit}" "${units}/${unit}"
done
systemctl --user daemon-reload
systemctl --user enable --now kitsune-engine-update.timer
systemctl --user try-restart kitsune-home.service 'kitsune-home@*.service'

printf 'Kitsune %s instalado. Copia previa: %s\n' "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "${repo}/install/version.json")" "${backup}"

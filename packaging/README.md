# Kitsune en tiendas de Linux

Todo listo para publicar en cuanto haya licencia (Flathub y AUR la piden). Los dos usan el
paquete de Linux de la versión publicada en GitHub, sin compilar otra vez, y apagan dentro el
aviso y la actualización automática de Kitsune (`kitsune-distro.js`): ahí actualiza la tienda.

## AUR (`aur/`, paquete `kitsune-bin`)

Probado el 14-10-2026: `makepkg` construye el paquete de la 0.8.0-beta.1 (119 MB) y ese
Kitsune arranca con Gecko 158, sin aviso de versión, en `/opt/kitsune` con `/usr/bin/kitsune`.

Para publicar (con una cuenta de AUR y su clave SSH):

```sh
git clone ssh://aur@aur.archlinux.org/kitsune-bin.git
cp aur/PKGBUILD aur/kitsune.desktop aur/kitsune-distro.js aur/.SRCINFO kitsune-bin/
cd kitsune-bin && git add . && git commit -m "Kitsune 0.8.0-beta.1" && git push
```

Con cada versión: `pkgver`, `_release`, `pkgrel=1`, el `sha256` de su `.tar.xz` (en su
`SHA256SUMS.txt`) y `makepkg --printsrcinfo > .SRCINFO`.

## Flathub (`flathub/`, `io.github.riscooo.Kitsune`)

Manifiesto sobre la base de Firefox de Flathub, el `.desktop` y el metainfo (validado con
`appstreamcli validate`). Los perfiles quedan en `~/.var/app/io.github.riscooo.Kitsune/`.

Para publicar: un PR a https://github.com/flathub/flathub (rama `new-pr`) con estos archivos; al
aceptarlo, Flathub crea el repositorio de la app y cada versión nueva es un PR allí con la url,
el `sha256` y un `<release>` en el metainfo. Antes, probarlo con
`flatpak-builder --user --install build flathub/io.github.riscooo.Kitsune.yml` (aquí no está
instalado flatpak).

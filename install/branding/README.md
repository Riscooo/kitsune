# Kitsune native branding

These are product logos only. `icon.svg` is an exact copy of the existing
`chrome/assets/kitsune.svg`; the PNGs are deterministic librsvg renders at the
sizes Kitsune's engine build needs (16–384 px). `wordmark.svg` is the Kitsune
text wordmark. No security, certificate, warning, permission or extension
identity icon is replaced. Recreate the assets with
`sh install/render-branding-assets.sh`.

Since 0.6 these files are compiled into Kitsune's own engine:
`install/kitsune-engine.py` creates `browser/branding/kitsune` from Gecko's
unofficial branding of the same release, copies these icons and logos into it,
writes the Kitsune brand strings and builds with `--with-branding`. Nothing is
patched into another browser's binary any more. Gecko's internal user agent
stays the standard Firefox one, so websites and search keep working; the About
dialog credits Mozilla Gecko.

The engine's build fingerprint includes the SHA-256 of every asset here, so a
new logo triggers a rebuild (incremental when the Gecko version is unchanged).

Tests:

```sh
python3 -m unittest tests/engine_test.py
python3 tests/native_branding_smoke.py            # motor activo
python3 tests/native_branding_smoke.py --headed   # captura de la ventana temporal
```

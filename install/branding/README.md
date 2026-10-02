# Kitsune native branding

These are product logos only. `icon.svg` is an exact copy of the existing
`chrome/assets/kitsune.svg`; the PNGs are deterministic librsvg renders at the
native engine's required sizes. `wordmark.svg` is the Kitsune text wordmark.
No security, certificate, warning, permission or extension identity icon is
replaced. Recreate the assets with `sh install/render-branding-assets.sh`.

Install this directory next to `prepare-runtime.py`. The preparer builds a
private, versioned snapshot of the installed engine without touching `/usr/lib`.
Only allowlisted branding resources, the About wordmark/attribution, and native
application icons are replaced. Internal application identity and user agent
stay unchanged, preserving search settings and compatibility. About retains
LibreWolf/Mozilla attribution and the original upstream website/license links.

The cache identity includes the engine file metadata, branding revision and
SHA-256 of every asset. Engine updates create a fresh snapshot, never mixing
new libraries into a running old copy. Preparation failure does not silently
launch an old, potentially outdated engine. Snapshots are kept for active
processes/rollback; they are not automatically deleted.

Verification on Gecko 154.0-2: 9 offline tests and 7 real native-browser checks.
All non-branding archive resources and other engine files were compared
byte-for-byte. Native window/new-tab/settings titles, original site titles,
the extension popup's actual painted background, addon-signature enforcement,
strict file origins, sandbox level 6 and malware protection were checked in a
new temporary profile. No user profile was driven by WebDriver.

Tests:

```sh
python3 -m unittest discover -s tests -p runtime_branding_test.py
python3 tests/native_branding_smoke.py --runtime-root /tmp/kitsune-brand-test
# Optional actual XUL/Wayland popup screenshot (temporary test window only):
python3 tests/native_branding_smoke.py --runtime-root /tmp/kitsune-brand-test --headed
```

Evidence: `tests/evidence/branding-2026-09-12/` in the project.

#!/usr/bin/env python3
"""Try Kitsune's own engine on a throwaway copy of a real, closed profile.

Before a new Gecko first opens a real profile (it upgrades it and an older
engine cannot reopen it), this copies the profile next to it on the same disk,
writes the user.js that install.sh would write, and starts the engine headless,
without network and without restoring tabs, so no site is contacted with the
profile's sessions. It compares saved logins, history, add-ons, the default
search engine and the privacy mode before and after, prints counts only (no
URLs, names or secrets) and deletes the copy. The real profile is only read.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import re
import shutil
import sqlite3
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "install"))
from engine_probe import run_chrome_script  # noqa: E402

SPEC = importlib.util.spec_from_file_location("kitsune_engine", ROOT / "install/kitsune-engine.py")
engine = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(engine)

DEFAULT_PROFILE = Path.home() / ".local/share/kitsune-browser/profile"
DEFAULT_BROWSER = Path.home() / ".local/share/kitsune-browser/engine/current/kitsune"
# Harness only: no session restore and every connection to a closed port.
HARNESS = {"browser.startup.page": 0, "browser.startup.homepage": "about:blank",
           "browser.sessionstore.resume_from_crash": False,
           "network.proxy.type": 1, "network.proxy.http": "127.0.0.1", "network.proxy.http_port": 9,
           "network.proxy.ssl": "127.0.0.1", "network.proxy.ssl_port": 9, "network.proxy.no_proxies_on": "",
           "network.proxy.share_proxy_settings": True}

PROBE = """
const done = arguments[arguments.length - 1];
(async () => {
  let win = null;
  for (let i = 0; i < 300 && !(win = Services.wm.getMostRecentWindow('navigator:browser'))?.gBrowserInit?.delayedStartupFinished; i++)
    await new Promise(resolve => setTimeout(resolve, 100));
  const logins = (await Services.logins.getAllLogins()).length;
  const {PlacesUtils} = ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
  const db = await PlacesUtils.promiseDBConnection();
  const history = (await db.execute('SELECT count(*) AS n FROM moz_places'))[0].getResultByName('n');
  const {AddonManager} = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  const addons = (await AddonManager.getAddonsByTypes(['extension']))
    .filter(addon => !addon.isBuiltin && !addon.isSystem).map(addon => ({id: addon.id, active: addon.isActive}));
  const {SearchService} = ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs');
  await SearchService.init();
  const pref = (name, fallback) => {
    const type = Services.prefs.getPrefType(name);
    if (type === Services.prefs.PREF_BOOL) return Services.prefs.getBoolPref(name);
    if (type === Services.prefs.PREF_INT) return Services.prefs.getIntPref(name);
    if (type === Services.prefs.PREF_STRING) return Services.prefs.getStringPref(name);
    return fallback;
  };
  return {app: Services.appinfo.name, version: Services.appinfo.version, logins, history, addons,
    search: (await SearchService.getDefault()).name, searchPrivate: (await SearchService.getDefaultPrivate()).name,
    privacyActive: pref('kitsune.privacy.active', null), privacyApplied: pref('kitsune.privacy.applied', null),
    sanitizeOnShutdown: pref('privacy.sanitize.sanitizeOnShutdown', null),
    blocking: pref('browser.contentblocking.category', null), httpsOnly: pref('dom.security.https_only_mode', null),
    rustLoginsActive: pref('signon.storage.rust.active', null), googleMigration: pref('kitsune.migrations.googleSearch.v2', null)};
})().then(done, error => done({error: String(error), stack: error.stack}));
"""


def count(db: Path, query: str):
    if not db.is_file():
        return None
    connection = sqlite3.connect(f"file:{db}?mode=ro&immutable=1", uri=True)
    try:
        return connection.execute(query).fetchone()[0]
    finally:
        connection.close()


def before(profile: Path):
    addons = json.loads((profile / "extensions.json").read_text())["addons"]
    prefs = (profile / "prefs.js").read_text(errors="replace")
    rust = re.search(r'user_pref\("signon\.storage\.rust\.active", (true|false)\);', prefs)
    return {"logins": count(profile / "logins.db", "SELECT count(*) FROM loginsL WHERE is_deleted = 0")
                      if (profile / "logins.db").is_file() else
                      len(json.loads((profile / "logins.json").read_text()).get("logins", []))
                      if (profile / "logins.json").is_file() else 0,
            "history": count(profile / "places.sqlite", "SELECT count(*) FROM moz_places"),
            "addons": sorted(a["id"] for a in addons if a.get("location") == "app-profile" and a.get("active")),
            "rustLoginsActive": rust.group(1) == "true" if rust else None}


def installer_user_js(profile: Path) -> str:
    """The user.js install.sh writes: the template plus kitsune.migrations.* marks."""
    template = (ROOT / "install/user.js").read_text()
    old = (profile / "user.js").read_text().splitlines() if (profile / "user.js").exists() else []
    keep = [line for line in old if line.startswith('user_pref("kitsune.migrations.')]
    return template.rstrip("\n") + "\n" + ("\n".join(keep) + "\n" if keep else "")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", type=Path, default=DEFAULT_PROFILE)
    parser.add_argument("--browser", type=Path, default=DEFAULT_BROWSER)
    parser.add_argument("--mode", choices=("estricto", "comodo"), default="estricto")
    args = parser.parse_args()
    profile, browser = args.profile.resolve(strict=True), args.browser.resolve(strict=True)
    if engine.profile_in_use(profile):
        sys.exit("El perfil está abierto: cierra Kitsune antes de probar la actualización en una copia.")
    report = {"before": before(profile)}
    work = Path(tempfile.mkdtemp(prefix="kitsune-upgrade-trial-", dir=Path.home() / ".cache"))
    try:
        copy = work / "profile"
        shutil.copytree(profile, copy, symlinks=True, ignore=shutil.ignore_patterns("lock", ".parentlock"))
        (copy / "user.js").write_text(installer_user_js(profile))
        report["after"], _ = run_chrome_script(browser, PROBE, {"KITSUNE_PRIVACY_MODE": args.mode},
                                               user_prefs=HARNESS, asynchronous=True, profile_dir=copy)
        report["afterFiles"] = {"logins.json": (copy / "logins.json").is_file(),
                                "compatibility": re.search(r"(?m)^LastVersion=(.*)$",
                                                           (copy / "compatibility.ini").read_text()).group(1)}
    finally:
        shutil.rmtree(work, ignore_errors=True)
    b, a = report["before"], report["after"]
    if "error" in a:
        sys.exit(json.dumps(report, indent=2, ensure_ascii=False))
    problems = []
    if a["logins"] != b["logins"]:
        problems.append(f"contraseñas {b['logins']} → {a['logins']}")
    if a["history"] < b["history"]:
        problems.append(f"historial {b['history']} → {a['history']}")
    missing = sorted(set(b["addons"]) - {x["id"] for x in a["addons"] if x["active"]})
    if missing:
        problems.append(f"extensiones inactivas o perdidas: {missing}")
    if a["privacyActive"] != args.mode or a["privacyApplied"] != args.mode:
        problems.append(f"modo {a['privacyActive']}/{a['privacyApplied']}")
    report["problems"] = problems
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())

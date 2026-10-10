#!/usr/bin/env python3
"""Inventario de rastros de Mozilla/Firefox en Kitsune (perfil temporal, motor real).

1. Conexiones: arranca el motor con los servicios de fondo tal cual (sin los ajustes
   que el arnés de pruebas apaga) y anota cada nombre de host que resuelve durante
   --idle segundos y mientras recorre las páginas.
2. Texto visible: recorre las páginas internas, la ventana «Acerca de» y los menús y
   apunta cada texto o etiqueta visible que diga Mozilla o Firefox.

Escribe un informe JSON; `--check` falla si queda algo fuera de lo permitido
(ALLOWED_HOSTS para dependencias necesarias, ALLOWED_TEXT para avisos legales).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_smoke import WebDriver, prepare_profile  # noqa: E402

MOZILLA_HOST = re.compile(r"(^|\.)(mozilla\.(org|net|com)|firefox\.com|mozaws\.net|mozgcp\.net|mozilla\.cloud|getpocket\.com|cdn\.mozilla\.net)$")
# Dependencias que se quedan a propósito (ver README): extensiones (tienda, firmas,
# actualizaciones y lista de bloqueo), seguridad (revocación de certificados y listas
# de Remote Settings, listas de rastreadores), códecs de vídeo (OpenH264/Widevine).
ALLOWED_HOSTS = re.compile(
    r"^(addons\.mozilla\.org|services\.addons\.mozilla\.org|addons\.cdn\.mozilla\.net|"
    r"firefox\.settings\.services\.mozilla\.com|firefox-settings-attachments\.cdn\.mozilla\.net|"
    r"content-signature-2\.cdn\.mozilla\.net|shavar\.services\.mozilla\.com|tracking-protection\.cdn\.mozilla\.net|"
    r"versioncheck-bg\.addons\.mozilla\.org|aus5\.mozilla\.org|redirector\.gvt1\.com|ciscobinary\.openh264\.org)$")
WORDS = re.compile(r"mozilla|firefox|pocket", re.I)
# Se quedan: about:license (avisos legales de la licencia MPL del código) y
# about:support (página técnica de diagnóstico: agente de usuario e identificadores
# internos, necesarios para la compatibilidad).
ALLOWED_TEXT = re.compile(r"^(about:license|about:support)$")
# Internos o necesarios: enlaces addons://detail/<id> a vistas de about:addons y el
# de la tienda de extensiones (rotulado «extension store»), dependencia de las extensiones.
INTERNAL = re.compile(r"^\[link\] (addons://|https://addons\.mozilla\.org/[a-zA-Z-]+/firefox/$)")
PAGES = ["about:preferences", "about:preferences#home", "about:preferences#search", "about:preferences#privacy",
         "about:preferences#sync",
         "about:addons", "addons://list/extension", "addons://list/theme", "about:protections", "about:privatebrowsing",
         "about:logins", "about:downloads", "about:policies", "about:newtab", "about:welcome", "about:support", "about:license"]
# Páginas sin ninguna entrada en la interfaz: se comprueba que su acceso esté oculto.
HIDDEN_ENTRIES = """const w = window, v = el => !!el && !el.hidden && w.getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
return {firefoxView: v(document.getElementById('firefox-view-button')),
  account: v(document.getElementById('fxa-toolbar-menu-button')),
  discoverPref: Services.prefs.getBoolPref('extensions.getAddons.showPane', true)};"""

VISIBLE_TEXT = r"""
const words = /mozilla|firefox|pocket/i, found = new Set();
const visible = el => { if (!el || !el.getClientRects || !el.getClientRects().length) return false;
  const s = el.ownerDocument.defaultView.getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none'; };
function walk(root) {
  const tree = root.ownerDocument ? root : root;
  const iter = (root.ownerDocument || root).createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node = iter.currentNode; node; node = iter.nextNode()) {
    if (node.nodeType === 3) { const t = node.data.trim(); if (t && words.test(t) && visible(node.parentElement)) found.add(t.slice(0, 160)); continue; }
    for (const attr of ['label', 'tooltiptext', 'title', 'aria-label', 'placeholder', 'value', 'heading', 'description']) {
      const v = node.getAttribute?.(attr); if (v && words.test(v) && visible(node)) found.add(`[${attr}] ${v.slice(0, 160)}`);
    }
    if (node.shadowRoot) walk(node.shadowRoot);
    if (node.localName === 'a' && /mozilla|firefox/i.test(node.href || '') && visible(node)) found.add(`[link] ${node.href.slice(0, 160)}`);
  }
}
walk(document.documentElement);
return [...found];
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", type=Path, default=Path.home() / ".local/share/kitsune-browser/engine/current/kitsune")
    parser.add_argument("--idle", type=int, default=75, help="segundos en reposo para ver los servicios de fondo")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix="kitsune-mozilla-audit-"))
    evidence = root / "evidence"; evidence.mkdir()
    profile, _ = prepare_profile(root)
    with (profile / "user.js").open("a") as prefs:
        # Sin los ajustes recomendados de Marionette, que apagan servicios de fondo.
        prefs.write('user_pref("remote.prefs.recommended", false);\n')
        # Como un perfil real: su inicio local es la página de inicio (y la ayuda de Kitsune).
        prefs.write('user_pref("browser.startup.homepage", "http://127.0.0.1:49721/");\n')
    log = root / "dns.log"
    browser = args.browser.resolve(strict=True)
    # 1. Conexiones de fondo: el motor solo, sin automatización, en reposo.
    quiet = root / "reposo"
    shutil.copytree(profile, quiet)
    env = {**os.environ, "MOZ_LOG": "nsHostResolver:5", "MOZ_LOG_FILE": str(log)}
    engine = subprocess.Popen([str(browser), "--headless", "--no-remote", "--profile", str(quiet), "about:blank"],
                              env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        engine.wait(timeout=args.idle)
    except subprocess.TimeoutExpired:
        engine.terminate()
        engine.wait(timeout=20)
    # 2. Texto visible en las páginas y menús.
    driver = WebDriver(profile, evidence, browser=browser)
    report = {"browser": str(browser), "texts": {}, "hosts": []}
    try:
        for page in PAGES:
            url = page if page.startswith("about:") else "about:addons"
            try:
                driver.navigate(url)
            except RuntimeError as error:
                report["texts"][page] = [f"(no se pudo abrir: {str(error)[:120]})"]
                continue
            driver.context("content")
            if not page.startswith("about:"):
                driver.script("window.wrappedJSObject.loadView?.(arguments[0])", [page])
            time.sleep(2.5)
            try:
                texts = driver.script("return (function(){" + VISIBLE_TEXT + "})();")
            except RuntimeError as error:
                texts = [f"(error al leer: {str(error)[:120]})"]
            if texts:
                report["texts"][page] = texts
        driver.context("chrome")
        report["texts"]["(ventana del navegador)"] = driver.script("return (function(){" + VISIBLE_TEXT + "})();")
        driver.script("""for (const id of ['menu_HelpPopup','appMenu-popup']) { const m=document.getElementById(id); }
          window.openAboutDialog();""")
        time.sleep(3)
        report["texts"]["(Acerca de)"] = driver.script("""const w=Services.wm.getMostRecentWindow('Browser:About'); if(!w) return ['(sin ventana)'];
          const document=w.document; return (function(){""" + VISIBLE_TEXT + "})();")
        # El menú se abre de verdad: con el menú cerrado sus entradas no tienen estilo calculado.
        help_items = driver.script("""const done = arguments[arguments.length - 1];
          const popup = document.getElementById('menu_HelpPopup'); if (!popup) return done([]);
          popup.addEventListener('popupshown', () => {
            const items = [...popup.querySelectorAll('menuitem')].filter(m => m.getBoundingClientRect().height > 0).map(m => m.label);
            popup.hidePopup(); done(items);
          }, {once: true});
          document.getElementById('helpMenu').openMenu(true);""", asynchronous=True)
        report["helpMenu"] = help_items
        report["hiddenEntries"] = driver.script(HIDDEN_ENTRIES)
    finally:
        driver.close()
    hosts = set()
    for path in root.glob("dns.log*"):
        for match in re.finditer(r"host \[?([a-z0-9.-]+\.[a-z]{2,})", path.read_text(errors="replace"), re.I):
            hosts.add(match.group(1).lower().rstrip("."))
    report["hosts"] = sorted(hosts)
    report["mozillaHosts"] = sorted(h for h in hosts if MOZILLA_HOST.search(h))
    report["unexpectedHosts"] = sorted(h for h in report["mozillaHosts"] if not ALLOWED_HOSTS.match(h))
    report["unexpectedTexts"] = {page: kept for page, texts in report["texts"].items() if not ALLOWED_TEXT.match(page)
                                 if (kept := [t for t in texts if not INTERNAL.match(t)])}
    report["unexpectedHelp"] = [item for item in report.get("helpMenu", []) if re.search(r"Get Help|Feedback|Broken Site|New Device|Share|Deceptive", item or "")]
    report["unexpectedEntries"] = [name for name, shown in report.get("hiddenEntries", {}).items() if shown]
    out = args.out or evidence / "mozilla-audit.json"
    out.write_text(json.dumps(report, indent=1, ensure_ascii=False))
    print(json.dumps({"hosts": report["mozillaHosts"], "unexpectedHosts": report["unexpectedHosts"],
                      "unexpectedTexts": report["unexpectedTexts"], "helpMenu": report.get("helpMenu"),
                      "unexpectedHelp": report["unexpectedHelp"], "unexpectedEntries": report["unexpectedEntries"],
                      "report": str(out)}, indent=1, ensure_ascii=False))
    if args.check and (report["unexpectedHosts"] or report["unexpectedTexts"] or report["unexpectedHelp"] or report["unexpectedEntries"]):
        sys.exit(1)


if __name__ == "__main__":
    main()

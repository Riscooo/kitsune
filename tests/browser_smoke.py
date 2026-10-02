#!/usr/bin/env python3
"""Native LibreWolf smoke tests, isolated from the user's browser profile.

Uses Mozilla's WebDriver implementation against a newly created temporary
profile. The privileged chrome context is enabled only for that test instance.
No existing cookies, history, passwords, extensions or browser state are copied.
"""

from __future__ import annotations

import argparse
import base64
import contextlib
import http.server
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DRIVER = ROOT / "tools/geckodriver-0.37.1/geckodriver"
DEFAULT_BROWSER = Path("/usr/lib/librewolf/librewolf")


def unused_port() -> int:
    with socket.socket() as candidate:
        candidate.bind(("127.0.0.1", 0))
        return candidate.getsockname()[1]


def eventually(test, timeout=20, interval=0.1):
    deadline = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < deadline:
        try:
            value = test()
            if value:
                return value
        except (OSError, AssertionError, RuntimeError) as error:
            last_error = error
        time.sleep(interval)
    raise AssertionError(f"Condition not met in {timeout}s; last error: {last_error}")


class WebDriver:
    def __init__(self, profile: Path, evidence: Path, browser=DEFAULT_BROWSER,
                 driver=DEFAULT_DRIVER, headed=False):
        self.profile = profile
        self.evidence = evidence
        self.session_id = None
        self.port = unused_port()
        self.log = (evidence / "geckodriver.log").open("a")
        self.process = subprocess.Popen(
            [str(driver), "--host", "127.0.0.1", "--port", str(self.port),
             "--allow-system-access", "--log", "info"],
            stdin=subprocess.DEVNULL, stdout=self.log, stderr=subprocess.STDOUT,
        )
        eventually(lambda: self.request("GET", "/status"), timeout=10)
        arguments = ["-no-remote", "-profile", str(profile)]
        if not headed:
            arguments.append("-headless")
        reply = self.request("POST", "/session", {
            "capabilities": {"alwaysMatch": {
                "browserName": "firefox",
                "pageLoadStrategy": "normal",
                "moz:firefoxOptions": {
                    "binary": str(browser), "args": arguments,
                    # geckodriver disables NewTab's Redux feeds by default.
                    # Undo that automation-only setting to test the real UI.
                    "prefs": {
                        "browser.newtabpage.activity-stream.testing.shouldInitializeFeeds": True,
                        # The driver otherwise weakens file-origin isolation.
                        # Keep production's protection in all source tests.
                        "security.fileuri.strict_origin_policy": True,
                    },
                },
            }},
        }, timeout=60)
        self.session_id = reply["sessionId"]
        self.capabilities = reply["capabilities"]
        self.command("POST", "/timeouts", {"script": 30000, "pageLoad": 30000, "implicit": 0})
        self.command("POST", "/window/rect", {"width": 1540, "height": 1000})

    def request(self, method, endpoint, payload=None, timeout=35):
        body = None if payload is None else json.dumps(payload).encode()
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{endpoint}", data=body,
            headers={"Content-Type": "application/json"}, method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                reply = json.load(response)
        except urllib.error.HTTPError as error:
            reply = json.load(error)
            raise RuntimeError(f"WebDriver {method} {endpoint}: {reply}") from error
        # Only HTTP error responses signal protocol failures. Successful script
        # results may legitimately contain an application-level "error" field.
        return reply.get("value")

    def command(self, method, endpoint, payload=None, timeout=35):
        return self.request(method, f"/session/{self.session_id}{endpoint}", payload, timeout)

    def context(self, value):
        self.command("POST", "/moz/context", {"context": value})

    def script(self, script, args=(), asynchronous=False):
        return self.command("POST", "/execute/async" if asynchronous else "/execute/sync",
                            {"script": script, "args": list(args)})

    def navigate(self, url):
        self.context("content")
        self.command("POST", "/url", {"url": url})

    def element(self, selector):
        return self.command("POST", "/element", {"using": "css selector", "value": selector})["element-6066-11e4-a52e-4f735466cecf"]

    def click(self, selector):
        self.command("POST", f"/element/{self.element(selector)}/click", {})

    def fill(self, selector, value):
        element = self.element(selector)
        self.command("POST", f"/element/{element}/clear", {})
        self.command("POST", f"/element/{element}/value", {"text": value})

    def settle(self):
        self.context("content")
        return self.script("""const done=arguments[arguments.length-1];
          Promise.all([document.fonts.ready,...document.getAnimations().filter(animation=>
            animation.effect?.getTiming().iterations !== Infinity).map(animation=>animation.finished.catch(()=>{}))])
          .then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>done(true))));""", asynchronous=True)

    def screenshot(self, filename, chrome=False):
        self.context("chrome" if chrome else "content")
        png = self.command("GET", "/screenshot")
        path = self.evidence / filename
        path.write_bytes(base64.b64decode(png))
        return str(path)

    def shortcut(self, key, modifiers=()):
        actions = [{"type": "keyDown", "value": modifier} for modifier in modifiers]
        actions.extend([{"type": "keyDown", "value": key}, {"type": "keyUp", "value": key}])
        actions.extend({"type": "keyUp", "value": modifier} for modifier in reversed(modifiers))
        self.command("POST", "/actions", {"actions": [{"type": "key", "id": "keyboard", "actions": actions}]})
        self.command("DELETE", "/actions")

    def close(self):
        if self.session_id:
            with contextlib.suppress(Exception):
                self.command("DELETE", "", timeout=20)
            self.session_id = None
        if self.process.poll() is None:
            self.process.terminate()
            with contextlib.suppress(subprocess.TimeoutExpired):
                self.process.wait(timeout=5)
        self.log.close()


def prepare_profile(test_root: Path):
    profile = test_root / "profile"
    profile.mkdir()
    downloads = test_root / "downloads"
    downloads.mkdir()
    for name in ("chrome", "start"):
        source = ROOT / name
        if source.is_dir():
            shutil.copytree(source, profile / name)
    preferences = {
        "browser.startup.page": 0,
        "browser.startup.homepage": "about:blank",
        "browser.shell.checkDefaultBrowser": False,
        "browser.sessionstore.resume_from_crash": False,
        "browser.sessionstore.interval": 1000,
        "browser.tabs.warnOnClose": False,
        "toolkit.legacyUserProfileCustomizations.stylesheets": True,
        "browser.download.folderList": 2,
        "browser.download.dir": str(downloads),
        "browser.download.useDownloadDir": True,
        "browser.helperApps.neverAsk.saveToDisk": "application/octet-stream,text/plain",
    }
    template = ROOT / "install/user.js"
    base_prefs = template.read_text() if template.is_file() else ""
    (profile / "user.js").write_text(base_prefs + "\n// Isolated test-only paths and startup.\n" + "\n".join(
        f"user_pref({json.dumps(key)}, {json.dumps(value)});"
        for key, value in preferences.items()
    ) + "\n")
    return profile, downloads


class FixtureHandler(http.server.BaseHTTPRequestHandler):
    PAYLOAD = b"Kitsune isolated browser download fixture.\n"

    def do_GET(self):
        if self.path.startswith("/download/"):
            payload = self.PAYLOAD
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Disposition", 'attachment; filename="kitsune-test.txt"')
        else:
            page = "Dos" if self.path.startswith("/two") else "Uno"
            payload = (f"<!doctype html><html lang='es'><meta charset='utf-8'>"
                       f"<title>Prueba {page}</title><h1>Página {page}</h1>"
                       "<a id='next' href='/two'>Siguiente</a>"
                       "<a id='download' href='/download/kitsune-test.txt'>Descargar prueba</a>"
                       "</html>").encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


PROBE_SEARCH = """
const done = arguments[arguments.length - 1];
(async () => {
  const {SearchService} = ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs');
  const search = SearchService;
  await search.init();
  done({serviceType: typeof search, classType: typeof SearchService,
    addUserEngine: search.addUserEngine.toString(), setDefault: search.setDefault.toString(),
    changeReasons: SearchService.CHANGE_REASON,
    engines: (await search.getEngines()).map(engine => ({name: engine.name, identifier: engine.identifier})),
    defaultEngine: (await search.getDefault()).name});
})().catch(error => done({error: String(error), stack: error.stack}));
"""


def search_scripts():
    module = (ROOT / "install/configure-search.mjs").as_uri()
    source = ("import {configureGoogleScript, inspectGoogleScript} from " + json.dumps(module)
              + "; console.log(JSON.stringify({configureGoogleScript, inspectGoogleScript}));")
    return json.loads(subprocess.check_output(["node", "--input-type=module", "-e", source], text=True))


def start_home_server(profile, state):
    module_path = ROOT / "install/home-server.py"
    spec = importlib.util.spec_from_file_location("kitsune_home_server_smoke", module_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    server = module.create_server(profile / "start", state, port=0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


def api_settings(origin):
    with urllib.request.urlopen(origin + "/api/settings", timeout=10) as response:
        return json.load(response)


def wait_start(driver):
    eventually(lambda: driver.script("return document.documentElement.dataset.ready === 'true'"))
    driver.settle()


def native_search_checks(driver, checks):
    scripts = search_scripts()
    driver.context("chrome")
    created = driver.script(scripts["configureGoogleScript"], asynchronous=True)
    assert created["ok"] and created["created"] and created["after"]["normal"]["name"] == "Google", created
    checks.append("Google instalado y seleccionado con la API nativa, normal y privado")
    driver.script("""
      const {SearchService:search}=ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs');
      search.getEngineByName('Google').changeUrl('text/html','https://www.google.com/search?{searchTerms}',null);
      Services.prefs.clearUserPref('kitsune.migrations.googleSearch.v2');
    """)
    repaired = driver.script(scripts["configureGoogleScript"], asynchronous=True)
    assert repaired["ok"] and repaired["repaired"] and not repaired["created"], repaired
    checks.append("Regresión de Google sin q=: URL reparada, consulta Unicode y símbolos conservados")
    result = driver.script("""
      const done=arguments[arguments.length-1];
      (async()=>{
        const {SearchService:s}=ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs');
        await s.setDefault(s.getEngineByName('Mojeek'),s.CHANGE_REASON.USER);
        await s.setDefaultPrivate(s.getEngineByName('Mojeek'),s.CHANGE_REASON.USER);
        return true;
      })().then(done,error=>done({error:String(error)}));
    """, asynchronous=True)
    assert result is True
    preserved = driver.script(scripts["configureGoogleScript"], asynchronous=True)
    assert preserved["alreadyApplied"] and preserved["after"]["normal"]["name"] == "Mojeek", preserved
    assert preserved["after"]["private"]["name"] == "Mojeek", preserved
    checks.append("La migración única respeta cambios posteriores del usuario")
    driver.script("Services.prefs.clearUserPref('kitsune.migrations.googleSearch.v2')")
    restored = driver.script(scripts["configureGoogleScript"], asynchronous=True)
    assert restored["ok"] and restored["after"]["normal"]["name"] == "Google"
    return {"created": created, "repaired": repaired, "userChoicePreserved": preserved}


def basic_native_checks(driver, downloads, checks):
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        driver.navigate(base + "/one")
        assert driver.script("return document.title") == "Prueba Uno"
        driver.script("document.getElementById('next').click()")
        eventually(lambda: driver.script("return document.title") == "Prueba Dos")
        driver.command("POST", "/back", {})
        assert driver.script("return document.title") == "Prueba Uno"
        driver.command("POST", "/forward", {})
        assert driver.script("return document.title") == "Prueba Dos"
        checks.append("Navegación real, enlaces, atrás y adelante")
        driver.script("document.getElementById('download').click()")
        downloaded = downloads / "kitsune-test.txt"
        eventually(lambda: downloaded.is_file() and downloaded.read_bytes() == FixtureHandler.PAYLOAD)
        checks.append("Descarga real íntegra de fixture local, fuera de Descargas del usuario")
        driver.context("chrome")
        count = driver.script("return gBrowser.tabs.length")
        driver.script("gBrowser.selectedTab = gBrowser.addTab(arguments[0], {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()});", [base + "/one"])
        eventually(lambda: driver.script("return gBrowser.tabs.length") == count + 1)
        eventually(lambda: driver.script("return gBrowser.selectedBrowser.currentURI.spec === arguments[0] && !gBrowser.selectedBrowser.webProgress.isLoadingDocument", [base + "/one"]))
        driver.script("gBrowser.removeTab(gBrowser.selectedTab)")
        eventually(lambda: driver.script("return gBrowser.tabs.length") == count)
        driver.shortcut("t", ["\ue009", "\ue008"])
        eventually(lambda: driver.script("return gBrowser.tabs.length") == count + 1)
        checks.append("Pestaña nativa nueva, cerrar y restaurar")
        ui = driver.script("""return ['back-button','forward-button','urlbar','downloads-button','PanelUI-menu-button'].map(id=>{
          const element=document.getElementById(id), r=element?.getBoundingClientRect();
          return {id,exists:!!element,width:r?.width||0,height:r?.height||0};
        });""")
        assert all(item["exists"] and item["width"] > 0 and item["height"] > 0 for item in ui), ui
        checks.append("Barra de direcciones, historial, descargas y menú nativos visibles")
        # Native tab creation/restoration does not update WebDriver's selected
        # browsing context. Explicitly activate the restored tab before any
        # following navigation or screenshot, otherwise it tests a hidden tab.
        driver.context("content")
        handles = driver.command("GET", "/window/handles")
        restored_handle = handles[-1]
        for handle in handles[:-1]:
            driver.command("POST", "/window", {"handle": handle})
            driver.command("DELETE", "/window")
        driver.command("POST", "/window", {"handle": restored_handle})
        return ui
    finally:
        server.shutdown()
        server.server_close()


def start_page_checks(driver, profile, checks, start_origin):
    start_page = profile / "start/index.html"
    if not start_page.is_file():
        return {"available": False, "reason": "Start-page source not present yet"}
    start_url = start_origin + "/index.html"
    driver.navigate(start_url)
    wait_start(driver)
    eventually(lambda: driver.script("return document.readyState") == "complete")
    driver.script("""const done=arguments[arguments.length-1];
      Promise.all([document.fonts.ready,...document.getAnimations().filter(animation=>
        animation.effect?.getTiming().iterations !== Infinity).map(animation=>animation.finished.catch(()=>{}))])
        .then(()=>done(true),error=>done({error:String(error)}));""", asynchronous=True)
    assert driver.script("return document.body.innerText.trim().length") > 100
    images = driver.script("return [...document.images].map(image=>({src:image.getAttribute('src'),complete:image.complete,width:image.naturalWidth}));")
    assert all(image["complete"] and image["width"] > 0 for image in images), images
    page = {"available": True, "title": driver.script("return document.title"), "images": images}
    page["interactiveElements"] = driver.script("""return [...document.querySelectorAll('a,button,input,select,textarea')].map(element=>({
      tag:element.tagName,id:element.id,type:element.type||null,text:element.innerText||element.getAttribute('aria-label')||element.placeholder||'',
      href:element.getAttribute('href'),name:element.name||null
    }));""")
    page["functionality"] = start_function_checks(driver, start_url, start_origin, checks)
    driver.settle()
    page["viewports"] = []
    for width, height in ((1540, 1000), (1024, 900), (390, 844)):
        if width < 450:
            # Headless Firefox's desktop chrome has a minimum width; relax only
            # that test window's CSS minimum to exercise actual 390px Gecko
            # media queries, never zoom or pretend a desktop view is mobile.
            driver.context("chrome")
            driver.script("""const done=arguments[arguments.length-1];
              document.documentElement.style.setProperty('min-width','0px','important');
              requestAnimationFrame(()=>requestAnimationFrame(()=>done(getComputedStyle(document.documentElement).minWidth)));""", asynchronous=True)
            driver.context("content")
        driver.command("POST", "/window/rect", {"width": width, "height": height})
        try:
            eventually(lambda: driver.script("return innerWidth === arguments[0]", [width]))
        except AssertionError as error:
            geometry = driver.script("return {innerWidth,innerHeight,outerWidth,outerHeight}")
            physical = driver.command("GET", "/window/rect")
            driver.screenshot(f"viewport-mismatch-{width}.png", chrome=True)
            native = driver.script("return {innerWidth,outerWidth,minWidth:getComputedStyle(document.documentElement).minWidth,rfp:Services.prefs.getBoolPref('privacy.resistFingerprinting'),fpp:Services.prefs.getBoolPref('privacy.fingerprintingProtection')}")
            raise AssertionError(f"Requested {width}x{height}, content {geometry}, physical {physical}, chrome {native}") from error
        driver.settle()
        metrics = driver.script("""return {width:innerWidth,height:innerHeight,
          contentWidth:document.documentElement.scrollWidth,contentHeight:document.documentElement.scrollHeight,
          ready:document.fonts.status === 'loaded'};""")
        assert metrics["contentWidth"] <= metrics["width"] + 1, metrics
        metrics["screenshot"] = driver.screenshot(f"start-{width}.png", chrome=True)
        page["viewports"].append(metrics)
        driver.context("content")
    checks.append("Inicio carga con recursos locales, sin desbordamiento horizontal en tres tamaños")
    driver.context("chrome")
    page["consoleMessages"] = driver.script("""return Services.console.getMessageArray().map(message=>({
      message:message.message,source:message.sourceName||'',flags:message.flags??null,category:message.category||''
    })).filter(message=>message.source.startsWith(arguments[0]));""", [start_origin])
    script_errors = [message for message in page["consoleMessages"]
                     if message["flags"] == 0 and "javascript" in message["category"].lower()]
    assert not script_errors, script_errors
    checks.append("Sin errores JavaScript del inicio en la consola nativa")
    driver.command("POST", "/window/rect", {"width": 1540, "height": 1000})
    return page


def start_function_checks(driver, start_url, start_origin, checks):
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        initial_count = driver.script("return document.querySelectorAll('#quick-links a').length")
        driver.click(".add-link")
        driver.click("#link-form button[type=submit]")
        assert driver.script("return !document.querySelector('#link-error').hidden")
        driver.fill("#link-name", "Prueba local")
        driver.fill("#link-url", "esto no es una dirección")
        driver.click("#link-form button[type=submit]")
        assert driver.script("return !document.querySelector('#link-error').hidden")
        driver.fill("#link-url", base + "/one")
        driver.click("#link-form button[type=submit]")
        eventually(lambda: driver.script("return document.querySelectorAll('#quick-links a').length") == initial_count + 1)
        driver.command("POST", "/refresh", {})
        wait_start(driver)
        assert driver.script("return [...document.querySelectorAll('#quick-links a')].some(link=>link.querySelector('.link-name').textContent==='Prueba local' && link.href===arguments[0])", [base + "/one"]), "New quick link was not persisted"
        driver.click("#edit-links")
        driver.click('[aria-label="Editar Prueba local"]')
        driver.fill("#link-name", "Destino local")
        driver.fill("#link-url", base + "/two")
        driver.click("#link-form button[type=submit]")
        eventually(lambda: not driver.script("return document.querySelector('#link-dialog').open"))
        driver.command("POST", "/refresh", {})
        wait_start(driver)
        assert driver.script("return [...document.querySelectorAll('#quick-links a')].some(link=>link.querySelector('.link-name').textContent==='Destino local' && link.href===arguments[0])", [base + "/two"]), "Edited quick link was not persisted"
        driver.click("#edit-links")
        driver.click('[aria-label="Editar Destino local"]')
        driver.click("#delete-link")
        eventually(lambda: len(api_settings(start_origin)["data"]["links"]) == initial_count)
        driver.command("POST", "/refresh", {})
        wait_start(driver)
        assert driver.script("return document.querySelectorAll('#quick-links a').length") == initial_count
        checks.append("Accesos: validación, añadir, editar, eliminar y persistir tras recarga")

        before_failure = api_settings(start_origin)
        driver.script("""const realFetch=window.fetch.bind(window);
          window.fetch=(input,options)=>options?.method==='PUT'
            ? Promise.resolve(new Response('{}',{status:503,headers:{'Content-Type':'application/json'}}))
            : realFetch(input,options);""")
        driver.click(".add-link")
        driver.fill("#link-name", "Fallo previsto de guardado")
        driver.fill("#link-url", "https://example.com/unsaved")
        driver.click("#link-form button[type=submit]")
        eventually(lambda: driver.script("return !document.querySelector('#link-error').hidden"))
        draft = driver.script("""return {open:document.querySelector('#link-dialog').open,
          name:document.querySelector('#link-name').value,error:document.querySelector('#link-error').textContent,
          cards:document.querySelectorAll('#quick-links a').length};""")
        assert draft["open"] and draft["name"] == "Fallo previsto de guardado" and draft["cards"] == initial_count, draft
        assert "No se ha confirmado" in draft["error"], draft
        after_failure = api_settings(start_origin)
        assert before_failure["data"] == after_failure["data"] and before_failure["revision"] == after_failure["revision"]
        driver.screenshot("save-error-preserves-draft.png", chrome=True)
        driver.context("content")
        driver.command("POST", "/refresh", {})
        wait_start(driver)
        assert driver.script("return document.querySelectorAll('#quick-links a').length") == initial_count
        checks.append("Fallo PUT 503: no crea una tarjeta falsa, conserva el borrador y muestra el error")

        driver.click("#edit-links")
        driver.click('[aria-label="Editar YouTube"]')
        driver.script("""const realFetch=window.fetch.bind(window);
          window.fetch=(input,options)=>options?.method==='PUT'
            ? Promise.resolve(new Response('{}',{status:503,headers:{'Content-Type':'application/json'}}))
            : realFetch(input,options);""")
        driver.click("#delete-link")
        eventually(lambda: driver.script("return !document.querySelector('#link-error').hidden"))
        assert driver.script("return document.querySelector('#link-dialog').open && [...document.querySelectorAll('#quick-links .link-name')].some(name=>name.textContent==='YouTube')")
        assert api_settings(start_origin)["revision"] == before_failure["revision"]
        driver.command("POST", "/refresh", {})
        wait_start(driver)
        checks.append("Fallo PUT 503 al eliminar: conserva el acceso y el estado confirmado")

        driver.click("#settings-open")
        for selector in ("#art-toggle", "#motion-toggle"):
            driver.click(selector)
        driver.click('button[data-accent="pink"]')
        driver.click('[data-settings-tab="navigation"]')
        driver.click("#newtab-toggle")
        driver.shortcut("\ue00c")
        eventually(lambda: driver.script("return !document.querySelector('#settings-dialog').open"))
        eventually(lambda: api_settings(start_origin)["data"]["accent"] == "pink")
        driver.command("POST", "/refresh", {})
        wait_start(driver)
        settings = driver.script("return {art:document.body.dataset.art,motion:document.body.dataset.motion,accent:document.body.dataset.accent,newTab:[...document.querySelectorAll('#quick-links a')].every(link=>link.target==='_blank' && link.rel.includes('noopener'))}")
        assert settings == {"art": "off", "motion": "off", "accent": "pink", "newTab": True}, settings
        driver.click("#focus-toggle")
        eventually(lambda: api_settings(start_origin)["data"]["focus"] is True)
        driver.command("POST", "/refresh", {})
        wait_start(driver)
        assert driver.script("return document.body.dataset.focus") == "on"
        driver.click("#focus-toggle")
        driver.click("#settings-open")
        driver.click('[data-settings-tab="appearance"]')
        for selector in ("#art-toggle", "#motion-toggle"):
            driver.click(selector)
        driver.click('button[data-accent="blue"]')
        driver.click('[data-settings-tab="navigation"]')
        driver.click("#newtab-toggle")
        driver.shortcut("\ue00c")
        eventually(lambda: api_settings(start_origin)["data"]["accent"] == "blue")
        checks.append("Preferencias, acento, apertura en pestaña y modo enfoque persistentes")

        driver.click(".clock-module")
        driver.shortcut("/")
        assert driver.script("return document.activeElement.id") == "query"
        driver.click("#help-open")
        assert driver.script("return document.querySelector('#help-dialog').open")
        driver.shortcut("\ue00c")
        eventually(lambda: driver.script("return !document.querySelector('#help-dialog').open"))
        driver.click(".add-link")
        driver.shortcut("\ue00c")
        eventually(lambda: driver.script("return !document.querySelector('#link-dialog').open"))
        checks.append("Atajo / enfoca búsqueda; Escape cierra los tres diálogos")

        # The installed file page uses a classic bundle because production's
        # strict file-origin policy intentionally rejects file ES modules.
        # Verify pure URL construction in its source module, and native page
        # mode controls through real WebDriver clicks.
        module = (ROOT / "start/navigation.mjs").as_uri()
        source = ("import {resolveNavigation} from " + json.dumps(module)
                  + "; console.log(JSON.stringify(['all','images','videos','maps'].map(mode=>({mode,...resolveNavigation('Kitsune café & anime',mode)}))));")
        submissions = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", source], text=True))
        for submission in submissions:
            driver.click(f'button[data-mode="{submission["mode"]}"]')
            assert driver.script("return document.querySelector('button[data-mode=" + json.dumps(submission["mode"]) + "]').getAttribute('aria-pressed')") == "true"
            url = urlparse(submission["url"])
            params = parse_qs(url.query)
            assert url.scheme == "https" and url.hostname == "www.google.com", submission
            assert params["query" if submission["mode"] == "maps" else "q"] == ["Kitsune café & anime"], submission
        checks.append("Búsqueda Google, imágenes, vídeos y mapas conservan Unicode y símbolos")
        driver.fill("#query", base + "/two")
        driver.click("#search-form button[type=submit]")
        eventually(lambda: driver.script("return document.title") == "Prueba Dos")
        assert driver.command("GET", "/url") == base + "/two"
        checks.append("La caja de inicio navega a una URL HTTP local real")
        driver.navigate(start_url)
        wait_start(driver)
        return {"initialLinks": initial_count, "settingsPersisted": settings, "searchSubmissions": submissions}
    finally:
        server.shutdown()
        server.server_close()


def native_visual_checks(driver):
    driver.navigate("about:newtab")
    eventually(lambda: driver.script("return document.readyState") == "complete")
    eventually(lambda: driver.script("return (document.querySelector('.search-wrapper')?.getBoundingClientRect().height || 0) > 0"))
    driver.script("""const done=arguments[arguments.length-1];
      Promise.all(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations !== Infinity)
        .map(animation=>animation.finished.catch(()=>{}))).then(()=>done(true));""", asynchronous=True)
    search_ui = driver.script("""const element=document.querySelector('content-search-handoff-ui');
      return {html:element?.outerHTML||'',shadow:element?.shadowRoot?.innerHTML||'',body:document.body.innerText};""")
    captures = {"newTabSearch": search_ui, "newTab": driver.screenshot("native-newtab.png", chrome=True)}
    driver.script("document.getElementById('PanelUI-menu-button').click()")
    eventually(lambda: driver.script("return [...document.querySelectorAll('panel')].some(panel=>panel.id.includes('appMenu') && panel.state==='open')"))
    captures["menu"] = driver.screenshot("native-menu.png", chrome=True)
    driver.shortcut("\ue00c")
    return captures


def online_google_check(driver):
    driver.command("POST", "/window/rect", {"width": 1540, "height": 1000})
    driver.context("chrome")
    driver.fill("#urlbar-input", "Kitsune navegador prueba")
    driver.shortcut("\ue007")
    driver.context("content")
    eventually(lambda: "google.com" in driver.command("GET", "/url"), timeout=25)
    eventually(lambda: driver.script("return document.readyState") == "complete", timeout=25)
    try:
        eventually(lambda: driver.script("return document.body?.innerText.trim().length > 100"), timeout=25)
    except AssertionError:
        pass
    url = driver.command("GET", "/url")
    title = driver.script("return document.title")
    text = driver.script("return document.body.innerText.slice(0,1500)")
    if "/sorry/" in url or "unusual traffic" in text.lower() or "tráfico inusual" in text.lower():
        status = "challenge"
    elif "consent.google.com" in url or "before you continue" in text.lower() or "antes de ir a google" in text.lower():
        status = "consent"
    else:
        status = "response" if len(text.strip()) > 100 else "no-content"
    return {"query": "Kitsune navegador prueba", "url": url, "title": title,
            "status": status, "textLength": len(text), "screenshot": driver.screenshot("google-native-query.png", chrome=True)}


def restart_retention_check(driver, profile, evidence, start_origin, options, checks):
    start_url = start_origin + "/index.html"
    driver.navigate(start_url)
    wait_start(driver)
    driver.click(".add-link")
    driver.fill("#link-name", "Conservado tras reinicio")
    driver.fill("#link-url", "https://example.com/")
    driver.click("#link-form button[type=submit]")
    eventually(lambda: not driver.script("return document.querySelector('#link-dialog').open"))
    driver.click("#settings-open")
    driver.click("#motion-toggle")
    driver.click('button[data-accent="pink"]')
    driver.shortcut("\ue00c")
    eventually(lambda: api_settings(start_origin)["data"]["accent"] == "pink")
    before = api_settings(start_origin)
    assert any(link["name"] == "Conservado tras reinicio" for link in before["data"]["links"])

    other_file = profile / "privacy-fixture.html"
    other_file.write_text("<!doctype html><title>Privacy fixture</title><p>Disposable local test</p>")
    driver.navigate(other_file.as_uri())
    driver.script("localStorage.setItem('kitsune-privacy-fixture','local-file')")
    other_server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
    threading.Thread(target=other_server.serve_forever, daemon=True).start()
    other_url = f"http://127.0.0.1:{other_server.server_port}/one"
    try:
        driver.navigate(other_url)
        driver.script("localStorage.setItem('kitsune-privacy-fixture','other-site')")
        driver.context("chrome")
        protections = driver.script("""return {sanitizeOnShutdown:Services.prefs.getBoolPref('privacy.sanitize.sanitizeOnShutdown'),
          strictFileOrigins:Services.prefs.getBoolPref('security.fileuri.strict_origin_policy'),
          signaturesRequired:Services.prefs.getBoolPref('xpinstall.signatures.required')};""")
        assert all(protections.values()), protections
        driver.close()
        after_close = api_settings(start_origin)
        assert after_close["data"] == before["data"] and after_close["revision"] == before["revision"]
        driver = WebDriver(profile, evidence, options.browser, options.driver, options.headed)
        driver.navigate(start_url)
        wait_start(driver)
        restored = driver.script("""return {accent:document.body.dataset.accent,motion:document.body.dataset.motion,
          link:[...document.querySelectorAll('#quick-links .link-name')].some(name=>name.textContent==='Conservado tras reinicio')};""")
        assert restored == {"accent": "pink", "motion": "off", "link": True}, restored
        driver.navigate(other_file.as_uri())
        file_after = driver.script("return localStorage.getItem('kitsune-privacy-fixture')")
        driver.navigate(other_url)
        site_after = driver.script("return localStorage.getItem('kitsune-privacy-fixture')")
        assert file_after is None and site_after is None, {"file": file_after, "site": site_after}
        checks.append("Accesos y preferencias sobreviven al cierre completo del navegador")
        checks.append("La limpieza privada de otros sitios y archivos sigue activa tras reiniciar")
        driver.navigate(start_url)
        wait_start(driver)
        return driver, {"beforeRevision": before["revision"], "afterRevision": after_close["revision"],
                        "restoredUI": restored, "otherFileAfter": file_after, "otherSiteAfter": site_after,
                        "protections": protections}
    except Exception:
        driver.close()
        raise
    finally:
        other_server.shutdown()
        other_server.server_close()


def strict_file_fallback_check(driver, profile, start_origin, checks):
    driver.navigate((profile / "start/index.html").as_uri())
    wait_start(driver)
    assert driver.script("return document.querySelectorAll('#quick-links a').length") > 0
    driver.fill("#query", start_origin + "/index.html")
    driver.click("#search-form button[type=submit]")
    eventually(lambda: driver.command("GET", "/url") == start_origin + "/index.html")
    wait_start(driver)
    checks.append("Inicio file:// de reserva funcional sin relajar el aislamiento de archivos")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--probe", action="store_true", help="Probe environment and native search API only")
    parser.add_argument("--online", action="store_true", help="Send one harmless Google query through the native address bar")
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--browser", type=Path, default=DEFAULT_BROWSER)
    parser.add_argument("--driver", type=Path, default=DEFAULT_DRIVER)
    parser.add_argument("--evidence", type=Path)
    options = parser.parse_args()
    test_root = Path(tempfile.mkdtemp(prefix="kitsune-browser-smoke-"))
    evidence = options.evidence.resolve() if options.evidence else test_root / "evidence"
    evidence.mkdir(parents=True, exist_ok=True)
    profile, downloads = prepare_profile(test_root)
    report = {"testRoot": str(test_root), "profile": str(profile), "evidence": str(evidence), "checks": []}
    driver = None
    home_server = None
    try:
        start_origin = None
        if not options.probe:
            home_server, start_origin = start_home_server(profile, test_root / "home-state.json")
            report["startOrigin"] = start_origin
        driver = WebDriver(profile, evidence, options.browser, options.driver, options.headed)
        report["browserVersion"] = driver.capabilities["browserVersion"]
        driver.context("chrome")
        report["nativeSearchProbe"] = driver.script(PROBE_SEARCH, asynchronous=True)
        assert not report["nativeSearchProbe"].get("error"), report["nativeSearchProbe"]
        report["chromeScreenshot"] = driver.screenshot("native-chrome.png", chrome=True)
        if not options.probe:
            report["nativeSearchTests"] = native_search_checks(driver, report["checks"])
            driver.close()
            driver = WebDriver(profile, evidence, options.browser, options.driver, options.headed)
            driver.context("chrome")
            report["searchAfterRestart"] = driver.script(search_scripts()["inspectGoogleScript"], asynchronous=True)
            assert report["searchAfterRestart"]["normal"]["name"] == "Google", report["searchAfterRestart"]
            assert report["searchAfterRestart"]["private"]["name"] == "Google", report["searchAfterRestart"]
            report["checks"].append("Google persiste al cerrar y reiniciar LibreWolf")
            report["nativeUI"] = basic_native_checks(driver, downloads, report["checks"])
            report["nativeVisuals"] = native_visual_checks(driver)
            report["startPage"] = start_page_checks(driver, profile, report["checks"], start_origin)
            driver, report["restartRetention"] = restart_retention_check(driver, profile, evidence, start_origin, options, report["checks"])
            strict_file_fallback_check(driver, profile, start_origin, report["checks"])
            if options.online:
                report["onlineGoogle"] = online_google_check(driver)
                report["checks"].append("Consulta real desde la barra nativa enviada a Google")
        report["ok"] = True
    except Exception as error:
        report["ok"] = False
        report["error"] = str(error)
        raise
    finally:
        if driver:
            driver.close()
        if home_server:
            home_server.shutdown()
            home_server.server_close()
        (evidence / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()

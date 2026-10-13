#!/usr/bin/env python3
"""Profile UI against the real loopback API, using disposable data only.

The launcher callback only records requests. No real profile is opened, no
account is contacted, and no operating-system service is installed or changed.
"""
from __future__ import annotations

import argparse
import contextlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import threading
import sys

from browser_smoke import DEFAULT_BROWSER, ROOT, WebDriver, eventually, prepare_profile, wait_start


def load_home():
    spec = importlib.util.spec_from_file_location("kitsune_profiles_ui_home", ROOT / "install/home-server.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=DEFAULT_BROWSER)
    parser.add_argument('--evidence', type=Path)
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix="kitsune-profiles-ui-"))
    evidence = args.evidence.absolute() if args.evidence else root / "evidence"
    evidence.mkdir(parents=True, exist_ok=True)
    profile, _ = prepare_profile(root)
    browser_data = root / "browser-data"
    templates = browser_data / "templates"
    templates.mkdir(parents=True)
    shutil.copyfile(ROOT / "install/user.js", templates / "user.js")
    shutil.copytree(ROOT / "chrome", templates / "chrome")
    launches = []
    home = load_home()
    manager = home.profiles_module.ProfileManager(browser_data, root / "state", launch=lambda identifier, action: launches.append((identifier, action)))
    initial = manager.snapshot()
    work = manager.create("Trabajo", "", "teal", initial["revision"])
    manager.create("Otro universo", "", "pink", work["revision"])
    appearance = home.make_appearance(browser_data, root / "state", 'default')
    server = home.create_server(profile / "start", root / "state/home.json", port=0, profiles=manager, appearance=appearance)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    driver = None
    second_server = None
    checks = []
    report = {"isolatedRoot": str(root), "origin": origin, "checks": checks, "launchesAreMocked": True}

    def js(source, *args):
        driver.context("content")
        return driver.script(source, args)

    def idle():
        eventually(lambda: js("return document.querySelector('#profiles-dialog').getAttribute('aria-busy')==='false'"))

    def open_users():
        # El avatar abre la tarjeta de usuarios; «Gestionar usuarios», la ventana grande.
        driver.click("#profiles-open")
        eventually(lambda: js("return document.querySelector('#users-card').matches(':popover-open')"))
        driver.click("#users-manage")
        eventually(lambda: js("return document.querySelector('#profiles-dialog').open"))
        idle()

    def get_snapshot():
        return manager.snapshot()

    def capture(name):
        driver.settle()
        path = driver.screenshot(name, chrome=True)
        driver.context("content")
        return path

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        driver.navigate(origin + "/")
        wait_start(driver)
        eventually(lambda: js("return document.documentElement.dataset.profilesReady==='true'"))
        assert js("return document.querySelector('#current-profile-name').textContent") == "Personal"
        report["home"] = capture("profiles-home-1540.png")
        driver.click("#profiles-open")
        eventually(lambda: js("return document.querySelector('#users-card').matches(':popover-open')"))
        assert js("return document.querySelector('#users-card-hello').textContent") == "Hola, Personal"
        assert js("return [...document.querySelectorAll('#users-card [data-user-id] b')].map(b => b.textContent)") == ["Trabajo", "Otro universo"]
        report["card"] = capture("users-card-1540.png")
        driver.shortcut("\ue00c")
        eventually(lambda: js("return !document.querySelector('#users-card').matches(':popover-open')"))
        checks.append("The avatar opens a Google-like card: this tab's user on top, the others below")
        open_users()
        assert js("return document.querySelectorAll('[data-profile-id]').length") == 3
        assert js("return document.querySelector('#profiles-dialog').open")
        assert js("return document.querySelector('#profile-current-badge').hidden") is False
        assert js("return document.querySelector('#profile-default-badge').hidden") is False
        checks.append("Loads real local registry, current avatar and default/current badges")
        driver.shortcut("\ue00c")
        eventually(lambda: js("return !document.querySelector('#profiles-dialog').open"))
        assert js("return document.activeElement.id") == "profiles-open"
        open_users()
        checks.append("Escape closes the native dialog and restores trigger focus")

        driver.click("#profile-create")
        assert js("return document.activeElement.id") == "profile-name"
        driver.click("#profile-save")
        assert js("return !document.querySelector('#profile-form-error').hidden")
        driver.fill("#profile-name", "Estudio 月")
        driver.fill("#profile-email", "correo inválido")
        driver.click("#profile-save")
        assert js("return !document.querySelector('#profile-form-error').hidden")
        driver.fill("#profile-email", "estudio@example.com")
        driver.click('[data-profile-swatch="violet"]')
        assert js("return document.querySelector('#profile-preview-avatar').textContent") == "E月"
        assert js("return document.querySelector('#profile-preview-avatar').dataset.profileColor") == "violet"
        before = len(get_snapshot()["profiles"])
        pending = js("document.querySelector('#profile-save').click();document.querySelector('#profile-save').click();return {save:document.querySelector('#profile-save').disabled,name:document.querySelector('#profile-name').disabled,create:document.querySelector('#profile-create').disabled}")
        assert pending == {"save": True, "name": True, "create": True}, pending
        idle()
        eventually(lambda: js("return document.querySelector('#profile-form').hidden"))
        created = next(item for item in get_snapshot()["profiles"] if item["name"] == "Estudio 月")
        assert len(get_snapshot()["profiles"]) == before + 1
        assert created["email"] == "estudio@example.com" and created["color"] == "violet"
        assert not manager.resolve(created["id"], initialize=False)["profile"].exists(), "A user lives in the base profile"
        assert launches == [], "Creating a profile must not open it implicitly"
        checks.append("Create validates, previews Unicode/color, adds a user without a Gecko folder and prevents double submit")

        driver.click("#profile-edit")
        driver.fill("#profile-name", "Estudio nocturno")
        driver.fill("#profile-email", "noche@example.com")
        driver.click('[data-profile-swatch="amber"]')
        server_state = get_snapshot()
        manager.edit("default", "Personal · Luna", "", "blue", server_state["revision"])
        driver.click("#profile-save")
        idle()
        assert js("return document.querySelector('#profile-name').value") == "Estudio nocturno"
        assert js("return document.querySelector('#profile-email').value") == "noche@example.com"
        assert js("return document.querySelector('[data-profile-swatch=amber]').getAttribute('aria-pressed')") == "true"
        assert js("return !document.querySelector('#profile-form').hidden")
        assert "Otra pestaña" in js("return document.querySelector('#profiles-message').textContent")
        assert next(item for item in get_snapshot()["profiles"] if item["id"] == created["id"])["name"] == "Estudio 月"
        driver.click("#profile-save")
        idle()
        assert js("return document.querySelector('#profile-detail-name').textContent") == "Estudio nocturno"
        assert js("return document.querySelector('#current-profile-name').textContent") == "Personal · Luna"
        checks.append("409 conflict refreshes registry without losing typed name/email/color; explicit retry succeeds")

        # La ficha de otro usuario: se cambia en esta pestaña; Google solo desde su pestaña y la privacidad es de la base.
        assert js("return document.querySelector('#profile-current-badge').hidden") is True
        assert js("return document.querySelector('#profile-default-badge').hidden") is True
        assert js("return !document.querySelector('#profile-open').hidden && document.querySelector('#profile-open').textContent.includes('Cambiar a este usuario')")
        assert js("return document.querySelector('[data-profile-action=google]').hidden && document.querySelector('.privacy-switch').hidden")
        driver.click('[data-profile-action="passwords"]')
        idle()
        assert launches == [("default", "passwords")], launches
        assert js("return !document.querySelector('.profile-sync-guide') && !/Firefox|Mozilla/.test(document.querySelector('#profiles-dialog').innerText)")
        assert js("return document.querySelector('#current-profile-name').textContent") == "Personal · Luna"
        driver.click('[data-profile-id="default"]')
        assert js("return document.querySelector('#profile-open').hidden && !document.querySelector('.privacy-switch').hidden")
        assert js("return !document.querySelector('[data-profile-action=google]').hidden && !document.querySelector('#profile-default-badge').hidden")
        driver.click(f'[data-profile-id="{created["id"]}"]')
        checks.append("Another user's card switches this tab; Google only from its own tab; privacy only on the base user; passwords for all of Kitsune; no Sync or Mozilla")
        report["manager"] = capture("profiles-manager-1540.png")

        driver.click("#profile-create")
        driver.fill("#profile-name", "Mi borrador intacto")
        driver.fill("#profile-email", "borrador@example.com")
        driver.click('[data-profile-swatch="red"]')
        before = get_snapshot()
        js("""window.profilesRealFetch=window.fetch.bind(window);
          window.fetch=(input,options)=>String(input).startsWith('/api/profiles') && ['POST','PATCH'].includes(options?.method)
            ? Promise.resolve(new Response('{}',{status:503,headers:{'Content-Type':'application/json'}}))
            : window.profilesRealFetch(input,options);""")
        driver.click("#profile-save")
        idle()
        assert js("return document.querySelector('#profile-name').value") == "Mi borrador intacto"
        assert js("return document.querySelector('#profile-save').disabled")
        assert get_snapshot() == before
        report["errorDraft"] = capture("profiles-error-draft-1540.png")
        js("window.fetch=window.profilesRealFetch")
        driver.click("#profiles-reload")
        idle()
        assert js("return document.querySelector('#profile-name').value") == "Mi borrador intacto"
        assert js("return document.querySelector('#profile-email').value") == "borrador@example.com"
        assert js("return document.querySelector('[data-profile-swatch=red]').getAttribute('aria-pressed')") == "true"
        assert js("return !document.querySelector('#profile-save').disabled")
        driver.shortcut("\ue00c")
        open_users()
        assert js("return document.querySelector('#profile-name').value") == "Mi borrador intacto"
        driver.click("#profile-cancel")
        checks.append("503 preserves unsaved draft and confirmed registry; refresh and Escape/reopen keep the draft")

        driver.command("POST", "/refresh", {})
        wait_start(driver)
        eventually(lambda: js("return document.documentElement.dataset.profilesReady==='true'"))
        open_users()
        assert js("return document.querySelector('#current-profile-name').textContent") == "Personal · Luna"
        driver.click(f'[data-profile-id="{created["id"]}"]')
        assert js("return document.querySelector('#profile-detail-name').textContent") == "Estudio nocturno"
        checks.append("Edited user persists after page reload")

        # A second per-profile origin must identify itself, not the default.
        second_appearance = home.make_appearance(browser_data, root / "state", created["id"])
        second_server = home.create_server(profile / "start", root / "state/other-home.json", port=0, profiles=manager, current_id=created["id"], appearance=second_appearance)
        threading.Thread(target=second_server.serve_forever, daemon=True).start()
        second_origin = f"http://127.0.0.1:{second_server.server_port}"
        driver.navigate(second_origin + "/")
        wait_start(driver)
        eventually(lambda: js("return document.documentElement.dataset.profilesReady==='true'"))
        assert js("return document.querySelector('#current-profile-name').textContent") == "Estudio nocturno"
        assert js("return document.querySelector('#current-profile-avatar').dataset.profileColor") == "amber"
        open_users()
        assert js("return !document.querySelector('#profile-current-badge').hidden && document.querySelector('#profile-default-badge').hidden")
        checks.append("A second profile origin displays its own current identity independently")

        driver.context("chrome")
        driver.script("""const done=arguments[arguments.length-1];document.documentElement.style.setProperty('min-width','0px','important');requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));""", asynchronous=True)
        driver.context("content")
        driver.command("POST", "/window/rect", {"width": 390, "height": 844})
        eventually(lambda: js("return innerWidth===390"))
        driver.settle()
        metrics = js("""const d=document.querySelector('#profiles-dialog');return {viewport:innerWidth,
          pageWidth:document.documentElement.scrollWidth,dialogWidth:d.clientWidth,dialogScroll:d.scrollWidth,
          listWidth:document.querySelector('#profiles-list').clientWidth,listScroll:document.querySelector('#profiles-list').scrollWidth};""")
        assert metrics["pageWidth"] <= 391 and metrics["dialogScroll"] <= metrics["dialogWidth"] + 1, metrics
        assert metrics["listScroll"] <= metrics["listWidth"] + 1, metrics
        report["mobileMetrics"] = metrics
        js("document.querySelector('#profiles-dialog').scrollTop=0")
        report["mobileManager"] = capture("profiles-manager-390.png")
        driver.click("#profile-create")
        driver.fill("#profile-name", "新しい月のプロフィール")
        driver.fill("#profile-email", "luna@example.com")
        js("document.querySelector('#profile-form').scrollIntoView({block:'start'})")
        report["mobileEditor"] = capture("profiles-editor-390.png")
        assert js("return document.querySelector('#profiles-dialog').scrollWidth<=document.querySelector('#profiles-dialog').clientWidth+1")
        driver.click("#profile-cancel")
        driver.shortcut("\ue00c")
        assert js("return document.activeElement.id") == "profiles-open"
        report["mobileHome"] = capture("profiles-home-390.png")
        checks.append("390px layout, scrollable manager/editor, cancel and Escape remain usable without horizontal overflow")

        # Stress the documented maximum with real clean disposable profiles.
        state = get_snapshot()
        while len(state["profiles"]) < 24:
            count = len(state["profiles"])
            name = "L" * 48 if count == 23 else f"Espacio de prueba {count + 1}"
            email = "l" * 240 + "@example.com" if count == 23 else ""
            state = manager.create(name, email, home.profiles_module.COLORS[count % 6], state["revision"])
        open_users()
        assert js("return document.querySelectorAll('[data-profile-id]').length") == 24
        assert js("return document.querySelector('#profiles-count').textContent") == "24 / 24"
        assert js("return document.querySelector('#profile-create').disabled")
        driver.click(f'[data-profile-id="{state["createdId"]}"]')
        assert js("return document.querySelector('#profile-detail-name').textContent") == "L" * 48
        assert js("return document.querySelector('#profiles-dialog').scrollWidth<=document.querySelector('#profiles-dialog').clientWidth+1")
        assert js("return document.querySelector('#profiles-list').scrollHeight>document.querySelector('#profiles-list').clientHeight")
        report["maximumProfiles"] = capture("profiles-maximum-390.png")
        driver.shortcut("\ue00c")
        open_users()
        # Gecko deja salir el tabulador a la barra del navegador tras el último elemento del diálogo:
        # 20 pasos recorren la lista sin llegar al final.
        for _ in range(20):
            driver.shortcut("\ue004")
            assert js("return document.querySelector('#profiles-dialog').contains(document.activeElement)"), js("return document.activeElement.outerHTML.slice(0, 160)")
        for _ in range(8):
            driver.shortcut("\ue004", ["\ue008"])
            assert js("return document.querySelector('#profiles-dialog').contains(document.activeElement)")
        checks.append("24-profile limit, 48-character name, 252-character email, scrollable list and native keyboard focus trap")

        driver.context("chrome")
        errors = driver.script("""return Services.console.getMessageArray().map(m=>({message:m.message,source:m.sourceName||'',flags:m.flags??null,category:m.category||''})).filter(m=>(m.source.startsWith(arguments[0])||m.source.startsWith(arguments[1])) && m.flags===0 && m.category.toLowerCase().includes('javascript'));""", [origin, second_origin])
        assert not errors, errors
        report["consoleErrors"] = errors
        checks.append("No JavaScript errors from either profile origin")
        report["status"] = "passed"
        report["dispatchedActions"] = launches
        report["profileCount"] = len(get_snapshot()["profiles"])
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error)
        if driver:
            with contextlib.suppress(Exception):
                report["failureScreenshot"] = capture("failure.png")
        raise
    finally:
        if driver:
            driver.close()
        server.shutdown()
        server.server_close()
        if second_server:
            second_server.shutdown()
            second_server.server_close()
        (evidence / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()

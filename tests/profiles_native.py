#!/usr/bin/env python3
"""Real, isolated two-profile IPC and storage verification for Kitsune.

Uses the real profile manager, HTTP APIs, launcher and transient systemd user
services. Only home-service startup and runtime preparation are fixtures: home
servers are already running in this test, and the selected branded runtime is
already prepared. Debug flags exist only in temporary test adapters/profiles.
No installed browser profile is opened or modified.
"""

from __future__ import annotations

import argparse
import contextlib
import http.server
import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import traceback
import urllib.request

from browser_smoke import WebDriver, DEFAULT_DRIVER, eventually, unused_port, search_scripts


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("kitsune_profiles_native_home", ROOT / "install/home-server.py")
home = importlib.util.module_from_spec(spec)
spec.loader.exec_module(home)
profiles = home.profiles_module


class AttachedDriver(WebDriver):
    def __init__(self, profile, evidence, marionette_port, browser):
        self.profile = profile
        self.evidence = evidence
        self.session_id = None
        self.port = unused_port()
        self.log = (evidence / (profile.parent.name + "-geckodriver.log")).open("a")
        self.process = subprocess.Popen(
            [str(DEFAULT_DRIVER), "--host", "127.0.0.1", "--port", str(self.port),
             "--connect-existing", "--marionette-port", str(marionette_port),
             "--allow-system-access", "--log", "info"],
            stdin=subprocess.DEVNULL, stdout=self.log, stderr=subprocess.STDOUT)
        eventually(lambda: self.request("GET", "/status"), timeout=10)
        result = self.request("POST", "/session", {"capabilities": {"alwaysMatch": {
            "browserName": "firefox", "pageLoadStrategy": "normal",
            "moz:firefoxOptions": {"binary": str(browser)},
        }}}, timeout=60)
        self.session_id = result["sessionId"]
        self.capabilities = result["capabilities"]
        self.command("POST", "/timeouts", {"script": 30000, "pageLoad": 30000, "implicit": 0})
        self.command("POST", "/window/rect", {"width": 1540, "height": 1000})


class CookieFixture(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"<!doctype html><meta charset=utf-8><title>Kitsune profile fixture</title><h1>Isolated browser profile test</h1>"
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


def endpoint(server, path, method="GET", data=None):
    body = None if data is None else json.dumps(data).encode()
    request = urllib.request.Request(server.origin + path, data=body, method=method,
                                    headers={"Origin": server.origin, "Content-Type": "application/json",
                                             "X-Kitsune-Token": server.token})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def socket_ready(port):
    with socket.create_connection(("127.0.0.1", port), timeout=0.2):
        return True


def tabs(driver):
    driver.context("chrome")
    return driver.script("return Array.from(Services.wm.getEnumerator('navigator:browser')).flatMap(w=>Array.from(w.gBrowser.tabs,t=>({url:t.linkedBrowser.currentURI.spec,title:t.label}))); ")


def units_for(identifier):
    result = subprocess.run(["systemctl", "--user", "list-units", "--all", "--plain", "--no-legend",
                             "kitsune-window-" + identifier + "-*.service"], text=True, capture_output=True, check=True)
    return [line.split()[0] for line in result.stdout.splitlines()
            if line.split() and line.split()[0].startswith("kitsune-window-" + identifier + "-")]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", type=Path, required=True)
    parser.add_argument("--headed", action="store_true", default=True, help="Use temporary visible windows to exercise desktop IPC (default)")
    parser.add_argument("--headless", dest="headed", action="store_false", help="Diagnostic only: headless Gecko does not exercise desktop IPC correctly")
    parser.add_argument("--evidence", type=Path, default=ROOT / "tests/evidence/profiles-native-2026-09-12")
    options = parser.parse_args()
    evidence = options.evidence.absolute()
    evidence.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix="kitsune-profiles-native-"))
    data = temporary / "data"
    state = temporary / "state"
    config = temporary / "config"
    browser_root, state_root = data / "kitsune-browser", state / "kitsune-browser"
    templates = browser_root / "templates"
    templates.mkdir(parents=True)
    shutil.copy2(ROOT / "install/user.js", templates / "user.js")
    shutil.copy2(ROOT / "install/default-search.json.mozlz4", templates / "default-search.json.mozlz4")
    shutil.copytree(ROOT / "chrome", templates / "chrome")
    shutil.copytree(ROOT / "start", browser_root / "start")
    shutil.copy2(ROOT / "install/profiles.py", browser_root / "profiles.py")
    shutil.copy2(ROOT / "install/media.py", browser_root / "media.py")
    shutil.copy2(ROOT / "install/kitsune-browser", temporary / "kitsune-browser")
    os.chmod(temporary / "kitsune-browser", 0o700)
    bin_dir = temporary / "bin"
    bin_dir.mkdir()
    systemctl = bin_dir / "systemctl"
    systemctl.write_text("#!/bin/sh\nif [ \"${1:-}\" = --user ] && [ \"${2:-}\" = start ]; then exit 0; fi\nexec /usr/bin/systemctl \"$@\"\n")
    systemctl.chmod(0o700)
    units = config / "systemd/user"
    units.mkdir(parents=True)
    (units / "kitsune-home.service").write_text("# In-process HTTP fixture, already listening\n")
    (units / "kitsune-home@.service").write_text("# In-process HTTP fixture, already listening\n")
    adapter = temporary / "test-browser-adapter"
    adapter.write_text("#!/bin/sh\n" + ("unset MOZ_HEADLESS\n" if options.headed else "export MOZ_HEADLESS=1\n") + "previous=''\nprofile=''\nfor arg do\n  if [ \"${previous}\" = --profile ]; then profile=\"${arg}\"; break; fi\n  previous=\"${arg}\"\ndone\nif [ -f \"${profile}/.parentlock\" ]; then\n  exec " + shlex.quote(str(options.browser)) + " \"$@\"\nfi\nexec " + shlex.quote(str(options.browser)) + " --marionette --remote-allow-system-access " + ("" if options.headed else "-headless ") + "\"$@\"\n")
    adapter.chmod(0o700)
    (browser_root / "prepare-runtime.py").write_text("print(" + repr(str(adapter)) + ")\n")
    entrypoint = temporary / "isolated-profile-launcher"
    entrypoint.write_text("#!/bin/sh\n" + "\n".join("export " + key + "=" + shlex.quote(str(value)) for key, value in {
        "XDG_DATA_HOME": data, "XDG_STATE_HOME": state, "XDG_CONFIG_HOME": config,
        "PATH": str(bin_dir) + ":/usr/bin:/bin",
    }.items()) + "\nexec " + shlex.quote(str(temporary / "kitsune-browser")) + " \"$@\"\n")
    entrypoint.chmod(0o700)
    manager = profiles.ProfileManager(browser_root, state_root, launcher=entrypoint)
    initial = manager.snapshot()
    result_a = manager.create("Perfil A", "a@example.invalid", "blue", initial["revision"])
    result_b = manager.create("Perfil B", "b@example.invalid", "pink", result_a["revision"])
    identifiers = [result_a["createdId"], result_b["createdId"]]
    resolved = [manager.resolve(identifier) for identifier in identifiers]
    marionette = [unused_port(), unused_port()]
    for current, port in zip(resolved, marionette):
        prefs = current["profile"] / "user.js"
        with prefs.open("a") as output:
            output.write("\n// Explicitly isolated native IPC test only.\n")
            for name, value in {
                "marionette.port": port, "marionette.enabled": True,
                "browser.startup.page": 0, "browser.shell.checkDefaultBrowser": False,
                "browser.tabs.warnOnClose": False, "browser.sessionstore.resume_from_crash": False,
                "security.fileuri.strict_origin_policy": True,
                "browser.newtabpage.activity-stream.testing.shouldInitializeFeeds": True,
            }.items():
                output.write("user_pref(" + json.dumps(name) + ", " + json.dumps(value) + ");\n")
    report = {"ok": False, "fixtureRoot": str(temporary), "browser": str(options.browser), "headed": options.headed,
              "scope": "Actual ProfileManager→systemd-run→Kitsune launcher→native Gecko IPC; temporary XDG roots only. Home service startup and already-prepared runtime selection stubbed; HTTP APIs and two browser processes are real.",
              "profiles": [{key: str(value) if isinstance(value, Path) else value for key, value in item.items()} for item in resolved],
              "checks": [], "errors": []}
    servers, threads, drivers = [], [], []
    fixture = http.server.ThreadingHTTPServer(("127.0.0.1", 0), CookieFixture)
    fixture_origin = f"http://127.0.0.1:{fixture.server_address[1]}"

    def check(name, data):
        report["checks"].append({"name": name, "passed": True, "data": data})
        print("PASS " + name, flush=True)

    try:
        for current in resolved:
            server = home.create_server(browser_root / "start", current["state"], port=current["port"], profiles=manager, current_id=current["id"])
            servers.append(server)
        for server in [*servers, fixture]:
            thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
            thread.start()
            threads.append(thread)
        dispatch_a = manager.open(identifiers[0], "home")
        dispatch_b = endpoint(servers[0], "/api/profiles/" + identifiers[1] + "/open", "POST", {"action": "home"})
        for index in range(2):
            eventually(lambda index=index: socket_ready(marionette[index]), timeout=40)
            drivers.append(AttachedDriver(resolved[index]["profile"], evidence, marionette[index], options.browser))
        check("two_actual_profile_processes_dispatched_from_manager_and_http_api", {"a": dispatch_a["launchRequested"], "b": dispatch_b["launchRequested"], "pids": [driver.capabilities.get("moz:processID") for driver in drivers]})
        native_info = []
        scripts = search_scripts()
        for index, driver in enumerate(drivers):
            driver.context("chrome")
            info = driver.script("""return {profile:Services.dirsvc.get('ProfD',Ci.nsIFile).path,
              title:document.title,appName:Services.appinfo.name,pid:Services.appinfo.processID,
              signatures:Services.prefs.getBoolPref('xpinstall.signatures.required'),
              strictFileOrigins:Services.prefs.getBoolPref('security.fileuri.strict_origin_policy'),
              sanitize:Services.prefs.getBoolPref('privacy.sanitize.sanitizeOnShutdown'),
              syncEnabled:Services.prefs.getBoolPref('identity.fxaccounts.enabled',false),
              cookieBehavior:Services.prefs.getIntPref('network.cookie.cookieBehavior'),
              httpsOnly:Services.prefs.getBoolPref('dom.security.https_only_mode')};""")
            info["search"] = driver.script(scripts["inspectGoogleScript"], asynchronous=True)
            assert info["profile"] == str(resolved[index]["profile"]), info
            assert info["signatures"] and info["strictFileOrigins"] and info["sanitize"] and info["httpsOnly"], info
            assert not info["syncEnabled"] and info["cookieBehavior"] == 5, info
            assert info["search"]["normal"]["name"] == info["search"]["private"]["name"] == "Google", info
            assert "Kitsune" in info["title"] and "LibreWolf" not in info["title"], info
            native_info.append(info)
        assert native_info[0]["pid"] != native_info[1]["pid"]
        check("native_profile_identity_google_branding_and_security", native_info)

        for index, driver in enumerate(drivers):
            driver.navigate(resolved[index]["home"])
            eventually(lambda driver=driver: driver.script("return document.documentElement.dataset.ready==='true';"))
            state_value = driver.script("""const done=arguments[arguments.length-1];fetch('/api/profiles').then(r=>r.json()).then(v=>done({currentId:v.currentId,emails:v.profiles.map(p=>p.email)}));""", asynchronous=True)
            assert state_value["currentId"] == identifiers[index], state_value
            driver.screenshot("profile-" + str(index + 1) + "-home.png", chrome=True)
        check("homepage_http_context_matches_each_native_profile", identifiers)

        settings_a = endpoint(servers[0], "/api/settings")
        settings_b = endpoint(servers[1], "/api/settings")
        settings_a["data"]["accent"] = "pink"
        settings_a["data"]["links"].append({"id": "only-a", "name": "Solo A", "url": fixture_origin + "/a-link", "color": "blue", "icon": ""})
        endpoint(servers[0], "/api/settings", "PUT", {"data": settings_a["data"], "revision": settings_a["revision"]})
        unchanged_b = endpoint(servers[1], "/api/settings")
        assert unchanged_b["data"] == settings_b["data"]
        assert resolved[0]["state"] != resolved[1]["state"]
        check("personalization_settings_persist_only_in_selected_profile", {"a": str(resolved[0]["state"]), "b": str(resolved[1]["state"]), "bUnchanged": True})

        for driver in drivers:
            driver.navigate(fixture_origin + "/same-site")
        cookie_a = drivers[0].script("document.cookie='kitsune_test_profile=A; Path=/; SameSite=Lax';localStorage.setItem('kitsune_profile','A');return {cookie:document.cookie,storage:localStorage.getItem('kitsune_profile')};")
        cookie_b_before = drivers[1].script("return {cookie:document.cookie,storage:localStorage.getItem('kitsune_profile')};")
        assert cookie_a["cookie"] == "kitsune_test_profile=A" and cookie_a["storage"] == "A", cookie_a
        assert cookie_b_before == {"cookie": "", "storage": None}, cookie_b_before
        drivers[1].script("document.cookie='kitsune_test_profile=B; Path=/; SameSite=Lax';localStorage.setItem('kitsune_profile','B');")
        cookie_a_after = drivers[0].script("return {cookie:document.cookie,storage:localStorage.getItem('kitsune_profile')};")
        assert cookie_a_after == cookie_a, cookie_a_after
        check("same_website_cookies_and_localstorage_isolated_between_profiles", {"a": cookie_a, "bBefore": cookie_b_before, "aAfterBLogin": cookie_a_after})

        before_a, before_b = tabs(drivers[0]), tabs(drivers[1])
        target_b = fixture_origin + "/routed-to-b?source=launcher"
        ipc = subprocess.run([str(entrypoint), "--kitsune-profile", identifiers[1], "--new-tab", target_b],
                             check=True, timeout=15, capture_output=True, text=True)
        report["ipcClient"] = {"stdout": ipc.stdout, "stderr": ipc.stderr, "target": target_b}
        eventually(lambda: any(tab["url"] == target_b for tab in tabs(drivers[1])), timeout=20)
        after_a = tabs(drivers[0])
        assert not any(tab["url"] == target_b for tab in after_a), after_a
        assert after_a == before_a, (before_a, after_a)
        check("native_ipc_routes_explicit_profile_url_only_to_b", {"target": target_b, "aUnchanged": True, "bTabCountBefore": len(before_b), "bTabCountAfter": len(tabs(drivers[1]))})

        current = endpoint(servers[0], "/api/profiles")
        endpoint(servers[0], "/api/profiles/" + identifiers[1] + "/default", "POST", {"revision": current["revision"]})
        target_default = fixture_origin + "/default-goes-to-b"
        subprocess.run([str(entrypoint), "--new-tab", target_default], check=True, timeout=15,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        eventually(lambda: any(tab["url"] == target_default for tab in tabs(drivers[1])), timeout=20)
        assert not any(tab["url"] == target_default for tab in tabs(drivers[0]))
        check("native_ipc_obeys_changed_default_profile", {"defaultId": identifiers[1], "target": target_default})

        target_home_count = sum(tab["url"] == resolved[1]["home"] for tab in tabs(drivers[1]))
        opened = endpoint(servers[0], "/api/profiles/" + identifiers[1] + "/open", "POST", {"action": "home"})
        eventually(lambda: sum(tab["url"] == resolved[1]["home"] for tab in tabs(drivers[1])) > target_home_count, timeout=20)
        assert opened["openedId"] == identifiers[1] and opened["launchRequested"]
        check("homepage_switch_action_reuses_existing_profile_b_process", {"aPid": native_info[0]["pid"], "bPid": native_info[1]["pid"], "requestedB": True})
        for index, driver in enumerate(drivers):
            driver.screenshot("profile-" + str(index + 1) + "-final.png", chrome=True)
        report["ok"] = True
    except Exception as error:
        report["errors"].append({"type": type(error).__name__, "message": str(error), "traceback": traceback.format_exc()})
        report["failureTabs"] = []
        for driver in drivers:
            with contextlib.suppress(Exception):
                report["failureTabs"].append(tabs(driver))
        print(traceback.format_exc(), flush=True)
    finally:
        report["ownedUnits"] = []
        for identifier in identifiers:
            with contextlib.suppress(Exception):
                report["ownedUnits"].extend(units_for(identifier))
        for driver in drivers:
            with contextlib.suppress(Exception):
                driver.close()
        for unit in report["ownedUnits"]:
            with contextlib.suppress(Exception):
                subprocess.run(["systemctl", "--user", "stop", unit], check=False, timeout=10,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for server in [*servers, fixture]:
            with contextlib.suppress(Exception):
                server.shutdown()
                server.server_close()
        for thread in threads:
            thread.join(timeout=2)
        (evidence / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({"ok": report["ok"], "checks": len(report["checks"]), "report": str(evidence / "report.json"), "fixture": str(temporary)}), flush=True)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

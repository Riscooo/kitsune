"""Run one privileged script in a throwaway, headless Kitsune engine instance.

Used by the engine smoke test before a freshly built engine is activated and by
the preference audit. Marionette is spoken directly (no geckodriver, which
would write its own automation preferences into the profile) and its
recommended automation preferences are disabled. The profile is temporary and
deleted afterwards; the user's profiles are never touched.
"""
from __future__ import annotations

import contextlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time

# Marionette's own transport and the probe harness; never part of an engine's behaviour.
HARNESS_PREFIXES = ("marionette.", "remote.", "devtools.debugger.remote", "toolkit.startup.last_success")


class Marionette:
    def __init__(self, port, process, timeout=90):
        deadline = time.monotonic() + timeout
        while True:
            if process.poll() is not None:
                raise RuntimeError(f"El motor terminó al arrancar (código {process.returncode})")
            try:
                self.sock = socket.create_connection(("127.0.0.1", port), timeout=5)
                break
            except OSError:
                if time.monotonic() > deadline:
                    raise RuntimeError("El motor no abrió Marionette a tiempo") from None
                time.sleep(0.2)
        self.sock.settimeout(90)
        self.buffer = b""
        self.next_id = 0
        self._receive()  # server hello

    def _chunk(self):
        data = self.sock.recv(1 << 20)
        if not data:
            raise ConnectionError("Marionette cerró la conexión")
        return data

    def _receive(self):
        while b":" not in self.buffer:
            self.buffer += self._chunk()
        length, _, rest = self.buffer.partition(b":")
        size = int(length)
        while len(rest) < size:
            rest += self._chunk()
        self.buffer = rest[size:]
        return json.loads(rest[:size])

    def call(self, name, params=None):
        self.next_id += 1
        payload = json.dumps([0, self.next_id, name, params or {}]).encode()
        self.sock.sendall(str(len(payload)).encode() + b":" + payload)
        reply = self._receive()
        if reply[2] is not None:
            raise RuntimeError(f"{name}: {reply[2].get('message', reply[2])}")
        return reply[3]

    def close(self):
        with contextlib.suppress(OSError):
            self.sock.close()


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def run_chrome_script(browser: Path, script: str, env_extra=None, user_prefs=None, profile_setup=None,
                      asynchronous=False, profile_dir: Path | None = None):
    """Start ``browser`` on a new empty profile, run ``script`` in chrome scope, quit.

    ``profile_setup(profile)`` may seed files before the first start. An
    asynchronous script reports through its last argument. Returns the
    script's value and the names of the harness preferences written to user.js.
    """
    root = Path(tempfile.mkdtemp(prefix="kitsune-engine-probe-"))
    profile = profile_dir or root / "profile"
    profile.mkdir(mode=0o700, exist_ok=profile_dir is not None)
    port = free_port()
    harness = {"marionette.port": port, "remote.prefs.recommended": False,
               "browser.shell.checkDefaultBrowser": False, **(user_prefs or {})}
    if profile_setup:
        profile_setup(profile)
    harness_block = "".join(f"user_pref({json.dumps(k)}, {json.dumps(v)});\n" for k, v in harness.items())
    user_js = profile / "user.js"
    base = user_js.read_text().split("// kitsune-engine-probe\n")[0] if user_js.exists() else ""
    user_js.write_text(base + "// kitsune-engine-probe\n" + harness_block)
    env = {key: value for key, value in os.environ.items() if not key.startswith("KITSUNE_")}
    env.update({"MOZ_HEADLESS": "1", **(env_extra or {})})
    process = subprocess.Popen([str(browser), "--marionette", "--remote-allow-system-access", "--headless",
                                "--no-remote", "--profile", str(profile)],
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               env=env, start_new_session=True)
    client = None
    try:
        client = Marionette(port, process)
        client.call("WebDriver:NewSession", {"capabilities": {}})
        client.call("Marionette:SetContext", {"value": "chrome"})
        client.call("WebDriver:SetTimeouts", {"script": 90000})
        command = "WebDriver:ExecuteAsyncScript" if asynchronous else "WebDriver:ExecuteScript"
        value = client.call(command, {"script": script, "args": []})["value"]
        with contextlib.suppress(Exception):
            client.call("Marionette:Quit", {"flags": ["eForceQuit"]})
        return value, set(harness)
    finally:
        if client:
            client.close()
        try:
            process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        shutil.rmtree(root, ignore_errors=True)


DUMP_PREFS = """
const branch = Services.prefs.getDefaultBranch('');
const read = (b, name, type) => {
  try {
    if (type === b.PREF_BOOL) return b.getBoolPref(name);
    if (type === b.PREF_INT) return b.getIntPref(name);
    if (type === b.PREF_STRING) return b.getStringPref(name);
  } catch { return null; }
  return null;
};
const result = {};
for (const name of Services.prefs.getChildList('').sort()) {
  const type = Services.prefs.getPrefType(name);
  const user = Services.prefs.prefHasUserValue(name);
  result[name] = {
    type: {[branch.PREF_BOOL]:'bool', [branch.PREF_INT]:'int', [branch.PREF_STRING]:'string'}[type] || 'invalid',
    default: read(branch, name, type),
    user: user ? read(Services.prefs, name, type) : null,
    locked: Services.prefs.prefIsLocked(name),
  };
}
return {app: {name: Services.appinfo.name, version: Services.appinfo.version,
              platformVersion: Services.appinfo.platformVersion},
        policies: Services.policies.status === Services.policies.ACTIVE ? Object.keys(Services.policies.getActivePolicies()).sort() : [],
        prefs: result};
"""


def dump_prefs(browser: Path, env_extra=None, user_prefs=None, profile_setup=None, profile_dir=None):
    value, harness = run_chrome_script(browser, DUMP_PREFS, env_extra, user_prefs, profile_setup, profile_dir=profile_dir)
    value["prefs"] = {name: entry for name, entry in value["prefs"].items()
                      if not name.startswith(HARNESS_PREFIXES) and name not in harness}
    return value


SMOKE = """
const done = arguments[arguments.length - 1];
const wait = (test, ms = 30000) => new Promise((resolve, reject) => {
  const start = Date.now();
  (function poll() {
    let ok = false;
    try { ok = test(); } catch {}
    if (ok) return resolve();
    if (Date.now() - start > ms) return reject(Error('timeout'));
    setTimeout(poll, 100);
  })();
});
(async () => {
  let win = null;
  await wait(() => (win = Services.wm.getMostRecentWindow('navigator:browser')) && win.gBrowserInit.delayedStartupFinished);
  const brand = await new Localization(['branding/brand.ftl']).formatValue('brand-short-name');
  return {name: Services.appinfo.name, version: Services.appinfo.version, brand,
    userAgent: win.navigator.userAgent,
    nativeEntry: !!win.document.querySelector('script[src="chrome://browser/content/kitsune-bootstrap.js"]'),
    nativeModule: typeof ChromeUtils.importESModule('chrome://browser/content/kitsune-appearance.sys.mjs').KitsuneAppearance?.start === 'function',
    policies: Services.policies.status === Services.policies.ACTIVE,
    privacyMode: Services.prefs.getStringPref('kitsune.privacy.active', ''),
    signaturesRequired: Services.prefs.getBoolPref('xpinstall.signatures.required', false),
    sandboxLevel: Services.prefs.getIntPref('security.sandbox.content.level', 0)};
})().then(done, error => done({error: String(error)}));
"""


def smoke(browser: Path, mode="estricto"):
    value, _ = run_chrome_script(browser, SMOKE, {"KITSUNE_PRIVACY_MODE": mode}, asynchronous=True)
    return value

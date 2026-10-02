#!/usr/bin/env python3
"""Prepare a native Google search migration without starting the real profile.

Copies ONLY search.json.mozlz4 into a private, temporary profile with the same
leaf name. LibreWolf's own SearchService performs the requested migration. A
second brand-new profile receives ONLY the resulting search file and verifies
that the selected engines and browser-generated integrity hashes survive.

No prefs.js, cookies, history, session, passwords, extensions or certificates
are copied from the source profile, and this script never writes to it.
Installation of the validated artifact is a separate, backed-up operation with
the original browser closed. Do not copy either temporary profile wholesale.

The same-leaf requirement is verified from LibreWolf 154's bundled
SearchUtils.getVerificationHash, whose profile salt uses only the leaf name.
Mozilla source: https://searchfox.org/firefox-main/source/toolkit/components/search/SearchUtils.sys.mjs
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile


ROOT = Path(__file__).resolve().parents[1]
HARNESS_PATH = ROOT / "tests/browser_smoke.py"
spec = importlib.util.spec_from_file_location("kitsune_browser_harness", HARNESS_PATH)
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)

MARKER_LINE = 'user_pref("kitsune.migrations.googleSearch.v2", true);\n'
SEARCH_FILENAME = "search.json.mozlz4"

NATIVE_INTEGRITY = """
const done = arguments[arguments.length - 1];
(async () => {
  const { SearchService: search } = ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs');
  const { SearchUtils } = ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchUtils.sys.mjs');
  await search.init();
  const metadata = search._settings.getSettingsMetaData();
  const normal = search.defaultEngine;
  const privateEngine = search.defaultPrivateEngine;
  const engines = await search.getEngines();
  return {
    appName: Services.appinfo.name,
    profileLeaf: PathUtils.filename(PathUtils.profileDir),
    normalId: normal.id,
    privateId: privateEngine.id,
    engineIds: engines.map(engine => engine.id).sort(),
    normalHashAccepted: metadata.defaultEngineIdHash === SearchUtils.getVerificationHash(normal.id),
    privateHashAccepted: metadata.privateDefaultEngineIdHash === SearchUtils.getVerificationHash(privateEngine.id),
    signaturesRequired: Services.prefs.getBoolPref('xpinstall.signatures.required', true)
  };
})().then(done, error => done({error:String(error)}));
"""


def make_profile(parent: Path, leaf: str, search_bytes: bytes):
    parent.mkdir(mode=0o700)
    profile = parent / leaf
    profile.mkdir(mode=0o700)
    search_file = profile / SEARCH_FILENAME
    search_file.write_bytes(search_bytes)
    search_file.chmod(0o600)
    # Known, non-sensitive setup only. No preferences are read from the user.
    preferences = {
        "browser.startup.page": 0,
        "browser.startup.homepage": "about:blank",
        "browser.sessionstore.resume_from_crash": False,
        "browser.shell.checkDefaultBrowser": False,
        "browser.search.suggest.enabled": False,
        "browser.urlbar.suggest.searches": False,
        "browser.search.separatePrivateDefault": True,
        "browser.search.separatePrivateDefault.ui.enabled": True,
        "xpinstall.signatures.required": True,
    }
    (profile / "user.js").write_text("\n".join(
        f"user_pref({json.dumps(name)}, {json.dumps(value)});"
        for name, value in preferences.items()
    ) + "\n")
    return profile


def assert_google(snapshot):
    from urllib.parse import parse_qs, urlparse
    assert snapshot.get("ok"), snapshot
    for mode in ("normal", "private"):
        engine = snapshot[mode]
        assert engine["name"] == "Google", snapshot
        url = urlparse(engine["submission"])
        assert url.scheme == "https" and url.hostname == "www.google.com", snapshot
        assert url.path == "/search", snapshot
        assert parse_qs(url.query).get("q") == [snapshot["query"]], snapshot


def migrate(source: Path, output: Path | None = None, browser=None, driver_path=None):
    source = source.resolve(strict=True)
    if source.name != SEARCH_FILENAME or not source.is_file():
        raise ValueError("Source must be a regular search.json.mozlz4 file")
    if source.stat().st_size > 64 * 1024 * 1024:
        raise ValueError("Unexpectedly large search settings file")
    source_bytes = source.read_bytes()
    if not source_bytes.startswith(b"mozLz40\x00"):
        raise ValueError("Source is not a Mozilla compressed search settings file")
    leaf = source.parent.name
    if not leaf or leaf in (".", ".."):
        raise ValueError("Source profile must have a non-empty directory name")
    if output is None:
        output = Path(tempfile.mkdtemp(prefix="kitsune-search-migration-"))
    else:
        output = output.resolve()
        if output == source.parent or source.parent in output.parents:
            raise ValueError("Migration output cannot be inside the source profile")
        output.mkdir(mode=0o700, parents=False, exist_ok=False)
    evidence = output / "evidence"
    evidence.mkdir(mode=0o700)
    browser = browser or harness.DEFAULT_BROWSER
    driver_path = driver_path or harness.DEFAULT_DRIVER
    scripts = harness.search_scripts()
    report = {
        "ok": False,
        "source": str(source),
        "sourceSha256": hashlib.sha256(source_bytes).hexdigest(),
        "output": str(output),
        "sourceFilesCopied": [SEARCH_FILENAME],
        "sourceProfileStarted": False,
    }
    driver = None
    try:
        profile = make_profile(output / "migration", leaf, source_bytes)
        driver = harness.WebDriver(profile, evidence, browser, driver_path)
        driver.context("chrome")
        report["browserVersion"] = driver.capabilities["browserVersion"]
        report["migration"] = driver.script(scripts["configureGoogleScript"], asynchronous=True)
        assert report["migration"]["ok"], report["migration"]
        assert_google({"ok": True, **report["migration"]["after"]})
        report["migrationIntegrity"] = driver.script(NATIVE_INTEGRITY, asynchronous=True)
        assert report["migrationIntegrity"]["normalHashAccepted"]
        assert report["migrationIntegrity"]["privateHashAccepted"]
        driver.close()
        driver = None

        migrated_bytes = (profile / SEARCH_FILENAME).read_bytes()
        verified_profile = make_profile(output / "verification", leaf, migrated_bytes)
        # A fresh profile receives the native search file only: no marker and no
        # automation-modified prefs.js from the profile that did the migration.
        driver = harness.WebDriver(verified_profile, evidence, browser, driver_path)
        driver.context("chrome")
        report["transplant"] = driver.script(scripts["inspectGoogleScript"], asynchronous=True)
        assert_google(report["transplant"])
        assert report["transplant"]["migrationApplied"] is False
        integrity = driver.script(NATIVE_INTEGRITY, asynchronous=True)
        report["transplantIntegrity"] = integrity
        assert integrity["normalHashAccepted"] and integrity["privateHashAccepted"]
        assert integrity["signaturesRequired"]
        for field in ("appName", "profileLeaf", "normalId", "privateId", "engineIds"):
            assert integrity[field] == report["migrationIntegrity"][field], field
        driver.close()
        driver = None

        # Verify another launch of the independently staged profile, without
        # executing configureGoogleScript, so persistence is not self-fulfilling.
        driver = harness.WebDriver(verified_profile, evidence, browser, driver_path)
        driver.context("chrome")
        report["transplantAfterRestart"] = driver.script(scripts["inspectGoogleScript"], asynchronous=True)
        assert_google(report["transplantAfterRestart"])
        assert not report["transplantAfterRestart"]["migrationApplied"]
        driver.close()
        driver = None

        # Refuse to publish a migration prepared from a source changed during
        # the run (e.g. a running source browser saving its search configuration).
        assert source.read_bytes() == source_bytes, "Source search file changed during migration"
        artifacts = output / "artifacts"
        artifacts.mkdir(mode=0o700)
        result = artifacts / SEARCH_FILENAME
        result.write_bytes(migrated_bytes)
        result.chmod(0o600)
        (artifacts / "migration-pref.js").write_text(MARKER_LINE)
        report["artifact"] = str(result)
        report["markerPreference"] = str(artifacts / "migration-pref.js")
        report["artifactSha256"] = hashlib.sha256(migrated_bytes).hexdigest()
        report["sourceUnchanged"] = True
        report["ok"] = True
        return report
    except Exception as error:
        report["error"] = str(error)
        raise
    finally:
        if driver:
            driver.close()
        (evidence / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-search", type=Path, required=True)
    parser.add_argument("--output", type=Path, help="New, nonexistent private work directory; defaults to mkdtemp")
    parser.add_argument("--browser", type=Path, default=harness.DEFAULT_BROWSER)
    parser.add_argument("--driver", type=Path, default=harness.DEFAULT_DRIVER)
    options = parser.parse_args()
    report = migrate(options.source_search, options.output, options.browser, options.driver)
    print(json.dumps({key: report[key] for key in (
        "ok", "sourceUnchanged", "sourceProfileStarted", "sourceFilesCopied",
        "browserVersion", "sourceSha256", "artifact", "artifactSha256",
        "markerPreference", "output",
    )}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

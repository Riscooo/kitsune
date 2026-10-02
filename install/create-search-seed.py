#!/usr/bin/env python3
"""Generate the new-profile Google seed using Gecko, without user data.

Run only as a build/installation preparation step. Production profiles never
need WebDriver or privileged remote debugging to create a new identity.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("kitsune_harness", ROOT / "tests/browser_smoke.py")
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--browser", type=Path, default=harness.DEFAULT_BROWSER)
    args = parser.parse_args()
    work = Path(tempfile.mkdtemp(prefix="kitsune-clean-search-"))
    evidence = work / "evidence"
    evidence.mkdir()
    profile, _ = harness.prepare_profile(work)
    scripts = harness.search_scripts()
    report = {"ok": False, "userDataRead": False, "work": str(work)}
    driver = None
    try:
        driver = harness.WebDriver(profile, evidence, browser=args.browser)
        driver.context("chrome")
        migration = driver.script(scripts["configureGoogleScript"], asynchronous=True)
        assert migration["ok"], migration
        report["configured"] = migration["after"]
        driver.close()
        driver = None
        seed = (profile / "search.json.mozlz4").read_bytes()
        verification = work / "verify"
        verification.mkdir()
        other, _ = harness.prepare_profile(verification)
        (other / "search.json.mozlz4").write_bytes(seed)
        driver = harness.WebDriver(other, evidence, browser=args.browser)
        driver.context("chrome")
        checked = driver.script(scripts["inspectGoogleScript"], asynchronous=True)
        assert checked["ok"] and checked["normal"]["name"] == checked["private"]["name"] == "Google", checked
        report["transplant"] = checked
        driver.close()
        driver = None
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(seed)
        args.output.chmod(0o600)
        report.update(ok=True, artifact=str(args.output.resolve()), sha256=hashlib.sha256(seed).hexdigest())
    finally:
        if driver:
            driver.close()
        (evidence / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

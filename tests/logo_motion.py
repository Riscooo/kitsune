#!/usr/bin/env python3
"""Verify CSS logo motion in real Gecko, using a disposable profile only.

Reduced motion is emulated by ui.prefersReducedMotion inside that test profile.
No system setting, installed browser profile, account or source asset is changed.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import http.server
import json
from pathlib import Path
import tempfile
import threading

from browser_smoke import DEFAULT_BROWSER, ROOT, WebDriver, api_settings, eventually, prepare_profile, start_home_server, wait_start


class PlainSite(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"""<!doctype html><meta charset="utf-8"><title>Independent site fixture</title>
        <h1>Independent site</h1><div class="logo-and-wordmark"><div class="logo">STATIC LOGO</div></div>
        <a class="brand" href="#"><img alt="Static site image" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Crect width='48' height='48' fill='teal'/%3E%3C/svg%3E"></a>"""
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", type=Path)
    parser.add_argument("--browser", type=Path, default=DEFAULT_BROWSER)
    args = parser.parse_args()
    temporary = Path(tempfile.mkdtemp(prefix="kitsune-logo-motion-"))
    evidence = args.evidence.absolute() if args.evidence else temporary / "evidence"
    evidence.mkdir(parents=True, exist_ok=True)
    profile, _ = prepare_profile(temporary)
    server, origin = start_home_server(profile, temporary / "home.json")
    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), PlainSite)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    site_origin = f"http://127.0.0.1:{site.server_port}"
    assets = [ROOT / "start/favicon.svg", ROOT / "chrome/assets/kitsune.svg", *(ROOT / "install/branding").glob("icon*")]
    before_hashes = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in assets if path.is_file()}
    report = {"isolatedRoot": str(temporary), "evidence": str(evidence), "checks": [], "warnings": [], "samples": {}, "screenshots": [], "reducedMotionEmulation": "ui.prefersReducedMotion in disposable Gecko profile only"}
    driver = None

    def js(source, *arguments, asynchronous=False):
        driver.context("content")
        return driver.script(source, arguments, asynchronous=asynchronous)

    def capture(name):
        driver.settle()
        report["screenshots"].append(driver.screenshot(name, chrome=True))
        driver.context("content")

    def reduced(value):
        driver.context("chrome")
        driver.script("Services.prefs.setIntPref('ui.prefersReducedMotion',arguments[0]);", [1 if value else 0])
        eventually(lambda: js("return matchMedia('(prefers-reduced-motion: reduce)').matches") == value)

    def sample(selector):
        return js("""const e=document.querySelector(arguments[0]),s=getComputedStyle(e),r=e.getBoundingClientRect();
          return {animation:s.animationName,transform:s.transform,scale:s.scale,filter:s.filter,transition:s.transitionDuration,
          width:r.width,height:r.height,animations:e.getAnimations().map(a=>({name:a.animationName,time:a.currentTime,
          duration:a.effect.getTiming().duration,iterations:String(a.effect.getTiming().iterations),state:a.playState}))};""", selector)

    def motion(selector, name, label):
        eventually(lambda: sample(selector)["animation"] == name)
        values = js("""const [selector,name]=arguments,done=arguments[arguments.length-1],e=document.querySelector(selector);
          const a=e.getAnimations().find(a=>a.animationName===name),result=[],start=performance.now();
          function tick(){result.push({at:performance.now(),time:a.currentTime,transform:getComputedStyle(e).transform});
            if(performance.now()-start>=420)done(result);else requestAnimationFrame(tick)}tick();""", selector, name, asynchronous=True)
        assert values[-1]["time"] > values[0]["time"] + 200, values
        assert len({item["transform"] for item in values}) > 1, values
        state = sample(selector)
        floating = next(item for item in state["animations"] if item["name"] == name)
        assert floating["duration"] == 6000 and floating["iterations"] == "Infinity", state
        report["samples"][label] = {"first": values[0], "last": values[-1], "style": state}
        report["checks"].append(label + ": real animation clock advances and transform changes; 6s infinite")
        print("PASS " + label + ": real motion rendered", flush=True)

    def hover(selector, target_scale):
        driver.context("content")
        driver.command("POST", "/actions", {"actions": [{"type": "pointer", "id": "logo-mouse", "parameters": {"pointerType": "mouse"}, "actions": [{"type": "pointerMove", "duration": 100, "origin": {"element-6066-11e4-a52e-4f735466cecf": driver.element(selector)}, "x": 0, "y": 0}]}]})
        driver.command("DELETE", "/actions")
        eventually(lambda: abs(float(sample('.brand img' if selector == '.brand' else '.logo-and-wordmark .logo')["scale"]) - target_scale) < .005)

    def unhover():
        driver.command("POST", "/actions", {"actions": [{"type": "pointer", "id": "logo-mouse", "parameters": {"pointerType": "mouse"}, "actions": [{"type": "pointerMove", "duration": 0, "origin": "viewport", "x": 1, "y": 1}]}]})
        driver.command("DELETE", "/actions")

    def width(value, height):
        if value < 450:
            driver.context("chrome")
            driver.script("const done=arguments[arguments.length-1];document.documentElement.style.setProperty('min-width','0px','important');requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));", asynchronous=True)
        driver.context("content")
        driver.command("POST", "/window/rect", {"width": value, "height": height})
        eventually(lambda: js("return innerWidth") == value)
        driver.settle()

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        report["browser"] = str(args.browser)
        driver.navigate(origin + "/")
        wait_start(driver)
        reduced(False)
        assert js("return document.body.dataset.motion") == "on"
        assert js("return document.querySelector('.brand img').complete && document.querySelector('.brand img').naturalWidth>0")
        favicon = js("return document.querySelector('link[rel=icon]').href")
        motion(".brand img", "kitsune-logo-float", "home")
        capture("home-motion-1540.png")
        original_filter = sample(".brand img")["filter"]
        hover(".brand", 1.12)
        assert sample(".brand img")["filter"] != original_filter
        report["samples"]["homeHover"] = sample(".brand img")
        capture("home-hover-1540.png")
        unhover()
        driver.click("#query")
        for _ in range(6):
            driver.shortcut("\ue004", ["\ue008"])
            if js("return document.activeElement.matches('.brand')"):
                break
        assert js("return document.activeElement.matches('.brand:focus-visible')")
        eventually(lambda: abs(float(sample(".brand img")["scale"]) - 1.12) < .005)
        report["checks"].append("Home hover and keyboard focus produce scale/glow without changing the image asset")
        driver.click("#query")
        width(390, 844)
        motion(".brand img", "kitsune-logo-float", "home390")
        assert js("return document.documentElement.scrollWidth<=innerWidth+1")
        capture("home-motion-390.png")

        driver.click("#settings-open")
        driver.click("#motion-toggle")
        driver.shortcut("\ue00c")
        eventually(lambda: api_settings(origin)["data"]["motion"] is False)
        assert sample(".brand img")["animation"] == "none"
        driver.command("POST", "/refresh", {})
        wait_start(driver)
        assert js("return document.body.dataset.motion") == "off"
        assert sample(".brand img")["animation"] == "none"
        report["samples"]["homeOffAfterReload"] = sample(".brand img")
        report["checks"].append("Disabling motion in the UI stops the logo and persists after reload")
        driver.click("#settings-open")
        driver.click("#motion-toggle")
        driver.shortcut("\ue00c")
        eventually(lambda: api_settings(origin)["data"]["motion"] is True)
        reduced(True)
        assert sample(".brand img")["animation"] == "none"
        assert sample(".brand img")["transition"] == "0s"
        report["samples"]["homeReduced"] = sample(".brand img")
        capture("home-reduced-390.png")
        assert js("return document.querySelector('link[rel=icon]').href") == favicon
        report["checks"].append("Native reduced-motion preference disables home animation and transitions; favicon stays static")
        reduced(False)

        for page in ("about:newtab", "about:home"):
            width(1540, 1000)
            driver.navigate(page)
            eventually(lambda: js("return (document.querySelector('.logo-and-wordmark .logo')?.getBoundingClientRect().width||0)>0"))
            driver.settle()
            label = page.replace("about:", "native-")
            motion(".logo-and-wordmark .logo", "kb-logo-float", label)
            capture(label + "-motion-1540.png")
            hover(".logo-and-wordmark", 1.08)
            report["samples"][label + "Hover"] = sample(".logo-and-wordmark .logo")
            unhover()
            width(390, 844)
            assert sample(".logo-and-wordmark .logo")["animation"] == "kb-logo-float"
            layout = js("""return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,
              elements:['body','.nova-outer-wrapper','.container.nova-enabled','main','.logo-and-wordmark','.logo-and-wordmark .logo','.logo-and-wordmark .wordmark','.search-wrapper'].map(selector=>{
                const e=document.querySelector(selector);if(!e)return {selector,missing:true};const r=e.getBoundingClientRect(),s=getComputedStyle(e);
                return {selector,left:r.left,right:r.right,width:r.width,minWidth:s.minWidth,boxSizing:s.boxSizing,tag:e.tagName,className:e.className};})};""")
            report["samples"][label + "390Layout"] = layout
            assert layout["documentWidth"] <= layout["viewport"] + 1, layout
            for selector in (".logo-and-wordmark .logo", ".logo-and-wordmark .wordmark", ".search-wrapper"):
                bounds = next(item for item in layout["elements"] if item["selector"] == selector)
                assert not bounds.get("missing") and bounds["left"] >= 0 and bounds["right"] <= layout["viewport"], bounds
            capture(label + "-motion-390.png")
            reduced(True)
            assert sample(".logo-and-wordmark .logo")["animation"] == "none"
            assert sample(".logo-and-wordmark .logo")["transition"] == "0s"
            report["samples"][label + "Reduced"] = sample(".logo-and-wordmark .logo")
            report["checks"].append(label + ": hover, reduced-motion and logo/wordmark/search fully inside the 390px viewport pass")
            reduced(False)

        driver.navigate(site_origin + "/")
        assert js("return document.title") == "Independent site fixture"
        assert sample(".logo-and-wordmark .logo")["animation"] == "none"
        assert sample(".brand img")["animation"] == "none"
        report["checks"].append("Native branding CSS does not animate matching selectors on an independent website")
        driver.context("chrome")
        errors = driver.script("return Services.console.getMessageArray().map(m=>({message:m.message,source:m.sourceName||'',flags:m.flags??null,category:m.category||''})).filter(m=>[arguments[0],'about:newtab','about:home'].some(prefix=>m.source.startsWith(prefix)) && m.flags===0 && m.category.toLowerCase().includes('javascript'));", [origin])
        assert not errors, errors
        report["consoleErrors"] = errors
        after_hashes = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in assets if path.is_file()}
        assert before_hashes == after_hashes
        report["staticAssetHashes"] = after_hashes
        report["checks"].append("No relevant JavaScript console errors; source favicon and OS icon assets unchanged")
        report["status"] = "passed"
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error)
        if driver:
            with contextlib.suppress(Exception):
                capture("failure.png")
        raise
    finally:
        if driver:
            driver.close()
        server.shutdown()
        server.server_close()
        site.shutdown()
        site.server_close()
        (evidence / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()

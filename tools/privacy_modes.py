#!/usr/bin/env python3
"""Generate the privacy sets of install/recipe/kitsune.cfg from measurements.

Estricto must reproduce Kitsune 0.5 exactly as Risco used it: the effective
preferences of LibreWolf 154 plus Kitsune's 0.5 user.js on a fresh profile
(tests/fixtures/kitsune-0.5-effective-prefs.json). They are compared with the
factory values of Kitsune's own engine plus the 0.6 user.js, measured without
any mode applied (tests/fixtures/kitsune-engine-factory-prefs.json).

Every preference that differs must be classified below: ignored (volatile,
version, LibreWolf identity), common to both modes, or managed by the mode.
An unclassified difference stops generation, so nothing slips in unreviewed.
Cómodo uses Gecko's factory value unless COMFORT gives one.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT / "tests/fixtures/kitsune-0.5-effective-prefs.json"
FACTORY = ROOT / "tests/fixtures/kitsune-engine-factory-prefs.json"
CFG = ROOT / "install/recipe/kitsune.cfg"
BEGIN, END = "// @@KITSUNE_GENERATED_BEGIN@@", "// @@KITSUNE_GENERATED_END@@"

# Not behaviour: per-run identifiers, timestamps, version/build bookkeeping,
# LibreWolf's own identity, and things a fresh profile writes on first start.
IGNORE = [
    r".*(uuid|Uuid|UUID|impressionId|profileId|storeID|ProfileGroupID|ClientID|clientID|installID).*",
    r".*(lastColdStartupCheck|acceptedDate|lastDailyNotification|lastUpdateTime|lastUpdate|LastUpdate).*",
    r".*\.(nextupdatetime|lastupdatetime|updatetime)$",
    r".*([Tt]imestamp|lastCheck|lastRun|[Ii]nstallDate|lastSuccess|last_success|lastPing|firstRun).*",
    r".*(buildID|BuildID|BuildId|mstone|lastAppVersion|lastPlatformVersion|lastAppBuildId|previousBuildID).*",
    r".*\.(version|migration|migrationVersion|schemaVersion|lastVersion)$",
    r"librewolf\..*",
    r"(app\.update|app\.support|app\.feedback|app\.releaseNotesURL|app\.vendorURL|app\.productInfo)\..*|app\.update\..*",
    r"(startup\.homepage_override_url|startup\.homepage_welcome_url.*|browser\.startup\.homepage_override\..*)",
    r"(general\.useragent\..*|distribution\..*|browser\.policies\..*|termsofuse\..*)",
    r"(toolkit\.telemetry\.cachedClientID|toolkit\.startup\..*|toolkit\.profiles\..*)",
    r"(extensions\.webextensions\.uuids|extensions\.databaseSchema|extensions\.lastAppBuildId|extensions\.getAddons\.cache\.lastUpdate)",
    r"(browser\.laterrun\..*|browser\.migration\..*|browser\.pagethumbnails\..*|places\.database\..*|places\.history\.expiration\.transient_current_max_pages)",
    r"(media\.gmp-manager\..*|media\.gmp-.*\.(lastUpdate|lastInstallStart|lastDownload|hashValue|abi|version))",
    r"(gfx\..*|widget\..*|layers\..*|webgl\.(?!disabled|enable-webgl2|min_capability_mode).*)",
    r"(network\.trr\..*mode-cid|security\.sandbox\.content\.tempDirSuffix|security\.remote_settings\..*|services\.settings\..*)",
    r"(browser\.newtabpage\.storageVersion|browser\.urlbar\.placeholderName.*|browser\.search\.region|doh-rollout\..*)",
    r"(datareporting\.policy\..*|identity\.fxaccounts\.toolbar\..*|browser\.uiCustomization\..*|browser\.engagement\..*)",
    r"(browser\.contextual-services\.contextId|nimbus\..*|messaging-system\..*|toolkit\.telemetry\.reportingpolicy\..*)",
    # LibreWolf's identity, its overrides file and its documentation links.
    r"(app\.releaseNotesURL|app\.distributor.*|app\.partner\..*|autoadmin\..*|browser\.geolocation\.warning\.infoURL|default-browser-agent\..*)",
    # Per-profile identifiers and runtime state, not settings.
    r"(dom\.push\.userAgentID|privacy\.sanitize\.pending|privacy\.sanitize\.clearOnShutdown\.hasMigrated.*|captchadetection\..*|gecko\.handlerService\..*)",
    # Gecko 154 defaults that 157 changed on purpose (features, protocol tuning,
    # list names, service URLs): keeping 157's own values, never forcing 154's.
    r"(layout\.css\..*|accessibility\..*|devtools\..*|apz\..*|svg\..*|image\..*|idle_period\..*|javascript\.options\.wasm.*)",
    r"(security\.tls\.client_hello\..*|security\.tls\.enable_mlkem.*|browser\.tabs\.remote\..*|dom\.navigation\..*)",
    r"(network\.http\.http3\.(apple_fast_datapath|max_gso_segments|version_negotiation.*)|network\.dns\.preferIPv6)",
    r"(captivedetect\.canonicalContent|network\.connectivity-service\.IPv[46]\.url|urlclassifier\..*|browser\.safebrowsing\.(id|provider\.mozilla\.lists))",
    r"(browser\.newtabpage\.activity-stream\..*(config|layout|variation|sectionId|sportsfeed|searchEngines)|browser\.newtabpage\.activity-stream\.discoverystream\.thumbsUpDown\..*)",
    r"(browser\.urlbar\.quicksuggest\.(online\.enabled|settingsUi)|browser\.urlbar\.deduplication\..*|browser\.tabs\.groups\.smart\.agglomerativeThresholdInt)",
    r"(general\.config\..*|intl\.locale\.requested|places\.semanticHistory\..*|browser\.smartwindow\..*|browser\.ipProtection\..*)",
    r"(browser\.sessionstore\.newTabOnRestore\..*|browser\.translation\.neverForLanguages|lightweightThemes\..*|spellchecker\.dictionary_path)",
    r"(browser\.dom\.window\.dump\.enabled|browser\.touchmode\.auto|browser\.macAppMenu\..*|browser\.bypassAutoTriggerActions|sidebar\.revamp\.round-content-area)",
    # Gecko 158: enlaces de ayuda (Kitsune los lleva a su ayuda local) y la atribución de
    # patrocinados (browser.partnerlink.*), que Gecko 158 quitó.
    r"(browser\.lna\.warning\.infoURL|identity\.sendtab(promo)?(\.deviceissues)?\.url|browser\.partnerlink\..*)",
    # Lo que depende del equipo donde se mide (el tema del escritorio) o es un identificador de
    # prueba, y los enlaces «Más información» (Kitsune los lleva a su ayuda): nunca se fuerzan.
    r"(ui\.systemUsesDarkTheme|datareporting\.dau\.cachedUsageProfileID|extensions\.colorway-builtin-themes-cleanup)",
    r"(.*([Ll]earnMoreUrl|learn_more_url|LearnMoreURL)|browser\.contentblocking\.report\..*\.url)",
    # Gecko 158 cambió a propósito estos (servicios, dibujado, ajuste fino de red y de WebRTC):
    # se queda el valor de Gecko, nunca el de 154.
    r"(browser\.newtabpage\.activity-stream\.discoverystream\.endpoint.*|browser\.newtabpage\.activity-stream\.widgets\.sportsWidget\.pollLiveMs)",
    r"(layout\.disable-pixel-alignment|media\.webrtc\.send_mlkem_keyshare|network\.dns\.mru_to_tail)",
    # Cuándo arranca Glean (la telemetría de Gecko): su subida ya está apagada y bloqueada.
    r"telemetry\.fog\.init_on_shutdown",
]

# Sync stays available in both modes (it only does anything after signing in);
# the content blocking category is set by kitsune.cfg itself when a mode is
# applied, because Firefox only expands a category from a profile value; and
# Normandy/translations write runtime state on first start.
NOT_MANAGED = {"identity.fxaccounts.enabled", "browser.contentblocking.category",
               "app.normandy.first_run", "browser.translations.mostRecentTargetLanguages"}
# Where saved passwords live (Rust store or logins.json) is Gecko's own
# migration: 157 release turns the Rust store off and restores logins from it.
# It must never follow a privacy mode, or switching modes would switch stores.
NOT_MANAGED_PREFIXES = ("signon.storage.",)

# Same value in both modes: no telemetry, studies or remote-content features,
# no speculative connections, and LibreWolf's non-privacy UX choices.
COMMON = [
    r"(toolkit\.telemetry|datareporting|app\.normandy|app\.shield|browser\.ping-centre|toolkit\.coverage)\..*",
    r"(browser\.discovery|browser\.tabs\.crashReporting|breakpad|browser\.crashReports)\..*",
    r"browser\.newtabpage\.activity-stream\..*",
    r"(extensions\.getAddons|extensions\.htmlaboutaddons|extensions\.recommendations|extensions\.pocket|extensions\.formautofill)\..*",
    r"(browser\.urlbar|browser\.search)\..*",
    r"(network\.prefetch-next|network\.dns\.disablePrefetch.*|network\.predictor\..*|network\.http\.speculative-parallel-limit)",
    r"(browser\.send_pings|beacon\.enabled|browser\.safebrowsing\..*|security\.tls\..*|security\.ssl\..*|security\.OCSP\..*|security\.pki\..*|security\.cert_pinning\..*|security\.remote_settings\..*)",
    r"(media\.autoplay\..*|browser\.vpn_promo\..*|browser\.preferences\.moreFromMozilla|browser\.aboutwelcome\..*)",
    r"(browser\.ml\..*|browser\.ai\..*|browser\.translations\..*|browser\.shopping\..*|browser\.contentanalysis\..*|browser\.firefox-view\..*)",
    r"(privacy\.globalprivacycontrol\..*|network\.captive-portal-service\..*|network\.connectivity-service\..*|captivedetect\..*)",
    r"(browser\.download\..*|browser\.tabs\..*|browser\.toolbars\..*|browser\.startup\..*|browser\.display\..*|browser\.shell\..*)",
    r"(devtools\..*|ui\..*|layout\..*|accessibility\..*|general\..*|middlemouse\..*|font\..*|intl\..*)",
    r"(browser\.contentblocking\.report.*|browser\.contentblocking\.cfr.*|browser\.protections_panel\..*|browser\.messaging-system\..*)",
    r"(extensions\..*|xpinstall\..*|browser\.policies\..*|pdfjs\..*|browser\.places\..*|places\..*|browser\.bookmarks\..*)",
    # Interface Kitsune's Tinta chrome was designed against, and no promotions,
    # referral pings, region lookups by IP, UI tours or sponsored tiles.
    r"(browser\.nova\.enabled|sidebar\.revamp|sidebar\.main\.tools|browser\.aboutConfig\.showWarning|browser\.preferences\..*)",
    r"(browser\.contentblocking\.reject-and-isolate-cookies\..*|browser\.link\.open_newwindow\.restriction|browser\.xul\.error_pages\..*)",
    r"(browser\.promo\..*|browser\.referrals\..*|browser\.region\..*|browser\.shareqrcode\..*|browser\.topsites\..*|browser\.uitour\..*)",
    r"(startup\.homepage_override_nimbus_disable_wnp)",
]

# Managed by the mode: Estricto = measured value, Cómodo = factory or COMFORT.
MODE = [
    r"privacy\..*",
    r"(network\.cookie|network\.http\.referer|network\.http\.sendRefererHeader|network\.IDN_show_punycode)\..*|network\.http\.referer\..*",
    r"(browser\.contentblocking\.category|browser\.sessionstore\.privacy_level|browser\.formfill\..*|signon\..*|browser\.privatebrowsing\..*)",
    r"(dom\.security\.https_only_mode.*|dom\.security\.https_first.*|security\.mixed_content\..*|network\.http\.http3\..*)",
    r"(webgl\..*|media\.eme\..*|media\.gmp-widevinecdm\..*|media\.gmp-gmpopenh264\..*|media\.peerconnection\..*|media\.navigator\..*)",
    r"(geo\..*|permissions\..*|dom\.event\..*|dom\.disable_.*|dom\.battery\..*|dom\.gamepad\..*|dom\.vr\..*|dom\.webnotifications\..*|dom\.push\..*)",
    r"(network\.trr\..*|network\.proxy\..*|network\.dns\..*|network\.gio\..*|network\.file\..*|network\.auth\..*|network\.lna\..*)",
    r"(browser\.cache\..*|media\.memory_cache.*|browser\.sessionhistory\..*|browser\.sessionstore\..*|browser\.helperApps\..*)",
    r"(security\.ssl\.require_safe_negotiation|security\..*|cookiebanners\..*|clipboard\..*|dom\..*|network\..*|media\..*|javascript\..*)",
]

# Cómodo values that are not simply Gecko's factory value.
COMFORT = {}

# Estricto que no sale de la medida de 0.5 (Risco, 21-10: en Estricto Spotify no sonaba nunca). LibreWolf quitaba la
# DRM del todo: apagaba el proveedor de complementos (Widevine no se carga) y pedía la aprobación de GeckoView, que en
# escritorio la rompe. Ahora está apagada hasta que una web la pide: sale la barra «Activar DRM» (como Firefox en
# Linux, también en Windows y macOS), y con un clic Spotify, Apple Music o Netflix suenan. None: no lo gestiona ningún
# modo (el valor de Gecko).
STRICT = {"media.eme.enabled": False, "media.gmp-provider.enabled": None, "media.eme.require-app-approval": None}


def compile_rules(rules):
    return [re.compile(rule) for rule in rules]


def classify(name, ignore, common, mode):
    if name in NOT_MANAGED or name.startswith(NOT_MANAGED_PREFIXES) or any(rule.fullmatch(name) for rule in ignore):
        return "ignore"
    if any(rule.fullmatch(name) for rule in common):
        return "common"
    if any(rule.fullmatch(name) for rule in mode):
        return "mode"
    return None


def effective(entry):
    return entry["user"] if entry["user"] is not None else entry["default"]


def differences(reference, factory):
    out = {}
    for name, entry in reference["prefs"].items():
        value = effective(entry)
        if value is None or entry["type"] == "invalid":
            continue
        other = factory["prefs"].get(name)
        if other is not None and effective(other) == value:
            continue
        out[name] = (value, effective(other) if other else None, other is not None)
    return out


def generate(reference, factory):
    ignore, common, mode = compile_rules(IGNORE), compile_rules(COMMON), compile_rules(MODE)
    diff = differences(reference, factory)
    sets = {"common": {}, "mode": {}}
    unclassified, skipped = [], []
    for name, (value, factory_value, known) in sorted(diff.items()):
        kind = classify(name, ignore, common, mode)
        if kind is None:
            unclassified.append((name, value, factory_value))
        elif kind == "ignore":
            skipped.append(name)
        elif isinstance(value, str) and "librewolf" in value.lower():
            skipped.append(name)
        elif kind == "common":
            sets["common"][name] = value
        else:
            comfort = COMFORT.get(name)
            if comfort is None and not known:
                # Not a Gecko preference at all in the own engine: nothing to manage.
                skipped.append(name)
                continue
            sets["mode"][name] = [value, comfort]
    for name, value in STRICT.items():
        sets["common"].pop(name, None)
        if value is None:
            sets["mode"].pop(name, None)
        else:
            sets["mode"][name] = [value, COMFORT.get(name)]
    return sets, unclassified, skipped


def js(value):
    return json.dumps(value, ensure_ascii=False)


def render(sets):
    lines = [BEGIN, "const KITSUNE_COMMON = {"]
    lines += [f"  {js(name)}: {js(value)}," for name, value in sorted(sets["common"].items())]
    lines += ["};", "// nombre: [estricto, cómodo]; null = valor de fábrica de Gecko", "const KITSUNE_MODE_PREFS = {"]
    lines += [f"  {js(name)}: [{js(strict)}, {js(comfort)}]," for name, (strict, comfort) in sorted(sets["mode"].items())]
    lines += ["};", END]
    return "\n".join(lines)


def write_cfg(sets, path=CFG):
    text = path.read_text()
    start, end = text.index(BEGIN), text.index(END) + len(END)
    path.write_text(text[:start] + render(sets) + text[end:])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", type=Path, default=REFERENCE)
    parser.add_argument("--factory", type=Path, default=FACTORY)
    parser.add_argument("--check", action="store_true", help="falla si kitsune.cfg no está al día")
    parser.add_argument("--report", action="store_true", help="muestra la clasificación")
    args = parser.parse_args()
    reference = json.loads(args.reference.read_text())
    factory = json.loads(args.factory.read_text())
    sets, unclassified, skipped = generate(reference, factory)
    if args.report:
        for name in skipped:
            print(f"ignorado  {name}")
        for kind in ("common", "mode"):
            for name, value in sorted(sets[kind].items()):
                print(f"{kind:9} {name} = {js(value)}")
    if unclassified:
        for name, value, factory_value in unclassified:
            print(f"SIN CLASIFICAR {name}: 0.5={js(value)} fábrica={js(factory_value)}", file=sys.stderr)
        return 1
    if args.check:
        current = CFG.read_text()
        if render(sets) not in current:
            print("kitsune.cfg no coincide con las mediciones; ejecuta tools/privacy_modes.py", file=sys.stderr)
            return 1
        return 0
    write_cfg(sets)
    print(json.dumps({"common": len(sets["common"]), "mode": len(sets["mode"]), "ignored": len(skipped)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

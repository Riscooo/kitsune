#!/usr/bin/env python3
"""Kitsune's loopback-only home page and private, durable personalization.

Only the listed home-page assets are served. No browser profile data is read.
Settings writes are same-origin, token-authenticated, bounded and atomic.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import signal
import socket
import stat
import sys
import tempfile
import threading
from urllib.parse import urlsplit


_profile_spec = importlib.util.spec_from_file_location("kitsune_local_profiles", Path(__file__).with_name("profiles.py"))
profiles_module = importlib.util.module_from_spec(_profile_spec)
_profile_spec.loader.exec_module(profiles_module)


MAX_BODY = 32 * 1024
MAX_PROFILE_BODY = 2 * 1024 * 1024
MAX_BACKGROUND_BODY = 17 * 1024 * 1024
BACKGROUND_ROUTE = re.compile(r"/api/background/([0-9a-f]{64})\.jpg")
WALLPAPER_ROUTE = re.compile(r"/api/wallpapers/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jpg")
MAX_REVISION = (2 ** 53) - 1
ASSETS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/app.bundle.js": ("app.bundle.js", "text/javascript; charset=utf-8"),
    "/navigation.mjs": ("navigation.mjs", "text/javascript; charset=utf-8"),
    "/app.css": ("app.css", "text/css; charset=utf-8"),
    "/palette.css": ("palette.css", "text/css; charset=utf-8"),
    "/favicon.svg": ("favicon.svg", "image/svg+xml"),
    "/favicon-dark.svg": ("favicon-dark.svg", "image/svg+xml"),
    "/logo.svg": ("logo.svg", "image/svg+xml"),
    "/logo-dark.svg": ("logo-dark.svg", "image/svg+xml"),
    "/logo-ring.svg": ("logo-ring.svg", "image/svg+xml"),
    "/veta-mascara-ltr.svg": ("veta-mascara-ltr.svg", "image/svg+xml"),
    "/veta-mascara-rtl.svg": ("veta-mascara-rtl.svg", "image/svg+xml"),
    "/veta-tinta-ltr.svg": ("veta-tinta-ltr.svg", "image/svg+xml"),
    "/veta-tinta-rtl.svg": ("veta-tinta-rtl.svg", "image/svg+xml"),
    "/logo-mask.svg": ("logo-mask.svg", "image/svg+xml"),
    "/logo-ring-dark.svg": ("logo-ring-dark.svg", "image/svg+xml"),
    "/logo-mask-dark.svg": ("logo-mask-dark.svg", "image/svg+xml"),
    "/seal.svg": ("seal.svg", "image/svg+xml"),
    "/ayuda.js": ("ayuda.js", "text/javascript; charset=utf-8"),
}
# Ayuda de Kitsune: los enlaces de ayuda del motor llegan aquí (app.support.baseURL).
HELP_ROUTE = re.compile(r"/ayuda/(?:[A-Za-z0-9][A-Za-z0-9._-]{0,120})?")
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; "
       "img-src 'self' data:; font-src 'self'; connect-src 'self'; "
       "object-src 'none'; frame-src 'none'; frame-ancestors 'none'; "
       "base-uri 'none'; form-action https://www.google.com")
DEFAULT_DATA = {
    "links": [
        {"id": "youtube", "name": "YouTube", "url": "https://www.youtube.com/", "color": "red", "icon": "play"},
        {"id": "gmail", "name": "Gmail", "url": "https://mail.google.com/", "color": "blue", "icon": "mail"},
        {"id": "github", "name": "GitHub", "url": "https://github.com/", "color": "white", "icon": "code"},
        {"id": "anime", "name": "MyAnimeList", "url": "https://myanimelist.net/", "color": "violet", "icon": "sparkles"},
        {"id": "wiki", "name": "Wikipedia", "url": "https://es.wikipedia.org/", "color": "teal", "icon": "book"},
    ],
    "art": True, "motion": True, "newTab": False, "accent": "blue", "focus": False,
    "wallpaper": "night", "themeSync": False, "modules": {"clock": True, "shortcuts": True},
    # Tema del navegador y del inicio, y el hash de la imagen de fondo propia.
    "theme": "claro", "background": None,
    # Botones de la ventana (izquierda o derecha) y el logo «KITSUNE» de la barra.
    "windowControls": "izquierda", "brand": True,
    # Modo ahorro (pestañas dormidas, límite de RAM en MB, 60 fps).
    "performance": "normal", "ramLimit": 2048,
}
LEGACY_SETTINGS_KEYS = {"links", "art", "motion", "newTab", "accent", "focus"}


class InvalidSettings(ValueError):
    pass


class StateUnavailable(OSError):
    pass


def valid_revision(value):
    return type(value) is int and 0 <= value <= MAX_REVISION


def validate_data(value, base=None):
    if type(value) is not dict or not LEGACY_SETTINGS_KEYS <= set(value) <= set(DEFAULT_DATA):
        raise InvalidSettings("La estructura de los ajustes no es válida.")
    # Old clients may submit only the six original fields. Preserve any newer
    # choices from the current record instead of resetting them to defaults.
    value = {**copy.deepcopy(DEFAULT_DATA if base is None else base), **copy.deepcopy(value)}
    for key in ("art", "motion", "newTab", "focus", "themeSync"):
        if type(value[key]) is not bool:
            raise InvalidSettings("Las preferencias deben ser verdaderas o falsas.")
    if value["accent"] not in ("blue", "pink", "system"):
        raise InvalidSettings("El color de acento no es válido.")
    if value["wallpaper"] not in ("night", "veil", "dusk", "ember"):
        raise InvalidSettings("El fondo seleccionado no es válido.")
    if value["theme"] not in ("claro", "oscuro"):
        raise InvalidSettings("El tema no es válido.")
    if value["windowControls"] not in ("izquierda", "derecha") or type(value["brand"]) is not bool:
        raise InvalidSettings("Las opciones de la ventana no son válidas.")
    if value["performance"] not in ("normal", "ahorro") or type(value["ramLimit"]) is not int or value["ramLimit"] not in (1024, 2048, 4096):
        raise InvalidSettings("El modo de rendimiento no es válido.")
    background = value["background"]
    if background is not None and (type(background) is not str or not re.fullmatch(r"[0-9a-f]{64}", background)):
        raise InvalidSettings("El fondo no es válido.")
    if type(value["modules"]) is not dict or set(value["modules"]) != {"clock", "shortcuts"} or any(type(flag) is not bool for flag in value["modules"].values()):
        raise InvalidSettings("Los módulos de inicio no son válidos.")
    links = value["links"]
    if type(links) is not list or len(links) > 12:
        raise InvalidSettings("Se permiten hasta 12 accesos.")
    ids = set()
    for link in links:
        if type(link) is not dict or set(link) != {"id", "name", "url", "color", "icon"}:
            raise InvalidSettings("La estructura de un acceso no es válida.")
        identifier, name, url = link["id"], link["name"], link["url"]
        if not isinstance(identifier, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", identifier) or identifier in ids:
            raise InvalidSettings("El identificador de un acceso no es válido.")
        ids.add(identifier)
        if not isinstance(name, str) or not 1 <= len(name) <= 36 or name != name.strip() or any(ord(char) < 32 for char in name):
            raise InvalidSettings("Cada acceso necesita un nombre de hasta 36 caracteres.")
        if not isinstance(url, str) or not 1 <= len(url) <= 4096 or any(char.isspace() or ord(char) < 32 for char in url) or "\\" in url:
            raise InvalidSettings("La dirección de un acceso no es válida.")
        try:
            name.encode("utf-8")
            url.encode("utf-8")
        except UnicodeError as error:
            raise InvalidSettings("El texto de un acceso no es Unicode válido.") from error
        try:
            parsed = urlsplit(url)
            port = parsed.port
            valid_url = parsed.scheme in ("http", "https") and parsed.hostname and not parsed.username and not parsed.password
            valid_url = valid_url and "@" not in parsed.netloc and "%" not in parsed.hostname
            valid_url = valid_url and (port is None or 1 <= port <= 65535)
        except ValueError:
            valid_url = False
        if not valid_url:
            raise InvalidSettings("Solo se admiten direcciones http o https sin credenciales.")
        if link["color"] not in ("red", "blue", "white", "violet", "teal"):
            raise InvalidSettings("El color de un acceso no es válido.")
        if link["icon"] not in ("", "play", "mail", "code", "sparkles", "book"):
            raise InvalidSettings("El icono de un acceso no es válido.")
    return copy.deepcopy(value)


def read_regular(path, limit):
    descriptor = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise OSError("Unexpected file type or size")
        data = handle.read(limit + 1)
        if len(data) > limit:
            raise OSError("File exceeds size limit")
        return data


class SettingsStore:
    def __init__(self, path):
        self.path = Path(path).absolute()
        self.lock = threading.Lock()
        self.data = copy.deepcopy(DEFAULT_DATA)
        self.revision = 0
        self.unavailable = False
        try:
            record = json.loads(read_regular(self.path, MAX_BODY))
            if type(record) is not dict or set(record) != {"version", "data", "revision"} or type(record["version"]) is not int or record["version"] != 2 or not valid_revision(record["revision"]):
                raise InvalidSettings("Invalid stored settings")
            self.data = validate_data(record["data"])
            self.revision = record["revision"]
        except FileNotFoundError:
            pass
        except (OSError, ValueError, TypeError):
            # Never silently replace a corrupt/unreadable state with defaults.
            self.unavailable = True

    def snapshot(self):
        with self.lock:
            if self.unavailable:
                raise StateUnavailable("Los ajustes locales no están disponibles.")
            return {"version": 2, "data": copy.deepcopy(self.data), "revision": self.revision}

    def update(self, data, revision, new_background=None):
        """Replace the settings. The background may only stay, be removed, or
        become the image the caller has just stored (new_background)."""
        validated = validate_data(data)
        if not valid_revision(revision):
            raise InvalidSettings("La revisión de los ajustes no es válida.")
        with self.lock:
            if self.unavailable:
                raise StateUnavailable("Los ajustes locales no están disponibles.")
            if revision != self.revision:
                return False, {"version": 2, "data": copy.deepcopy(self.data), "revision": self.revision}
            if self.revision == MAX_REVISION:
                raise StateUnavailable("No se puede incrementar la revisión de los ajustes.")
            validated = validate_data(data, base=self.data)
            if validated["background"] not in (None, self.data["background"], new_background):
                raise InvalidSettings("El fondo no es válido.")
            record = {"version": 2, "data": validated, "revision": self.revision + 1}
            encoded = json.dumps(record, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            if len(encoded) > MAX_BODY:
                raise InvalidSettings("Los ajustes superan el tamaño máximo.")
            temporary = None
            try:
                self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                descriptor, temporary = tempfile.mkstemp(prefix=".home-", suffix=".tmp", dir=self.path.parent)
                with os.fdopen(descriptor, "wb") as handle:
                    os.fchmod(handle.fileno(), 0o600)
                    handle.write(encoded)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, self.path)
                temporary = None
            except OSError as error:
                raise StateUnavailable("No se han podido guardar los ajustes locales.") from error
            finally:
                if temporary is not None:
                    try:
                        os.unlink(temporary)
                    except FileNotFoundError:
                        pass
            self.data = validated
            self.revision = record["revision"]
            # File data is synced before the atomic replacement. Directory sync
            # adds crash durability where the filesystem supports it.
            try:
                directory = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory)
                finally:
                    os.close(directory)
            except OSError:
                pass
            return True, copy.deepcopy(record)


class HomeServer(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True
    request_queue_size = 16

    def __init__(self, root, state, port, profiles=None, current_id="default", appearance=None):
        self.root = Path(root).resolve(strict=True)
        if not self.root.is_dir():
            raise ValueError("The static root must be a directory")
        self.store = SettingsStore(state)
        self.token = secrets.token_urlsafe(32)
        self.profiles = profiles
        self.current_id = current_id
        self.appearance = appearance
        self.appearance_lock = threading.Lock()
        self.appearance_stop = threading.Event()
        self.appearance_thread = None
        self.appearance_failed = False
        self.background_lock = threading.Lock()
        super().__init__(("127.0.0.1", port), HomeHandler)
        self.host = f"127.0.0.1:{self.server_address[1]}"
        self.origin = f"http://{self.host}"
        if self.appearance is not None:
            try:
                self.refresh_appearance()
            except (OSError, ValueError, TypeError):
                self.appearance_failed = True
                self.event("appearance_unavailable", "appearance", 503)
            self.appearance_thread = threading.Thread(target=self.appearance_loop, name="kitsune-appearance", daemon=True)
            self.appearance_thread.start()

    def appearance_loop(self):
        while not self.appearance_stop.wait(2):
            try:
                self.refresh_appearance()
                self.appearance_failed = False
            except (OSError, ValueError, TypeError):
                if not self.appearance_failed:
                    self.event("appearance_unavailable", "appearance", 503)
                self.appearance_failed = True

    def server_close(self):
        self.appearance_stop.set()
        if self.appearance_thread is not None and self.appearance_thread is not threading.current_thread():
            self.appearance_thread.join(timeout=3)
        super().server_close()

    @staticmethod
    def event(event, route, status):
        # Fixed event/route names only. Never include raw URLs, query strings,
        # bodies, user labels, email addresses, photo bytes or authentication.
        print(json.dumps({"event": event, "route": route, "status": status}, separators=(",", ":")), file=sys.stderr, flush=True)

    def refresh_appearance(self, identifier=None):
        identifier = identifier or self.current_id
        if identifier == self.current_id:
            if self.appearance is None:
                raise StateUnavailable("La apariencia nativa no está disponible en esta instalación.")
            with self.appearance_lock:
                return self.appearance.refresh(self.store.snapshot()["data"])
        if self.profiles is None:
            raise StateUnavailable("No se puede actualizar la apariencia del perfil.")
        appearance = make_appearance(self.profiles.browser_root, self.profiles.state_root, identifier)
        if appearance is None:
            raise StateUnavailable("La apariencia nativa no está disponible en esta instalación.")
        resolved = self.profiles.resolve(identifier, initialize=False)
        # Read-only snapshot: never replace another running profile service's
        # in-memory settings or write that profile's home.json from here.
        return appearance.refresh(SettingsStore(resolved["state"]).snapshot()["data"])

    def prune_backgrounds(self):
        """Delete every stored background except the one the settings use."""
        if self.appearance is None:
            return
        try:
            keep = self.store.snapshot()["data"]["background"]
        except StateUnavailable:
            return
        for path in (Path(self.appearance.profile) / "chrome").glob("kitsune-background-*.jpg"):
            if keep is None or path != self.appearance.background(keep):
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass

    def memory(self):
        """Memoria real (PSS) de los procesos de Kitsune de este perfil, sin leer su contenido."""
        if self.appearance is None:
            return {"memoryMB": None, "processes": 0}
        profile = str(Path(self.appearance.profile))
        main, parents = None, {}
        for entry in Path("/proc").iterdir():
            if not entry.name.isdigit():
                continue
            try:
                if "/kitsune-browser/engine/" not in os.readlink(entry / "exe"):
                    continue
                arguments = (entry / "cmdline").read_bytes().split(b"\0")
                status = (entry / "status").read_text()
            except OSError:
                continue
            parent = re.search(r"^PPid:\s+(\d+)", status, re.M)
            parents[int(entry.name)] = int(parent[1]) if parent else 0
            if b"-contentproc" not in arguments and profile.encode() in arguments:
                main = int(entry.name)
        if main is None:
            return {"memoryMB": None, "processes": 0}
        # Toda la familia: en Linux las pestañas cuelgan de un proceso intermedio (forkserver).
        family, grown = {main}, True
        while grown:
            children = {pid for pid, parent in parents.items() if parent in family} - family
            family |= children
            grown = bool(children)
        total = 0
        for pid in family:
            try:
                rollup = (Path("/proc") / str(pid) / "smaps_rollup").read_text()
                total += int(re.search(r"^Pss:\s+(\d+)", rollup, re.M)[1])
            except (OSError, TypeError):
                continue
        return {"memoryMB": round(total / 1024), "processes": len(family)}

    def wallpapers(self):
        """The preset backgrounds prepared by wallpapers.py, only those whose files exist."""
        if self.appearance is None:
            return {"categories": []}
        library = Path(self.appearance.browser_root) / "wallpapers"
        try:
            index = json.loads(read_regular(library / "index.json", 512 * 1024))
            categories = []
            for category in index["categories"]:
                items = []
                for item in category["items"]:
                    if not (isinstance(item["id"], str) and WALLPAPER_ROUTE.fullmatch(f"/api/wallpapers/{item['id']}.jpg")
                            and isinstance(item["sha256"], str) and re.fullmatch(r"[0-9a-f]{64}", item["sha256"])):
                        continue
                    if (library / f"{item['id']}.jpg").is_file() and (library / f"{item['id']}-thumb.jpg").is_file():
                        public = {"id": item["id"], "sha256": item["sha256"]}
                        for key in ("credit", "color"):
                            if isinstance(item.get(key), str) and len(item[key]) <= 100:
                                public[key] = item[key]
                        items.append(public)
                if items and isinstance(category.get("id"), str) and isinstance(category.get("name"), str):
                    categories.append({"id": category["id"][:40], "name": category["name"][:40], "items": items})
            return {"categories": categories, "library": library}
        except (OSError, ValueError, KeyError, TypeError):
            return {"categories": []}

    def preset_background(self, identifier):
        """Bytes and hash of one preset, re-checked against the library index."""
        index = self.wallpapers()
        item = next((i for c in index["categories"] for i in c["items"] if i["id"] == identifier), None)
        if item is None:
            raise InvalidSettings("Ese fondo de serie no está disponible.")
        image = read_regular(index["library"] / f"{identifier}.jpg", profiles_module.media.MAX_BACKGROUND_JPEG)
        if hashlib.sha256(image).hexdigest() != item["sha256"]:
            raise StateUnavailable("El fondo de serie está dañado; vuelve a instalar Kitsune.")
        return item["sha256"], image

    def store_background(self, digest, image):
        path = self.appearance.background(digest)
        directory = path.parent
        if directory.is_symlink() or not directory.is_dir() or directory.stat().st_uid != os.getuid():
            raise StateUnavailable("La carpeta del perfil no es válida.")
        descriptor, temporary = tempfile.mkstemp(prefix=".background-", suffix=".tmp", dir=directory)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                os.fchmod(handle.fileno(), 0o600)
                handle.write(image)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
            temporary = None
        finally:
            if temporary is not None:
                try:
                    os.unlink(temporary)
                except FileNotFoundError:
                    pass

    def handle_error(self, request, client_address):
        # Request bodies, tokens and private links must never enter the logs.
        self.event("request_failed", "unknown", 500)


class HomeHandler(BaseHTTPRequestHandler):
    server_version = "KitsuneHome/1"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, format, *args):
        pass

    def respond(self, status, body, content_type="application/json; charset=utf-8", head=False):
        if status >= 400 or self.command in ("PUT", "POST", "PATCH"):
            path = self.request_path()
            route = {"/api/settings": "settings", "/api/profiles": "profiles", "/api/appearance": "appearance",
                     "/api/background": "background"}.get(path, "unknown")
            if BACKGROUND_ROUTE.fullmatch(path or ""):
                route = "background"
            if path == "/api/wallpapers" or WALLPAPER_ROUTE.fullmatch(path or ""):
                route = "wallpapers"
            if re.fullmatch(r"/api/profiles/(default|p-[0-9a-f]{16})(?:/(open|default))?", path or ""):
                route = "profile_action"
            if re.fullmatch(r"/api/profile-avatars/(default|p-[0-9a-f]{16})/[0-9a-f]{64}\.png", path or ""):
                route = "avatar"
            self.server.event("request_complete", route, status)
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def json_response(self, status, value, head=False):
        body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.respond(status, body, head=head)

    def error(self, status, message):
        self.close_connection = True
        self.json_response(status, {"error": message}, head=self.command == "HEAD")

    def trusted_request(self, mutation=False):
        hosts = self.headers.get_all("Host", [])
        origins = self.headers.get_all("Origin", [])
        if hosts != [self.server.host]:
            self.error(403, "Host no permitido.")
            return False
        if len(origins) > 1 or (origins and origins != [self.server.origin]) or (mutation and not origins):
            self.error(403, "Origen no permitido.")
            return False
        if mutation:
            tokens = self.headers.get_all("X-Kitsune-Token", [])
            if len(tokens) != 1 or not tokens[0].isascii() or not secrets.compare_digest(tokens[0], self.server.token):
                self.error(403, "Token local no válido.")
                return False
        return True

    def request_path(self):
        if not self.path.startswith("/") or self.path.startswith("//"):
            return None
        # Do not unquote paths: only these literal, enumerated routes exist.
        return self.path.split("?", 1)[0]

    def do_GET(self, head=False):
        if not self.trusted_request():
            return
        path = self.request_path()
        if path == "/api/appearance":
            try:
                self.json_response(200, self.server.refresh_appearance(), head=head)
            except (OSError, ValueError, TypeError):
                self.error(503, "No se puede actualizar la apariencia ahora. Tus ajustes siguen guardados.")
            return
        avatar = re.fullmatch(r"/api/profile-avatars/(default|p-[0-9a-f]{16})/([0-9a-f]{64})\.png", path or "")
        if avatar:
            if self.server.profiles is None:
                self.error(503, "Las fotos de perfil no están disponibles.")
                return
            try:
                body = self.server.profiles.avatar(avatar[1], avatar[2])
                self.respond(200, body, "image/png", head=head)
            except (profiles_module.InvalidProfile, profiles_module.ProfileNotFound, FileNotFoundError):
                self.error(404, "La foto del perfil no está disponible.")
            except OSError:
                self.error(503, "No se puede leer la foto del perfil.")
            return
        if path == "/api/rendimiento":
            self.json_response(200, self.server.memory(), head=head)
            return
        if path == "/api/wallpapers":
            index = self.server.wallpapers()
            self.json_response(200, {"categories": index["categories"]}, head=head)
            return
        wallpaper = WALLPAPER_ROUTE.fullmatch(path or "")
        if wallpaper:
            index = self.server.wallpapers()
            if not any(i["id"] == wallpaper[1] for c in index["categories"] for i in c["items"]):
                self.error(404, "Ese fondo de serie no está disponible.")
                return
            try:
                body = read_regular(index["library"] / f"{wallpaper[1]}-thumb.jpg", 1024 * 1024)
                self.respond(200, body, "image/jpeg", head=head)
            except OSError:
                self.error(503, "No se puede leer el fondo de serie.")
            return
        background = BACKGROUND_ROUTE.fullmatch(path or "")
        if background:
            try:
                if self.server.appearance is None or self.server.store.snapshot()["data"]["background"] != background[1]:
                    raise FileNotFoundError(path)
                body = read_regular(self.server.appearance.background(background[1]), profiles_module.media.MAX_BACKGROUND_JPEG)
                self.respond(200, body, "image/jpeg", head=head)
            except FileNotFoundError:
                self.error(404, "El fondo no está disponible.")
            except (OSError, StateUnavailable):
                self.error(503, "No se puede leer el fondo.")
            return
        if path == "/api/settings":
            try:
                value = self.server.store.snapshot()
                value["token"] = self.server.token
                self.json_response(200, value, head=head)
            except StateUnavailable:
                self.error(503, "No se pueden leer los ajustes locales.")
            return
        if path == "/api/profiles":
            if self.server.profiles is None:
                self.error(503, "La gestión de perfiles no está disponible en esta instalación.")
                return
            try:
                value = self.server.profiles.snapshot(self.server.current_id)
                value["token"] = self.server.token
                self.json_response(200, value, head=head)
            except (profiles_module.ProfilesUnavailable, profiles_module.ProfileNotFound, profiles_module.InvalidProfile):
                self.error(503, "No se pueden leer los perfiles locales. Sus datos no se han modificado.")
            return
        if HELP_ROUTE.fullmatch(path or ""):
            filename, content_type = "ayuda.html", "text/html; charset=utf-8"
        elif path not in ASSETS:
            self.error(404, "Recurso no encontrado.")
            return
        else:
            filename, content_type = ASSETS[path]
        try:
            body = read_regular(self.server.root / filename, 16 * 1024 * 1024)
        except FileNotFoundError:
            self.error(404, "Recurso no encontrado.")
            return
        except OSError:
            self.error(503, "El recurso local no está disponible.")
            return
        if filename in ("index.html", "ayuda.html"):
            # El tema llega ya en el HTML: el inicio en Oscuro no parpadea en claro al abrirse.
            try:
                dark = self.server.store.snapshot()["data"]["theme"] == "oscuro"
            except StateUnavailable:
                dark = False
            if dark:
                body = body.replace(b'<html lang="es">', b'<html lang="es" data-theme="oscuro">', 1)
                body = body.replace(b'<meta name="theme-color" content="#f6f5f1">', b'<meta name="theme-color" content="#161a19">', 1)
                body = body.replace(b'<link rel="icon" href="favicon.svg"', b'<link rel="icon" href="favicon-dark.svg"', 1)
                body = body.replace(b'<link rel="icon" href="/favicon.svg"', b'<link rel="icon" href="/favicon-dark.svg"', 1)
        self.respond(200, body, content_type, head=head)

    def do_HEAD(self):
        self.do_GET(head=True)

    def do_PUT(self):
        if not self.trusted_request(mutation=True):
            return
        if self.request_path() != "/api/settings":
            self.error(404, "Recurso no encontrado.")
            return
        types = self.headers.get_all("Content-Type", [])
        if len(types) != 1 or self.headers.get_content_type() != "application/json" or self.headers.get_content_charset("utf-8").lower() != "utf-8":
            self.error(415, "Se requiere JSON UTF-8.")
            return
        lengths = self.headers.get_all("Content-Length", [])
        if self.headers.get_all("Transfer-Encoding") or len(lengths) != 1 or not lengths[0].isdigit():
            self.error(400, "Longitud de solicitud no válida.")
            return
        if len(lengths[0]) > 10:
            self.error(413, "La solicitud es demasiado grande.")
            return
        size = int(lengths[0])
        if size > MAX_BODY:
            self.error(413, "La solicitud es demasiado grande.")
            return
        try:
            raw = self.rfile.read(size)
            if len(raw) != size:
                raise ValueError("Incomplete request")
            value = json.loads(raw.decode("utf-8"))
            if type(value) is not dict or set(value) != {"data", "revision"}:
                raise InvalidSettings("La estructura de la solicitud no es válida.")
            with self.server.background_lock:
                before = self.server.store.snapshot()["data"]["background"]
                updated, snapshot = self.server.store.update(value["data"], value["revision"])
                if updated and snapshot["data"]["background"] != before:
                    self.server.prune_backgrounds()
            snapshot["token"] = self.server.token
            if not updated:
                snapshot["error"] = "Los ajustes han cambiado en otra pestaña."
            elif self.server.appearance is not None:
                try:
                    snapshot["appearance"] = self.server.refresh_appearance()
                except (OSError, ValueError, TypeError):
                    snapshot["warning"] = "Los ajustes están guardados; la apariencia nativa se aplicará cuando esté disponible."
                    self.server.event("appearance_unavailable", "appearance", 503)
            self.json_response(200 if updated else 409, snapshot)
        except (TimeoutError, ConnectionError):
            self.error(408, "La solicitud no se ha recibido a tiempo.")
        except InvalidSettings as error:
            self.error(400, str(error))
        except (ValueError, UnicodeError, TypeError, RecursionError):
            self.error(400, "JSON no válido.")
        except StateUnavailable:
            self.error(503, "No se han podido guardar los ajustes locales.")

    def profile_mutation(self):
        path = self.request_path()
        match = re.fullmatch(r"/api/profiles/(default|p-[0-9a-f]{16})(?:/(open|default))?", path or "")
        if not (path == "/api/profiles" or match):
            self.error(405, "Método no permitido.")
            return
        action = "create" if path == "/api/profiles" else (match[2] or "edit")
        if (self.command == "PATCH") != (action == "edit"):
            self.error(405, "Método no permitido.")
            return
        if not self.trusted_request(mutation=True):
            return
        if self.server.profiles is None:
            self.error(503, "La gestión de perfiles no está disponible en esta instalación.")
            return
        types = self.headers.get_all("Content-Type", [])
        if len(types) != 1 or self.headers.get_content_type() != "application/json" or self.headers.get_content_charset("utf-8").lower() != "utf-8":
            self.error(415, "Se requiere JSON UTF-8.")
            return
        lengths = self.headers.get_all("Content-Length", [])
        if self.headers.get_all("Transfer-Encoding") or len(lengths) != 1 or not lengths[0].isdigit():
            self.error(400, "Longitud de solicitud no válida.")
            return
        limit = MAX_PROFILE_BODY if action in ("create", "edit") else MAX_BODY
        if len(lengths[0]) > 10 or int(lengths[0]) > limit:
            self.error(413, "La solicitud es demasiado grande.")
            return
        try:
            size = int(lengths[0])
            raw = self.rfile.read(size)
            if len(raw) != size:
                raise ValueError("Incomplete request")
            value = json.loads(raw.decode("utf-8"))
            expected = {"name", "email", "color", "revision"} if action in ("create", "edit") else {"revision"}
            if type(value) is not dict:
                raise profiles_module.InvalidProfile("La solicitud del perfil no es válida.")
            if action == "open":
                if set(value) not in ({"action"}, {"action", "revision"}):
                    raise profiles_module.InvalidProfile("La solicitud de apertura no es válida.")
            elif action in ("create", "edit") and not expected <= set(value) <= expected | {"avatarData", "rememberGoogle", "privacyMode"}:
                raise profiles_module.InvalidProfile("La solicitud del perfil no es válida.")
            elif action not in ("create", "edit") and set(value) != expected:
                raise profiles_module.InvalidProfile("La solicitud del perfil no es válida.")
            manager = self.server.profiles
            common = {"current_id": self.server.current_id}
            if action == "create":
                snapshot = manager.create(**value, **common)
            elif action == "edit":
                snapshot = manager.edit(match[1], **value, **common)
            elif action == "default":
                snapshot = manager.set_default(match[1], **value, **common)
            else:
                snapshot = manager.open(match[1], **value, **common)
            if action in ("create", "edit") and self.server.appearance is not None:
                target = snapshot["createdId"] if action == "create" else match[1]
                try:
                    self.server.refresh_appearance(target)
                except (OSError, ValueError, TypeError):
                    snapshot["warning"] = "El perfil está guardado; sus preferencias se aplicarán cuando esté disponible."
                    self.server.event("appearance_unavailable", "appearance", 503)
            snapshot["token"] = self.server.token
            self.json_response(200, snapshot)
        except profiles_module.ProfileConflict as error:
            snapshot = error.snapshot
            snapshot.update(error=str(error), token=self.server.token)
            self.json_response(409, snapshot)
        except profiles_module.InvalidProfile as error:
            self.error(400, str(error))
        except profiles_module.ProfileNotFound as error:
            self.error(404, str(error))
        except profiles_module.ProfilesUnavailable as error:
            self.error(503, str(error))
        except (TimeoutError, ConnectionError):
            self.error(408, "La solicitud no se ha recibido a tiempo.")
        except (ValueError, UnicodeError, TypeError, RecursionError):
            self.error(400, "JSON no válido.")
        except OSError:
            self.error(503, "No se ha podido completar la operación local. Tus datos siguen guardados.")

    def background_upload(self):
        """Store a new home background: normalized here, never the uploaded file."""
        if not self.trusted_request(mutation=True):
            return
        if self.server.appearance is None:
            self.error(503, "El fondo propio no está disponible en esta instalación.")
            return
        types = self.headers.get_all("Content-Type", [])
        if len(types) != 1 or self.headers.get_content_type() != "application/json" or self.headers.get_content_charset("utf-8").lower() != "utf-8":
            self.error(415, "Se requiere JSON UTF-8.")
            return
        lengths = self.headers.get_all("Content-Length", [])
        if self.headers.get_all("Transfer-Encoding") or len(lengths) != 1 or not lengths[0].isdigit():
            self.error(400, "Longitud de solicitud no válida.")
            return
        if len(lengths[0]) > 10 or int(lengths[0]) > MAX_BACKGROUND_BODY:
            self.error(413, "La imagen es demasiado grande. Elige una de hasta 12 MB.")
            return
        try:
            size = int(lengths[0])
            raw = self.rfile.read(size)
            if len(raw) != size:
                raise ValueError("Incomplete request")
            value = json.loads(raw.decode("utf-8"))
            if type(value) is dict and set(value) == {"imageData"}:
                digest, image = profiles_module.media.normalize_background(value["imageData"])
            elif type(value) is dict and set(value) == {"preset"} and isinstance(value["preset"], str):
                digest, image = self.server.preset_background(value["preset"])
            else:
                raise InvalidSettings("La solicitud del fondo no es válida.")
            with self.server.background_lock:
                try:
                    self.server.store_background(digest, image)
                    for _ in range(3):
                        current = self.server.store.snapshot()
                        updated, snapshot = self.server.store.update({**current["data"], "background": digest},
                                                                     current["revision"], new_background=digest)
                        if updated:
                            break
                    else:
                        raise StateUnavailable("Los ajustes cambian sin parar.")
                finally:
                    self.server.prune_backgrounds()
            snapshot["token"] = self.server.token
            try:
                snapshot["appearance"] = self.server.refresh_appearance()
            except (OSError, ValueError, TypeError):
                snapshot["warning"] = "El fondo está guardado; el navegador lo aplicará cuando esté disponible."
                self.server.event("appearance_unavailable", "appearance", 503)
            self.json_response(200, snapshot)
        except profiles_module.media.InvalidAvatar as error:
            self.error(400, str(error))
        except profiles_module.media.AvatarUnavailable as error:
            self.error(503, str(error))
        except (TimeoutError, ConnectionError):
            self.error(408, "La solicitud no se ha recibido a tiempo.")
        except InvalidSettings as error:
            self.error(400, str(error))
        except (ValueError, UnicodeError, TypeError, RecursionError):
            self.error(400, "JSON no válido.")
        except (StateUnavailable, OSError):
            self.error(503, "No se ha podido guardar el fondo. Tus ajustes siguen como estaban.")

    def do_POST(self):
        if self.request_path() == "/api/background":
            self.background_upload()
            return
        self.profile_mutation()

    def do_PATCH(self):
        self.profile_mutation()

    def unsupported_method(self):
        self.error(405, "Método no permitido.")

    do_DELETE = unsupported_method
    do_OPTIONS = unsupported_method


def create_server(root, state, port=49721, profiles=None, current_id="default", appearance=None):
    """Create an unstarted loopback server; port=0 chooses an isolated test port."""
    if type(port) is not int or not 0 <= port <= 65535:
        raise ValueError("Port must be between 0 and 65535")
    return HomeServer(root, state, port, profiles=profiles, current_id=current_id, appearance=appearance)


def make_appearance(browser_root, state_root, current_id):
    path = Path(__file__).with_name("appearance.py")
    if not path.is_file():
        return None
    spec = importlib.util.spec_from_file_location("kitsune_local_appearance", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.AppearanceManager(browser_root, state_root, current_id)


def notify_ready(server):
    """Tell a notify-type user service that the HTTP socket is bound/listening."""
    address = os.environ.get("NOTIFY_SOCKET")
    if not address:
        return False
    if address.startswith("@"):
        address = "\0" + address[1:]
    message = f"READY=1\nSTATUS=Kitsune Home listening on {server.origin}".encode("utf-8")
    with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as notifier:
        notifier.sendto(message, address)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--port", type=int, default=49721)
    parser.add_argument("--profile-id")
    parser.add_argument("--browser-root", type=Path)
    parser.add_argument("--profiles-state-root", type=Path)
    parser.add_argument("--launcher", type=Path)
    options = parser.parse_args()
    manager = None
    current_id = options.profile_id or "default"
    if options.profile_id or options.browser_root or options.profiles_state_root:
        default_browser, default_state = profiles_module.default_roots()
        manager = profiles_module.ProfileManager(options.browser_root or default_browser,
                                                options.profiles_state_root or default_state,
                                                launcher=options.launcher)
        try:
            resolved = manager.resolve(current_id)
            options.state, options.port = resolved["state"], resolved["port"]
        except (profiles_module.InvalidProfile, profiles_module.ProfilesUnavailable, profiles_module.ProfileNotFound) as error:
            parser.exit(1, str(error) + "\n")
    appearance = make_appearance(manager.browser_root, manager.state_root, current_id) if manager else None
    server = create_server(options.root, options.state, options.port, profiles=manager, current_id=current_id, appearance=appearance)
    def stop(*_):
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        # ThreadingHTTPServer binds and listens in create_server. systemctl
        # start now returns only after that socket is ready for the browser.
        notify_ready(server)
        server.serve_forever(poll_interval=0.2)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

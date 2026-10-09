#!/usr/bin/env python3
"""Private, local Kitsune profile registry. Email is a label, never a login.

Only clean application templates seed new profiles. Existing browsing data is
never copied, merged, deleted or exported by this module.
"""

from __future__ import annotations

import argparse
import contextlib
import copy
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import stat
import subprocess
import tempfile
import threading

_media_spec = importlib.util.spec_from_file_location("kitsune_profile_media", Path(__file__).with_name("media.py"))
media = importlib.util.module_from_spec(_media_spec)
_media_spec.loader.exec_module(media)

MAX_REVISION = 2 ** 53 - 1
MAX_PROFILES = 24
MAX_FILE = 128 * 1024
COLORS = ("blue", "pink", "violet", "teal", "amber", "red")
# Modo de privacidad por perfil. Vive fuera del registro (privacy.json) para
# que el registro siga en v2, la única versión que entiende el puente de Vela.
PRIVACY_MODES = ("estricto", "comodo")
DEFAULT_PRIVACY_MODE = "estricto"
OMITTED = object()
ACTIONS = {
    "home": None,
    "google": "https://accounts.google.com/ServiceLogin",
    "privacy": "about:preferences#privacy",
    "sync": "about:preferences#sync",
    "sync-settings": "about:preferences#sync",
    "passwords": "about:logins",
    "settings": "about:preferences",
    "general": "about:preferences#general",
    "search": "about:preferences#search",
    "downloads": "about:downloads",
    "extensions": "about:addons",
    "sync-google": "https://accounts.firefox.com/",
}
GUI_ENVIRONMENT_KEYS = {"WAYLAND_DISPLAY", "DISPLAY", "XDG_CURRENT_DESKTOP", "XDG_SESSION_TYPE", "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"}


class InvalidProfile(ValueError):
    pass


class ProfilesUnavailable(OSError):
    pass


class ProfileNotFound(LookupError):
    pass


class ProfileConflict(Exception):
    def __init__(self, snapshot):
        self.snapshot = snapshot
        super().__init__("Los perfiles han cambiado en otra ventana. Revisa los datos y vuelve a intentarlo.")


def valid_id(value):
    return isinstance(value, str) and (value == "default" or re.fullmatch(r"p-[0-9a-f]{16}", value) is not None)


def valid_revision(value):
    return type(value) is int and 0 <= value <= MAX_REVISION


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def validate_label(name, email, color):
    if not isinstance(name, str) or not 1 <= len(name) <= 48 or name != name.strip() or any(ord(c) < 32 or ord(c) == 127 for c in name):
        raise InvalidProfile("Escribe un nombre de entre 1 y 48 caracteres.")
    if not isinstance(email, str) or len(email) > 254 or (email and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email)) or any(ord(c) < 32 or ord(c) == 127 for c in email):
        raise InvalidProfile("Escribe un correo válido o deja este campo vacío. Es una etiqueta local, no una cuenta verificada.")
    if color not in COLORS:
        raise InvalidProfile("El color del perfil no es válido.")
    try:
        name.encode("utf-8")
        email.encode("utf-8")
    except UnicodeError as error:
        raise InvalidProfile("El texto del perfil no es Unicode válido.") from error
    return {"name": name, "email": email, "color": color}


def private_directory(path):
    path = Path(path)
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise ProfilesUnavailable("La carpeta privada de perfiles no está disponible.")
    path.chmod(0o700)


def read_regular(path, limit=MAX_FILE):
    descriptor = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise ProfilesUnavailable("El archivo de perfiles no es válido.")
        data = handle.read(limit + 1)
        if len(data) > limit:
            raise ProfilesUnavailable("El archivo de perfiles supera el tamaño máximo.")
        return data


def atomic_write(path, data):
    temporary = None
    try:
        descriptor, temporary = tempfile.mkstemp(prefix=".kitsune-", suffix=".tmp", dir=path.parent)
        with os.fdopen(descriptor, "wb") as handle:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        temporary = None
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        except OSError:
            pass
        finally:
            os.close(directory)
    finally:
        if temporary is not None:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(temporary)


def validate_record(record):
    if type(record) is not dict or set(record) != {"version", "revision", "defaultId", "profiles"} or type(record["version"]) is not int or record["version"] not in (1, 2) or not valid_revision(record["revision"]):
        raise InvalidProfile("El registro de perfiles no es válido.")
    profiles = record["profiles"]
    if type(profiles) is not list or not 1 <= len(profiles) <= MAX_PROFILES:
        raise InvalidProfile("El registro de perfiles no es válido.")
    ids, ports = set(), set()
    for profile in profiles:
        expected = {"id", "name", "email", "color", "port", "createdAt", "lastUsed"}
        if record["version"] == 2:
            expected |= {"avatarHash", "rememberGoogle"}
        if type(profile) is not dict or set(profile) != expected:
            raise InvalidProfile("El registro de un perfil no es válido.")
        if record["version"] == 2:
            digest = profile["avatarHash"]
            if digest is not None and (not isinstance(digest, str) or re.fullmatch(r"[0-9a-f]{64}", digest) is None):
                raise InvalidProfile("La foto guardada del perfil no es válida.")
            if type(profile["rememberGoogle"]) is not bool:
                raise InvalidProfile("La preferencia de Google no es válida.")
        identifier = profile["id"]
        if not valid_id(identifier) or identifier in ids:
            raise InvalidProfile("El identificador de un perfil no es válido.")
        ids.add(identifier)
        port = profile["port"]
        if type(port) is not int or port in ports or (identifier == "default" and port != 49721) or (identifier != "default" and not 49722 <= port <= 49821):
            raise InvalidProfile("El puerto de un perfil no es válido.")
        ports.add(port)
        validate_label(profile["name"], profile["email"], profile["color"])
        for key in ("createdAt", "lastUsed"):
            if not isinstance(profile[key], str) or len(profile[key]) > 40:
                raise InvalidProfile("La fecha de un perfil no es válida.")
            if profile[key]:
                datetime.datetime.fromisoformat(profile[key])
    if "default" not in ids or record["defaultId"] not in ids:
        raise InvalidProfile("Falta el perfil original o el predeterminado.")
    return record


def validate_privacy_mode(value):
    if value is not OMITTED and value not in PRIVACY_MODES:
        raise InvalidProfile("El modo de privacidad debe ser Estricto o Cómodo.")


class ProfileManager:
    def __init__(self, browser_root, state_root, launcher=None, launch=None):
        self.browser_root = Path(browser_root).absolute()
        self.state_root = Path(state_root).absolute()
        self.registry = self.state_root / "profiles.json"
        self.privacy = self.state_root / "privacy.json"
        self.launcher = Path(launcher) if launcher else Path.home() / ".local/bin/kitsune-browser"
        self.launch = launch or self._launch
        self.thread_lock = threading.Lock()

    @contextlib.contextmanager
    def locked(self):
        with self.thread_lock:
            try:
                private_directory(self.state_root)
                descriptor = os.open(self.state_root / "profiles.lock", os.O_RDWR | os.O_CREAT | os.O_CLOEXEC | os.O_NOFOLLOW, 0o600)
                try:
                    if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                        raise ProfilesUnavailable("El bloqueo del registro no está disponible.")
                    fcntl.flock(descriptor, fcntl.LOCK_EX)
                    yield
                finally:
                    os.close(descriptor)
            except OSError as error:
                if isinstance(error, ProfilesUnavailable):
                    raise
                raise ProfilesUnavailable("Los perfiles locales no están disponibles.") from error

    def _read(self):
        try:
            record = validate_record(json.loads(read_regular(self.registry)))
            if record["version"] == 1:
                # Read-time migration is non-destructive. The next successful
                # atomic mutation persists v2 with the unchanged revision base.
                record["version"] = 2
                for profile in record["profiles"]:
                    profile.update(avatarHash=None, rememberGoogle=False)
            return record
        except FileNotFoundError:
            created = now()
            record = {"version": 2, "revision": 0, "defaultId": "default", "profiles": [{
                "id": "default", "name": "Personal", "email": "", "color": "blue",
                "port": 49721, "createdAt": created, "lastUsed": "", "avatarHash": None, "rememberGoogle": False,
            }]}
            self._write(record)
            return record
        except (ValueError, TypeError, UnicodeError, RecursionError) as error:
            raise ProfilesUnavailable("El registro local de perfiles necesita revisión. No se ha sobrescrito.") from error

    def _write(self, record):
        validate_record(record)
        encoded = json.dumps(record, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(encoded) > MAX_FILE:
            raise InvalidProfile("El registro de perfiles es demasiado grande.")
        atomic_write(self.registry, encoded)

    def _read_privacy(self, strict=False):
        """Return {profile id: mode}. Missing → {}; invalid → {} (Estricto) unless strict."""
        try:
            value = json.loads(read_regular(self.privacy))
            if (type(value) is not dict or set(value) != {"version", "modes"} or value["version"] != 1
                    or type(value["modes"]) is not dict or len(value["modes"]) > MAX_PROFILES
                    or any(not valid_id(key) or mode not in PRIVACY_MODES for key, mode in value["modes"].items())):
                raise ValueError("Invalid privacy modes")
            return dict(value["modes"])
        except FileNotFoundError:
            return {}
        except (ValueError, TypeError, UnicodeError, RecursionError) as error:
            if strict:
                raise ProfilesUnavailable("Los modos de privacidad guardados necesitan revisión. No se han sobrescrito.") from error
            return {}

    def _write_privacy(self, modes):
        encoded = json.dumps({"version": 1, "modes": modes}, separators=(",", ":"), sort_keys=True).encode("utf-8")
        atomic_write(self.privacy, encoded)

    def _commit(self, record, identifier, privacy_mode):
        """Write the privacy mode (if given) and then the registry, under the caller's lock."""
        if privacy_mode is OMITTED:
            self._write(record)
            return
        previous = self._read_privacy(strict=True)
        modes = {**previous, identifier: privacy_mode}
        if modes != previous:
            self._write_privacy(modes)
        try:
            self._write(record)
        except OSError:
            if modes != previous:
                with contextlib.suppress(OSError):
                    self._write_privacy(previous)
            raise

    def _snapshot(self, record, current_id):
        self._find(record, current_id)
        result = {"version": 1, "revision": record["revision"], "currentId": current_id,
                  "defaultId": record["defaultId"], "profiles": []}
        modes = self._read_privacy()
        for profile in record["profiles"]:
            public = {key: value for key, value in profile.items() if key not in ("port", "avatarHash")}
            public["avatar"] = f"/api/profile-avatars/{profile['id']}/{profile['avatarHash']}.png" if profile["avatarHash"] else None
            public.update(isDefault=profile["id"] == record["defaultId"], isCurrent=profile["id"] == current_id,
                          privacyMode=modes.get(profile["id"], DEFAULT_PRIVACY_MODE))
            result["profiles"].append(public)
        return result

    def snapshot(self, current_id="default"):
        with self.locked():
            return self._snapshot(self._read(), current_id)

    def _find(self, record, identifier):
        if not valid_id(identifier):
            raise InvalidProfile("El identificador del perfil no es válido.")
        for profile in record["profiles"]:
            if profile["id"] == identifier:
                return profile
        raise ProfileNotFound("No se ha encontrado ese perfil.")

    def _check_revision(self, record, revision, current_id):
        if not valid_revision(revision):
            raise InvalidProfile("La revisión del registro no es válida.")
        if revision != record["revision"]:
            raise ProfileConflict(self._snapshot(record, current_id))
        if record["revision"] == MAX_REVISION:
            raise ProfilesUnavailable("No se puede actualizar la revisión del registro.")

    def _new_port(self, record):
        used = {profile["port"] for profile in record["profiles"]}
        for port in range(49722, 49822):
            if port not in used:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                    try:
                        probe.bind(("127.0.0.1", port))
                    except OSError:
                        continue
                return port
        raise ProfilesUnavailable("No hay un puerto local disponible para otro perfil.")

    def _avatar_value(self, value):
        if value is OMITTED or value is None:
            return value
        try:
            return media.normalize_avatar(value)
        except media.InvalidAvatar as error:
            raise InvalidProfile(str(error)) from error
        except media.AvatarUnavailable as error:
            raise ProfilesUnavailable(str(error)) from error

    def _avatar_path(self, identifier, digest):
        if not valid_id(identifier) or not isinstance(digest, str) or re.fullmatch(r"[0-9a-f]{64}", digest) is None:
            raise InvalidProfile("La foto del perfil no es válida.")
        return self.state_root / "avatars" / identifier / (digest + ".png")

    def _store_avatar(self, identifier, value):
        if value is None or value is OMITTED:
            return None
        digest, png = value
        path = self._avatar_path(identifier, digest)
        private_directory(self.state_root / "avatars")
        private_directory(path.parent)
        atomic_write(path, png)
        return digest

    def _discard_avatar(self, identifier, digest):
        if digest:
            with contextlib.suppress(OSError):
                self._avatar_path(identifier, digest).unlink()

    def avatar(self, identifier, digest):
        with self.locked():
            profile = self._find(self._read(), identifier)
            if not profile["avatarHash"] or profile["avatarHash"] != digest:
                raise ProfileNotFound("La foto del perfil no está disponible.")
            data = read_regular(self._avatar_path(identifier, digest), media.MAX_AVATAR_PNG)
            if not data.startswith(b"\x89PNG\r\n\x1a\n") or hashlib.sha256(data).hexdigest() != digest:
                raise ProfilesUnavailable("La foto guardada no se puede verificar. Elige otra foto.")
            return data

    def create(self, name, email, color, revision, current_id="default", avatarData=OMITTED, rememberGoogle=OMITTED,
               privacyMode=OMITTED):
        labels = validate_label(name, email, color)
        avatar = self._avatar_value(avatarData)
        if rememberGoogle is not OMITTED and type(rememberGoogle) is not bool:
            raise InvalidProfile("La preferencia de Google debe estar activada o desactivada.")
        validate_privacy_mode(privacyMode)
        with self.locked():
            record = self._read()
            self._check_revision(record, revision, current_id)
            if len(record["profiles"]) >= MAX_PROFILES:
                raise InvalidProfile(f"Se permiten hasta {MAX_PROFILES} perfiles locales.")
            identifier = "p-" + secrets.token_hex(8)
            while any(p["id"] == identifier for p in record["profiles"]):
                identifier = "p-" + secrets.token_hex(8)
            profile = {"id": identifier, **labels, "port": self._new_port(record), "createdAt": now(), "lastUsed": "",
                       "avatarHash": None, "rememberGoogle": False if rememberGoogle is OMITTED else rememberGoogle}
            # Prepare only new, clean files before committing the registry. A
            # failed registry write never claims the profile was created. Any
            # orphaned template-only directory remains private and recoverable.
            self._initialize(profile)
            profile["avatarHash"] = self._store_avatar(identifier, avatar)
            record["profiles"].append(profile)
            record["revision"] += 1
            try:
                self._commit(record, identifier, privacyMode)
            except OSError:
                self._discard_avatar(identifier, profile["avatarHash"])
                raise
            result = self._snapshot(record, current_id)
            result["createdId"] = identifier
            return result

    def edit(self, identifier, name, email, color, revision, current_id="default", avatarData=OMITTED, rememberGoogle=OMITTED,
             privacyMode=OMITTED):
        labels = validate_label(name, email, color)
        avatar = self._avatar_value(avatarData)
        if rememberGoogle is not OMITTED and type(rememberGoogle) is not bool:
            raise InvalidProfile("La preferencia de Google debe estar activada o desactivada.")
        validate_privacy_mode(privacyMode)
        with self.locked():
            record = self._read()
            self._check_revision(record, revision, current_id)
            profile = self._find(record, identifier)
            old_hash = profile["avatarHash"]
            profile.update(labels)
            if avatar is not OMITTED:
                profile["avatarHash"] = self._store_avatar(identifier, avatar)
            if rememberGoogle is not OMITTED:
                profile["rememberGoogle"] = rememberGoogle
            record["revision"] += 1
            try:
                self._commit(record, identifier, privacyMode)
            except OSError:
                if profile["avatarHash"] != old_hash:
                    self._discard_avatar(identifier, profile["avatarHash"])
                raise
            if profile["avatarHash"] != old_hash:
                self._discard_avatar(identifier, old_hash)
            return self._snapshot(record, current_id)

    def set_default(self, identifier, revision, current_id="default"):
        with self.locked():
            record = self._read()
            self._check_revision(record, revision, current_id)
            self._find(record, identifier)
            record["defaultId"] = identifier
            record["revision"] += 1
            self._write(record)
            return self._snapshot(record, current_id)

    def paths(self, profile):
        identifier = profile["id"]
        if not valid_id(identifier):
            raise InvalidProfile("El identificador del perfil no es válido.")
        return {
            "profile": self.browser_root / ("profile" if identifier == "default" else f"profiles/{identifier}/profile"),
            "state": self.state_root / ("home.json" if identifier == "default" else f"profiles/{identifier}/home.json"),
            "home": f"http://127.0.0.1:{profile['port']}/",
            "port": profile["port"],
            "service": "kitsune-home.service" if identifier == "default" else f"kitsune-home@{identifier}.service",
            "remoting": "kitsune-browser" if identifier == "default" else f"kitsune-{identifier}",
        }

    def _initialize(self, profile):
        paths = self.paths(profile)
        if profile["id"] == "default":
            # Never rewrite the existing profile, including any future choices.
            return paths
        private_directory(self.browser_root)
        private_directory(self.browser_root / "profiles")
        private_directory(paths["profile"].parent)
        private_directory(self.state_root / "profiles")
        private_directory(paths["state"].parent)
        destination = paths["profile"]
        if destination.exists():
            if destination.is_symlink() or not destination.is_dir():
                raise ProfilesUnavailable("La carpeta del perfil no es válida.")
            return paths
        templates = self.browser_root / "templates"
        prefs = read_regular(templates / "user.js").decode("utf-8")
        # The only personalized startup pref. Security remains the template's.
        prefs += "\n// Kitsune local profile home; independent origin and storage.\n"
        prefs += 'user_pref("browser.startup.homepage", ' + json.dumps(paths["home"]) + ');\n'
        temporary = Path(tempfile.mkdtemp(prefix=".profile-", dir=destination.parent))
        try:
            atomic_write(temporary / "user.js", prefs.encode("utf-8"))
            chrome_source = templates / "chrome"
            if not chrome_source.is_dir() or chrome_source.is_symlink():
                raise ProfilesUnavailable("Falta la plantilla visual de Kitsune.")
            for source in chrome_source.rglob("*"):
                if source.is_symlink() or not (source.is_file() or source.is_dir()):
                    raise ProfilesUnavailable("La plantilla visual contiene un archivo no permitido.")
            shutil.copytree(chrome_source, temporary / "chrome")
            search = templates / "default-search.json.mozlz4"
            if search.exists():
                atomic_write(temporary / "search.json.mozlz4", read_regular(search, 2 * 1024 * 1024))
            os.rename(temporary, destination)
        finally:
            # Only uncommitted files created by this call, never user data.
            if temporary.exists():
                shutil.rmtree(temporary)
        return paths

    def resolve(self, identifier=None, initialize=True):
        with self.locked():
            record = self._read()
            profile = copy.deepcopy(self._find(record, identifier or record["defaultId"]))
            paths = self._initialize(profile) if initialize else self.paths(profile)
            mode = self._read_privacy().get(profile["id"], DEFAULT_PRIVACY_MODE)
            return {"id": profile["id"], **paths, "privacyMode": mode}

    def open(self, identifier, action="home", revision=None, current_id="default"):
        if not isinstance(action, str) or action not in ACTIONS:
            raise InvalidProfile("La acción del perfil no es válida.")
        with self.locked():
            record = self._read()
            if revision is not None:
                self._check_revision(record, revision, current_id)
            elif record["revision"] == MAX_REVISION:
                raise ProfilesUnavailable("No se puede actualizar el registro de perfiles.")
            profile = self._find(record, identifier)
            self._initialize(profile)
            previous = copy.deepcopy(record)
            profile["lastUsed"] = now()
            record["revision"] += 1
            self._write(record)
            try:
                self.launch(identifier, action)
            except (OSError, subprocess.SubprocessError) as error:
                self._write(previous)
                raise ProfilesUnavailable("No se ha podido abrir el perfil. Sus datos siguen guardados.") from error
            result = self._snapshot(record, current_id)
            result["openedId"] = identifier
            # Dispatch is confirmed; asynchronous window creation is not an
            # authentication or completed navigation success claim.
            result["launchRequested"] = True
            return result

    def _launch(self, identifier, action):
        # No shell, no client-supplied URL/command/environment. All actions are
        # enumerated here and interpreted by our own installed launcher.
        # A separate transient user service is essential: a browser must not
        # inherit the home HTTP service's restricted address families or die
        # when that service restarts. Type=exec confirms process dispatch, not
        # completed navigation. It does not wait for the profile lock below.
        environment = desktop_environment()
        command = ["systemd-run", "--user", "--collect", "--quiet", "--property=Type=exec",
                   "--unit=kitsune-window-" + identifier + "-" + secrets.token_hex(4)]
        for key in sorted(GUI_ENVIRONMENT_KEYS):
            value = environment.get(key)
            if value and "\0" not in value and len(value) <= 4096:
                command.append("--setenv=" + key + "=" + value)
        command.extend(["--", str(self.launcher), "--kitsune-profile", identifier, "--kitsune-action", action])
        subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, check=True, timeout=3, env=environment)


def desktop_environment():
    """Refresh only GUI routing values from the user service manager."""
    environment = os.environ.copy()
    try:
        result = subprocess.run(["systemctl", "--user", "show-environment"], capture_output=True,
                                text=True, check=True, timeout=1)
        for line in result.stdout.splitlines():
            key, separator, value = line.partition("=")
            if separator and key in GUI_ENVIRONMENT_KEYS and "\0" not in value and len(value) <= 4096:
                environment[key] = value
    except (OSError, subprocess.SubprocessError, UnicodeError):
        pass
    return environment


def default_roots():
    return (Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share"))) / "kitsune-browser",
            Path(os.environ.get("XDG_STATE_HOME", str(Path.home() / ".local/state"))) / "kitsune-browser")


def main():
    browser_root, state_root = default_roots()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser-root", type=Path, default=browser_root)
    parser.add_argument("--state-root", type=Path, default=state_root)
    subcommands = parser.add_subparsers(dest="command", required=True)
    resolve = subcommands.add_parser("resolve")
    resolve.add_argument("--id")
    resolve.add_argument("--field", choices=("id", "profile", "state", "home", "port", "service", "remoting", "privacyMode"))
    subcommands.add_parser("list")
    options = parser.parse_args()
    manager = ProfileManager(options.browser_root, options.state_root)
    try:
        if options.command == "resolve":
            result = manager.resolve(options.id)
            if options.field:
                print(result[options.field])
            else:
                # JSON is data, never shell-evaluated by the launcher.
                print(json.dumps(result, default=str))
        else:
            print(json.dumps(manager.snapshot(), ensure_ascii=False))
    except (InvalidProfile, ProfilesUnavailable, ProfileNotFound, OSError) as error:
        parser.exit(1, str(error) + "\n")


if __name__ == "__main__":
    main()

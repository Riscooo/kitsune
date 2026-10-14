"""Small, local appearance protocol shared by the home and native Kitsune UI.

Only validated colors/enums and the explicit Google retention option cross this
boundary. No credentials, arbitrary CSS, URLs, commands or browser data do.
"""
from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import threading
import time

_tintas_spec = importlib.util.spec_from_file_location('kitsune_tintas', Path(__file__).with_name('tintas.py'))
tintas = importlib.util.module_from_spec(_tintas_spec)
_tintas_spec.loader.exec_module(tintas)

KEYS = ('bg', 'surface', 'surfaceHigh', 'text', 'muted', 'outline', 'primary', 'primaryContainer', 'secondary', 'tertiary')
# Kitsune «Tinta»: papel de InkShadow (src/theme/InkTheme.qml) en Claro y su
# negativo, tinta sumi con el óxido y el jade aclarados, en Oscuro. Mismos
# contrastes de texto que el papel (WCAG AA o más).
PAPEL = dict(zip(KEYS, ('#f6f5f1', '#fbfaf7', '#e8ece4', '#252d2b', '#59625c', '#c7cdc4', '#963d32', '#eadfda', '#496b60', '#73786f')))
SUMI = dict(zip(KEYS, ('#161a19', '#1e2321', '#2a302d', '#ebe8e0', '#a9b0a8', '#3f4743', '#e0806b', '#4b2a23', '#8fb8aa', '#8d9389')))
PALETTES = {'claro': PAPEL, 'oscuro': SUMI}
BACKGROUND = re.compile(r'[0-9a-f]{64}')


def background_path(profile, digest):
    """The one place a home background lives: next to the profile's chrome CSS."""
    if not isinstance(digest, str) or not BACKGROUND.fullmatch(digest):
        raise ValueError('Invalid background')
    return Path(profile) / 'chrome' / f'kitsune-background-{digest}.jpg'

def read_json(path, maximum=262144):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    with os.fdopen(descriptor, 'rb') as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_size > maximum:
            raise ValueError('Invalid local appearance file')
        value = handle.read(maximum + 1)
        if len(value) > maximum:
            raise ValueError('Local appearance file too large')
        return json.loads(value)


def private_write(path, value):
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
    if len(payload) > 8192:
        raise ValueError('Appearance control too large')
    path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    if path.parent.is_symlink() or path.is_symlink():
        raise ValueError('Appearance destination is linked')
    try:
        if read_json(path, 8192) == value:
            return
    except (FileNotFoundError, ValueError):
        pass
    descriptor, temporary = tempfile.mkstemp(prefix='.appearance-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as handle:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)


PRIVACY_KINDS = ('trackers', 'cookies', 'cryptominers', 'fingerprinters', 'social', 'bounce', 'total')


def valid_privacy(value, now=None):
    """Solo números enteros por tipo, de hace menos de dos días; si no, «no disponible»."""
    now = time.time() * 1000 if now is None else now
    if not isinstance(value, dict) or value.get('version') != 1 or set(value) != {'version', 'at', 'today', 'week'}:
        return {'available': False}
    at = value['at']
    if type(at) not in (int, float) or not 0 <= now - at < 2 * 86400000:
        return {'available': False}
    out = {'available': True, 'at': int(at)}
    for period in ('today', 'week'):
        counts = value[period]
        if not isinstance(counts, dict) or set(counts) != set(PRIVACY_KINDS) or any(type(counts[k]) is not int or counts[k] < 0 for k in PRIVACY_KINDS):
            return {'available': False}
        out[period] = {k: counts[k] for k in PRIVACY_KINDS}
    return out


class AppearanceManager:
    def __init__(self, browser_root, state_root, current_id='default'):
        if current_id != 'default' and not re.fullmatch(r'p-[0-9a-f]{16}', current_id):
            raise ValueError('Invalid appearance profile')
        self.browser_root = Path(browser_root)
        self.state_root = Path(state_root)
        self.current_id = current_id
        self.profile = self.browser_root / ('profile' if current_id == 'default' else f'profiles/{current_id}/profile')
        self.control = self.profile / 'chrome/kitsune-appearance.json'
        self.ack = self.profile / 'chrome/kitsune-appearance-ack.json'
        self.lock = threading.Lock()

    def language(self):
        """El idioma de la interfaz que apunta el módulo nativo («es-ES», «en-US»…); castellano si no lo hay."""
        try:
            value = read_json(self.profile / 'chrome/kitsune-idioma.json', 1024)
        except (OSError, ValueError):
            return {'locale': 'es-ES'}
        locale = value.get('locale') if isinstance(value, dict) and value.get('version') == 1 else None
        return {'locale': locale if isinstance(locale, str) and re.fullmatch(r'[a-z]{2,3}(-[A-Za-z0-9]{2,8})*', locale) else 'es-ES'}

    def privacy(self):
        """El resumen de lo bloqueado que escribe el módulo nativo (chrome/kitsune-privacy.json)."""
        try:
            value = read_json(self.profile / 'chrome/kitsune-privacy.json', 4096)
        except (OSError, ValueError):
            return {'available': False}
        return valid_privacy(value)

    def background(self, digest):
        return background_path(self.profile, digest)

    def refresh(self, settings):
        with self.lock:
            directories = [self.browser_root, self.profile.parent, self.profile, self.profile / 'chrome']
            if self.current_id != 'default':
                directories.append(self.browser_root / 'profiles')
            for directory in directories:
                if directory.is_symlink() or (directory.exists() and (not directory.is_dir() or directory.stat().st_uid != os.getuid())):
                    raise ValueError('Invalid private appearance directory')
            # Las opciones de Nightfall (fondo, acento, sincronía, arte) ya no existen: se ignoran.
            motion = settings.get('motion', True)
            theme = settings.get('theme', 'claro')
            background = settings.get('background')
            if type(motion) is not bool or theme not in PALETTES or (background is not None and (type(background) is not str or not BACKGROUND.fullmatch(background))):
                raise ValueError('Invalid appearance option')
            controls = settings.get('windowControls', 'izquierda')
            brand = settings.get('brand', True)
            if controls not in ('izquierda', 'derecha') or type(brand) is not bool:
                raise ValueError('Invalid window option')
            performance = settings.get('performance', 'normal')
            ram_limit = settings.get('ramLimit', 2048)
            if performance not in ('normal', 'ahorro') or ram_limit not in (1024, 2048, 4096) or type(ram_limit) is not int:
                raise ValueError('Invalid performance option')
            minimize = settings.get('minimize', True)
            buttons = settings.get('windowButtons', 'auto')
            if type(minimize) is not bool or buttons not in ('auto', 'kitsune', 'sistema'):
                raise ValueError('Invalid window option')
            tabs = settings.get('tabs', 'arriba')
            if tabs not in ('arriba', 'lado', 'iconos'):
                raise ValueError('Invalid tabs option')
            tinta = settings.get('tinta', tintas.DEFAULT)
            catalog = tintas.load()
            if tinta not in catalog:
                raise ValueError('Invalid tinta')
            if background is not None and not background_path(self.profile, background).is_file():
                background = None
            palette = dict(catalog[tinta][theme])
            remember = False
            try:
                registry = read_json(self.state_root / 'profiles.json', 1048576)
                if not isinstance(registry, dict) or not isinstance(registry.get('profiles'), list) or any(not isinstance(p, dict) for p in registry['profiles']):
                    raise ValueError('Invalid appearance registry')
                try:
                    profile = next(p for p in registry['profiles'] if p['id'] == self.current_id)
                except (KeyError, StopIteration, TypeError) as error:
                    raise ValueError('Unknown appearance profile') from error
                remember = profile.get('rememberGoogle', False)
                if type(remember) is not bool:
                    raise ValueError('Invalid Google retention policy')
            except FileNotFoundError:
                pass
            value = {'version': 8, 'palette': palette, 'motion': motion, 'googleRemember': remember, 'theme': theme,
                     'background': background, 'windowControls': controls, 'brand': brand,
                     'performance': performance, 'ramLimit': ram_limit, 'minimize': minimize,
                     'windowButtons': buttons, 'tabs': tabs}
            value['fingerprint'] = hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()
            private_write(self.control, value)
            native = {'available': (self.browser_root / 'native/kitsune-appearance.sys.mjs').is_file(), 'status': 'queued'}
            if not native['available']:
                native['status'] = 'unavailable'
            try:
                ack = read_json(self.ack, 8192)
                if not isinstance(ack, dict):
                    raise ValueError('Invalid appearance acknowledgement')
                if ack.get('version') == 1 and ack.get('fingerprint') == value['fingerprint'] and type(ack.get('at')) in (int, float) and 0 <= time.time() * 1000 - ack['at'] < 30000:
                    native.update(available=True, status='applied', googleRemember=ack.get('googleRemember') is True,
                                  googlePolicyManaged=ack.get('googlePolicyManaged') is True)
                    if ack.get('privacyMode') in ('estricto', 'comodo'):
                        native['privacyMode'] = ack['privacyMode']
            except (OSError, ValueError, TypeError):
                pass
            return {**value, 'native': native}

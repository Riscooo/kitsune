"""Small, local appearance protocol shared by the home and native Kitsune UI.

Only validated colors/enums and the explicit Google retention option cross this
boundary. No credentials, arbitrary CSS, URLs, commands or browser data do.
"""
from __future__ import annotations

import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import threading
import time

KEYS = ('bg', 'surface', 'surfaceHigh', 'text', 'muted', 'outline', 'primary', 'primaryContainer', 'secondary', 'tertiary')
PALETTES = {
    'night': dict(zip(KEYS, ('#0b101a', '#141e2d', '#203049', '#e4ecfa', '#a6b5cd', '#506782', '#a9c7fb', '#274969', '#7dd3e8', '#c4b5fd'))),
    'veil': dict(zip(KEYS, ('#101014', '#1c1b22', '#302d38', '#eeeaf4', '#b9b2c7', '#706779', '#c9bfdd', '#514663', '#b6c7db', '#ddb8cf'))),
    'dusk': dict(zip(KEYS, ('#151020', '#231b33', '#382a4e', '#eee6fb', '#bcb0d3', '#79658e', '#c8b2f5', '#58417d', '#e6b6d6', '#a4c5f0'))),
    'ember': dict(zip(KEYS, ('#180f13', '#2a1b22', '#422a31', '#f6e7e7', '#c7b0b4', '#90656c', '#f1a9a6', '#7e3d49', '#efc391', '#d6b3e8'))),
}
SCHEME_KEYS = dict(zip(KEYS, ('background', 'surfaceContainer', 'surfaceContainerHighest', 'onSurface', 'onSurfaceVariant', 'outline', 'primary', 'primaryContainer', 'secondary', 'tertiary')))


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


def color(value):
    if isinstance(value, str) and re.fullmatch(r'#?[0-9a-fA-F]{6}', value):
        return '#' + value.lstrip('#').lower()
    raise ValueError('Invalid appearance color')


def luminance(value):
    channels = [int(value[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in channels]
    return sum(a * b for a, b in zip(linear, (.2126, .7152, .0722)))


def desktop_palette(scheme, fallback):
    if not isinstance(scheme, dict):
        raise ValueError('Desktop palette unavailable')
    values = scheme.get('colours')
    if not isinstance(values, dict):
        raise ValueError('Desktop palette unavailable')
    result = {key: color(values.get(source, fallback[key])) for key, source in SCHEME_KEYS.items()}
    # Kitsune remains dark even when the desktop uses a light material scheme.
    # Clamp surfaces rather than accepting unreadable light-on-light controls.
    for key in ('bg', 'surface', 'surfaceHigh', 'primaryContainer'):
        if luminance(result[key]) > .16:
            value = result[key]
            result[key] = '#' + ''.join(f'{round(int(value[i:i+2], 16) * .25):02x}' for i in (1, 3, 5))
    def readable(value):
        return all((max(luminance(value), luminance(result[base])) + .05) / (min(luminance(value), luminance(result[base])) + .05) >= 4.5 for base in ('bg', 'surface', 'surfaceHigh'))

    for key in ('text', 'muted', 'primary'):
        if not readable(result[key]):
            result[key] = fallback[key] if key != 'text' else '#f1f4fa'
        if not readable(result[key]):
            result[key] = '#ffffff'
    return result


class AppearanceManager:
    def __init__(self, browser_root, state_root, current_id='default', scheme_file=None):
        if current_id != 'default' and not re.fullmatch(r'p-[0-9a-f]{16}', current_id):
            raise ValueError('Invalid appearance profile')
        self.browser_root = Path(browser_root)
        self.state_root = Path(state_root)
        self.current_id = current_id
        self.profile = self.browser_root / ('profile' if current_id == 'default' else f'profiles/{current_id}/profile')
        self.control = self.profile / 'chrome/kitsune-appearance.json'
        self.ack = self.profile / 'chrome/kitsune-appearance-ack.json'
        self.scheme_file = Path(scheme_file) if scheme_file else Path(os.environ.get('KITSUNE_SCHEME_FILE', str(self.state_root.parent / 'caelestia/scheme.json')))
        self.lock = threading.Lock()

    def refresh(self, settings):
        with self.lock:
            directories = [self.browser_root, self.profile.parent, self.profile, self.profile / 'chrome']
            if self.current_id != 'default':
                directories.append(self.browser_root / 'profiles')
            for directory in directories:
                if directory.is_symlink() or (directory.exists() and (not directory.is_dir() or directory.stat().st_uid != os.getuid())):
                    raise ValueError('Invalid private appearance directory')
            wallpaper = settings.get('wallpaper', 'night')
            if wallpaper not in PALETTES:
                raise ValueError('Invalid wallpaper')
            theme_sync = settings.get('themeSync', False)
            art, motion = settings.get('art', True), settings.get('motion', True)
            if any(type(v) is not bool for v in (theme_sync, art, motion)):
                raise ValueError('Invalid appearance option')
            accent = settings.get('accent', 'blue')
            if accent not in ('blue', 'pink', 'system'):
                raise ValueError('Invalid accent')
            source = 'wallpaper' if theme_sync else 'desktop' if accent == 'system' else 'manual'
            palette = PALETTES[wallpaper if theme_sync else 'ember' if accent == 'pink' else 'night'].copy()
            warning = None
            if source == 'desktop':
                try:
                    palette = desktop_palette(read_json(self.scheme_file), palette)
                except (OSError, ValueError, TypeError):
                    warning = 'La paleta del escritorio no está disponible.'
                    try:
                        previous = read_json(self.control, 8192)
                        if not isinstance(previous, dict):
                            raise ValueError('Invalid previous appearance')
                        if previous.get('source') == 'desktop':
                            palette = {key: color(previous['palette'][key]) for key in KEYS}
                    except (OSError, ValueError, TypeError, KeyError):
                        pass
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
            value = {'version': 1, 'palette': palette, 'wallpaper': wallpaper, 'motion': motion,
                     'art': art, 'themeSync': theme_sync, 'source': source, 'googleRemember': remember}
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
            except (OSError, ValueError, TypeError):
                pass
            result = {**value, 'native': native}
            if warning:
                result['warning'] = warning
            return result

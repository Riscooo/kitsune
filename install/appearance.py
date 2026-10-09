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
# Kitsune 0.5 «Tinta»: una sola paleta, la de InkShadow (src/theme/InkTheme.qml).
PAPEL = dict(zip(KEYS, ('#f6f5f1', '#fbfaf7', '#e8ece4', '#252d2b', '#59625c', '#c7cdc4', '#963d32', '#eadfda', '#496b60', '#73786f')))

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
            if type(motion) is not bool:
                raise ValueError('Invalid appearance option')
            palette = PAPEL.copy()
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
            value = {'version': 2, 'palette': palette, 'motion': motion, 'googleRemember': remember}
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

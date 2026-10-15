#!/usr/bin/env python3
"""Kitsune Zero: el cristal con refracción detrás de su ventana, en el escritorio que lo tenga.

Zero hace su ventana transparente; lo que se ve detrás (el escritorio) lo dobla el compositor, si sabe. No
hay un estándar para eso (el protocolo de Wayland, ext-background-effect-v1, solo pide desenfoque), así que
cada escritorio tiene su complemento, y este guion le pone la regla de Kitsune:

- niri: zero/linux/install-niri.sh (y la refracción, zero/linux/niri-vidrio).
- Hyprland: hyprglass (https://github.com/hyprnux/hyprglass). Una regla que le pone el cristal a las
  ventanas de Kitsune (también si hyprglass va solo con las de una lista), en su archivo propio, incluido
  desde la configuración de Hyprland (.conf o Lua), con copia de seguridad.
- KDE Plasma: kwin-effects-glass (https://github.com/4v3ngR/kwin-effects-glass). Para que doble la ventana
  de Kitsune hay que ponerlo en «solo estas ventanas» y apagar el desenfoque de serie de KDE (no pueden ir a
  la vez), y eso cambia el resto del escritorio: solo con --forzar. Si ya está configurado, no se toca.
- GNOME: Liquid Glass (https://github.com/ryohsuke1231/liquid-glass). Kitsune en su lista de ventanas; si la
  lista estaba vacía, la opacidad del contenido a 1 (Zero ya es transparente donde toca).

Cada uno deja su marca (~/.config/kitsune-zero/<escritorio>, o la regla de Hyprland), que es lo que mira
Zero para usar lo de detrás; sin ella, Zero usa la foto de la web, con su lente. «quitar» deshace lo hecho.

    python3 cristal.py poner [--escritorio hyprland|kde|gnome] [--forzar]
    python3 cristal.py quitar [--escritorio …]
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

CLASSES = ['kitsune', 'kitsune-browser']  # el motor y el Kitsune de siempre (los perfiles: kitsune-p-<id>)
CLASS_RE = '^(kitsune|kitsune-browser|kitsune-p-[0-9a-f]+)$'
GNOME_UUID = 'liquid-glass@thinkingcoding1231.gmail.com'
GNOME_SCHEMA = 'org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com'
MARK = '# Kitsune Zero'  # las líneas que se añaden llevan esta marca (y se quitan por ella)


def config_home():
    return Path(os.environ.get('XDG_CONFIG_HOME') or Path.home() / '.config')


def marker(desktop):
    return config_home() / 'kitsune-zero' / desktop


def say(text):
    print(text, flush=True)


def run(*args):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return None


def backup(path):
    copy = path.with_name(f'{path.name}.pre-kitsune-zero-{time.strftime("%Y%m%d-%H%M%S")}')
    shutil.copy2(path, copy)
    return copy


def desktop_of(env=os.environ):
    desktops = env.get('XDG_CURRENT_DESKTOP', '').lower().split(':')
    if env.get('NIRI_SOCKET'):
        return 'niri'
    if env.get('HYPRLAND_INSTANCE_SIGNATURE'):
        return 'hyprland'
    if env.get('KDE_SESSION_VERSION') or 'kde' in desktops:
        return 'kde'
    if 'gnome' in desktops:
        return 'gnome'
    return None


# ------------------------------------------------------------------ Hyprland (hyprglass)

def hyprland_paths():
    folder = config_home() / 'hypr'
    return folder, folder / 'hyprland.lua', folder / 'hyprland.conf'


def hyprland_put(forced):
    folder, lua, conf = hyprland_paths()
    listed = run('hyprctl', 'plugin', 'list')
    if not forced and (listed is None or 'hyprglass' not in listed.stdout):
        say('Hyprland: hyprglass no está cargado (hyprctl plugin list); instálalo con hyprpm y vuelve a probar.')
        return False
    if lua.is_file():
        rule = folder / 'kitsune-zero.lua'
        rule.write_text('-- Kitsune Zero: el cristal de hyprglass (con refracción) en sus ventanas, también si hyprglass\n'
                        '-- va solo con las de una lista (enabled = 0). En Zero ya son transparentes.\n'
                        f'hl.window_rule({{ match = {{ class = "{CLASS_RE}" }}, tag = "+hyprglass_enabled" }})\n')
        lines = f'-- {MARK[2:]}: el cristal de sus ventanas\npcall(dofile, os.getenv("HOME") .. "/.config/hypr/kitsune-zero.lua")\n'
        main = lua
    elif conf.is_file():
        rule = folder / 'kitsune-zero.conf'
        rule.write_text(f'{MARK}: el cristal de hyprglass (con refracción) en sus ventanas, también si hyprglass\n'
                        '# va solo con las de una lista (enabled = 0). En Zero ya son transparentes.\n'
                        f'windowrule = tag +hyprglass_enabled, class:{CLASS_RE}\n')
        lines = f'{MARK}: el cristal de sus ventanas\nsource = {rule}\n'
        main = conf
    else:
        say('Hyprland: no hay configuración (hyprland.lua ni hyprland.conf); no se toca nada.')
        return False
    if 'kitsune-zero.' not in main.read_text():
        backup(main)
        with main.open('a') as handle:
            handle.write(f'\n{lines}')
    say(f'Hyprland: regla de Kitsune en {rule}, incluida desde {main.name}.')
    return True


def hyprland_remove():
    folder, lua, conf = hyprland_paths()
    for main in (lua, conf):
        if main.is_file() and MARK[2:] in main.read_text():
            backup(main)
            main.write_text(''.join(line for line in main.read_text().splitlines(keepends=True) if MARK[2:] not in line and 'kitsune-zero.' not in line))
    for name in ('kitsune-zero.lua', 'kitsune-zero.conf'):
        (folder / name).unlink(missing_ok=True)
    say('Hyprland: regla de Kitsune quitada.')


# ------------------------------------------------------------------ KDE Plasma (kwin-effects-glass)

KDE_GROUP = 'Effect-blurplus'
KDE_KEYS = {  # «solo estas ventanas», Kitsune; la ventana entera (no pide desenfoque); refracción media
    'BlurMatching': 'true', 'BlurNonMatching': 'false', 'WindowClasses': '\\n'.join(CLASSES),
    'BlurDecorations': 'true', 'IgnoreContentBlurRegion': 'true',
    'RefractionStrength': '10', 'RefractionEdgeSize': '4', 'RefractionNormalPow': '6', 'RefractionRGBFringing': '4',
}


def kde_plugin():
    roots = [Path(p) for p in os.environ.get('KITSUNE_KWIN_PLUGINS', '/usr/lib:/usr/lib64:/usr/local/lib').split(':')]
    for root in roots:
        for candidate in [root / 'qt6/plugins/kwin/effects/plugins/glass.so', *root.glob('*/qt6/plugins/kwin/effects/plugins/glass.so')]:
            if candidate.is_file():
                return candidate
    return None


def ini_read(path):
    """[grupo] → {clave: valor}, en orden (KConfig: grupos como [A][B], sin comillas)."""
    groups, current = {}, None
    for line in path.read_text().splitlines() if path.is_file() else []:
        if line.startswith('[') and line.rstrip().endswith(']'):
            current = line.strip()[1:-1]
            groups.setdefault(current, {})
        elif current is not None and '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            groups[current][key.strip()] = value
    return groups


def ini_write(path, groups):
    path.write_text('\n'.join(f'[{group}]\n' + ''.join(f'{k}={v}\n' for k, v in keys.items()) for group, keys in groups.items()))


def kde_put(forced):
    if not kde_plugin():
        say('KDE: kwin-effects-glass no está instalado (en Arch: yay -S kwin-effects-glass-git).')
        return False
    path = config_home() / 'kwinrc'
    groups = ini_read(path)
    if KDE_GROUP in groups and not marker('kde').is_file():
        say('KDE: kwin-effects-glass ya está configurado a tu manera; no se toca. Para Kitsune: en «Force blur»,\n'
            f'  añade {", ".join(CLASSES)} a las ventanas que lleva, activa «Apply effects to window decorations as\n'
            '  well» y sube «Refraction Strength».')
        return False
    plugins = groups.setdefault('Plugins', {})
    stock = plugins.get('blurEnabled', 'true')
    if stock != 'false' and not forced:
        say('KDE: para doblar lo de detrás de Kitsune, kwin-effects-glass tiene que ir solo con las ventanas de Kitsune\n'
            '  y hay que apagar el desenfoque de serie de KDE (no pueden ir a la vez): el resto del escritorio pierde su\n'
            '  desenfoque. Si te vale, repite con --forzar.')
        return False
    if path.is_file():
        backup(path)
    groups[KDE_GROUP] = dict(KDE_KEYS)
    plugins['glassEnabled'] = 'true'
    plugins['blurEnabled'] = 'false'
    ini_write(path, groups)
    marker('kde').parent.mkdir(parents=True, exist_ok=True)
    marker('kde').write_text(json.dumps({'blurEnabled': stock}))
    run('qdbus6', 'org.kde.KWin', '/KWin', 'reconfigure')
    run('qdbus6', 'org.kde.KWin', '/Effects', 'org.kde.kwin.Effects.reconfigureEffect', 'glass')
    say('KDE: kwin-effects-glass, solo con las ventanas de Kitsune, con refracción (el desenfoque de serie, apagado).')
    return True


def kde_remove():
    if not marker('kde').is_file():
        say('KDE: nada que quitar.')
        return
    before = json.loads(marker('kde').read_text() or '{}')
    path = config_home() / 'kwinrc'
    groups = ini_read(path)
    if path.is_file():
        backup(path)
    groups.pop(KDE_GROUP, None)
    plugins = groups.setdefault('Plugins', {})
    plugins['glassEnabled'] = 'false'
    plugins['blurEnabled'] = before.get('blurEnabled', 'true')
    ini_write(path, groups)
    marker('kde').unlink()
    run('qdbus6', 'org.kde.KWin', '/KWin', 'reconfigure')
    say('KDE: como estaba (kwin-effects-glass apagado y el desenfoque de serie, como antes).')


# ------------------------------------------------------------------ GNOME (Liquid Glass)

def gnome_schemas():
    for root in (Path.home() / '.local/share/gnome-shell/extensions', Path('/usr/share/gnome-shell/extensions')):
        folder = root / GNOME_UUID / 'schemas'
        if folder.is_dir():
            return folder
    return None


def gsettings(schemas, *args):
    done = run('gsettings', '--schemadir', str(schemas), *args)
    return done.stdout.strip() if done and done.returncode == 0 else None


def gvariant_list(text):
    """['a', 'b'] (o @as []) → lista."""
    text = (text or '').replace('@as', '').strip()
    try:
        return json.loads(text.replace("'", '"')) if text else []
    except ValueError:
        return []


def gnome_put(forced):
    schemas = gnome_schemas()
    if not schemas:
        say(f'GNOME: la extensión Liquid Glass no está instalada ({GNOME_UUID}).')
        return False
    shell = run('gsettings', 'get', 'org.gnome.shell', 'enabled-extensions')
    enabled = gvariant_list(shell.stdout if shell else '')
    if GNOME_UUID not in enabled and not forced:
        say('GNOME: Liquid Glass está instalada pero apagada; enciéndela en Extensiones y vuelve a probar.')
        return False
    done = {}
    if gsettings(schemas, 'get', GNOME_SCHEMA, 'application-glass-all-windows') == 'true':
        blacklist = gvariant_list(gsettings(schemas, 'get', GNOME_SCHEMA, 'application-window-blacklist'))
        if any(name in blacklist for name in CLASSES):
            done['blacklist'] = blacklist
            gsettings(schemas, 'set', GNOME_SCHEMA, 'application-window-blacklist', str([n for n in blacklist if n not in CLASSES]))
    else:
        whitelist = gvariant_list(gsettings(schemas, 'get', GNOME_SCHEMA, 'application-window-whitelist'))
        done['whitelist'] = whitelist
        done['glass'] = gsettings(schemas, 'get', GNOME_SCHEMA, 'enable-application-glass')
        gsettings(schemas, 'set', GNOME_SCHEMA, 'application-window-whitelist', str(whitelist + [n for n in CLASSES if n not in whitelist]))
        gsettings(schemas, 'set', GNOME_SCHEMA, 'enable-application-glass', 'true')
        if not whitelist:
            # Solo Kitsune en la lista: su contenido, entero (Zero ya es transparente donde toca).
            done['opacity'] = gsettings(schemas, 'get', GNOME_SCHEMA, 'application-content-opacity')
            gsettings(schemas, 'set', GNOME_SCHEMA, 'application-content-opacity', '1.0')
    marker('gnome').parent.mkdir(parents=True, exist_ok=True)
    marker('gnome').write_text(json.dumps(done))
    say('GNOME: Kitsune en la lista de ventanas de cristal de Liquid Glass.')
    return True


def gnome_remove():
    schemas = gnome_schemas()
    if not marker('gnome').is_file():
        say('GNOME: nada que quitar.')
        return
    done = json.loads(marker('gnome').read_text() or '{}')
    if schemas:
        if 'whitelist' in done:
            now = gvariant_list(gsettings(schemas, 'get', GNOME_SCHEMA, 'application-window-whitelist'))
            gsettings(schemas, 'set', GNOME_SCHEMA, 'application-window-whitelist', str([n for n in now if n not in CLASSES or n in done['whitelist']]))
            if done.get('glass'):
                gsettings(schemas, 'set', GNOME_SCHEMA, 'enable-application-glass', done['glass'])
            if done.get('opacity'):
                gsettings(schemas, 'set', GNOME_SCHEMA, 'application-content-opacity', done['opacity'])
        if 'blacklist' in done:
            gsettings(schemas, 'set', GNOME_SCHEMA, 'application-window-blacklist', str(done['blacklist']))
    marker('gnome').unlink()
    say('GNOME: Liquid Glass como estaba.')


DESKTOPS = {'hyprland': (hyprland_put, hyprland_remove), 'kde': (kde_put, kde_remove), 'gnome': (gnome_put, gnome_remove)}


def main(argv=None):
    parser = argparse.ArgumentParser(description='El cristal con refracción detrás de Kitsune Zero, según el escritorio.')
    parser.add_argument('accion', choices=['poner', 'quitar'])
    parser.add_argument('--escritorio', choices=sorted(DESKTOPS))
    parser.add_argument('--forzar', action='store_true', help='KDE: apagar su desenfoque de serie; también sin comprobar el complemento')
    args = parser.parse_args(argv)
    desktop = args.escritorio or desktop_of()
    if desktop == 'niri':
        say('niri: su regla la pone zero/linux/install-niri.sh, y la refracción, zero/linux/niri-vidrio.')
        return 0
    if desktop not in DESKTOPS:
        say('Este escritorio no tiene un cristal con refracción conocido: Zero usará la foto de la web, con su lente.')
        return 0
    put, remove = DESKTOPS[desktop]
    if args.accion == 'poner':
        put(args.forzar)
    else:
        remove()
    return 0


if __name__ == '__main__':
    sys.exit(main())

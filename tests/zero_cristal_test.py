"""Kitsune Zero · zero/linux/cristal.py: la regla de cristal de Kitsune en Hyprland, KDE y GNOME.

Con una carpeta de usuario falsa y hyprctl, gsettings y qdbus6 de mentira (gsettings guarda su estado en
un archivo): pone lo que toca, no toca lo que no debe (sin el complemento, con su configuración propia, sin
--forzar en KDE) y «quitar» lo deja como estaba.
"""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('cristal', ROOT / 'zero/linux/cristal.py')
cristal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cristal)

GSETTINGS = r'''#!/usr/bin/env python3
import json, sys
from pathlib import Path
state = Path(__file__).with_name('gsettings.json')
data = json.loads(state.read_text())
args = sys.argv[1:]
if args[0] == '--schemadir': args = args[2:]
if args[0] == 'get': print(data.get(args[2], '')); sys.exit(0 if args[2] in data else 1)
if args[0] == 'set': data[args[2]] = args[3]; state.write_text(json.dumps(data))
'''


class Cristal(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.config = self.tmp / 'config'; self.config.mkdir()
        self.bin = self.tmp / 'bin'; self.bin.mkdir()
        self.calls = self.tmp / 'calls'
        for name in ('hyprctl', 'qdbus6'):
            self.stub(name, f'#!/bin/sh\necho "$0 $*" >> {self.calls}\n')
        env = {'HOME': str(self.tmp), 'XDG_CONFIG_HOME': str(self.config), 'PATH': f'{self.bin}:{os.environ["PATH"]}',
               'KITSUNE_KWIN_PLUGINS': str(self.tmp / 'lib')}
        patcher = mock.patch.dict(os.environ, env)
        patcher.start(); self.addCleanup(patcher.stop)

    def stub(self, name, text):
        path = self.bin / name
        path.write_text(text); path.chmod(0o755)

    def put(self, desktop, *extra):
        cristal.main(['poner', '--escritorio', desktop, *extra])

    def remove(self, desktop):
        cristal.main(['quitar', '--escritorio', desktop])

    # ---- Hyprland

    def hyprglass(self, loaded=True):
        self.stub('hyprctl', '#!/bin/sh\n' + ('echo "Plugin hyprglass by hyprnux:"\n' if loaded else 'echo "no plugins loaded"\n'))

    def test_hyprland_conf_gets_the_rule_once_and_loses_it(self):
        self.hyprglass()
        hypr = self.config / 'hypr'; hypr.mkdir()
        conf = hypr / 'hyprland.conf'; conf.write_text('monitor = ,preferred,auto,1\n')
        self.put('hyprland'); self.put('hyprland')
        rule = (hypr / 'kitsune-zero.conf').read_text()
        self.assertIn('windowrule = tag +hyprglass_enabled, class:^(kitsune|kitsune-browser|kitsune-p-[0-9a-f]+)$', rule)
        text = conf.read_text()
        self.assertEqual(text.count(f'source = {hypr / "kitsune-zero.conf"}'), 1)
        self.assertTrue(text.startswith('monitor = ,preferred,auto,1\n'))
        self.assertEqual(len(list(hypr.glob('hyprland.conf.pre-kitsune-zero-*'))), 1)
        self.remove('hyprland')
        self.assertEqual(conf.read_text().strip(), 'monitor = ,preferred,auto,1')
        self.assertFalse((hypr / 'kitsune-zero.conf').exists())

    def test_hyprland_lua_config_gets_its_lua_rule(self):
        self.hyprglass()
        hypr = self.config / 'hypr'; hypr.mkdir()
        lua = hypr / 'hyprland.lua'; lua.write_text('hl.config({ general = { gaps_in = 4 } })\n')
        self.put('hyprland')
        self.assertIn('tag = "+hyprglass_enabled"', (hypr / 'kitsune-zero.lua').read_text())
        self.assertIn('pcall(dofile, os.getenv("HOME") .. "/.config/hypr/kitsune-zero.lua")', lua.read_text())
        self.remove('hyprland')
        self.assertEqual(lua.read_text().strip(), 'hl.config({ general = { gaps_in = 4 } })')

    def test_hyprland_without_hyprglass_is_left_alone(self):
        self.hyprglass(loaded=False)
        hypr = self.config / 'hypr'; hypr.mkdir()
        (hypr / 'hyprland.conf').write_text('x = 1\n')
        self.put('hyprland')
        self.assertEqual((hypr / 'hyprland.conf').read_text(), 'x = 1\n')
        self.assertFalse((hypr / 'kitsune-zero.conf').exists())

    # ---- KDE

    def glass_plugin(self):
        plugin = self.tmp / 'lib/qt6/plugins/kwin/effects/plugins/glass.so'
        plugin.parent.mkdir(parents=True); plugin.write_bytes(b'')

    def test_kde_needs_the_plugin_and_asks_before_turning_off_its_blur(self):
        kwinrc = self.config / 'kwinrc'; kwinrc.write_text('[Plugins]\nslideEnabled=false\n')
        self.put('kde')  # sin el complemento
        self.assertEqual(kwinrc.read_text(), '[Plugins]\nslideEnabled=false\n')
        self.glass_plugin()
        self.put('kde')  # sin --forzar: el desenfoque de serie sigue
        self.assertEqual(kwinrc.read_text(), '[Plugins]\nslideEnabled=false\n')
        self.assertFalse(cristal.marker('kde').exists())

    def test_kde_forced_only_kitsune_with_refraction_and_back(self):
        self.glass_plugin()
        kwinrc = self.config / 'kwinrc'; kwinrc.write_text('[Plugins]\nslideEnabled=false\n\n[Windows]\nBorderlessMaximizedWindows=true\n')
        self.put('kde', '--forzar')
        groups = cristal.ini_read(kwinrc)
        blur = groups['Effect-blurplus']
        self.assertEqual((blur['BlurMatching'], blur['BlurNonMatching'], blur['BlurDecorations']), ('true', 'false', 'true'))
        self.assertEqual(blur['WindowClasses'], 'kitsune\\nkitsune-browser')
        self.assertGreater(int(blur['RefractionStrength']), 0)
        self.assertEqual((groups['Plugins']['glassEnabled'], groups['Plugins']['blurEnabled'], groups['Plugins']['slideEnabled']), ('true', 'false', 'false'))
        self.assertEqual(groups['Windows']['BorderlessMaximizedWindows'], 'true')
        self.assertTrue(cristal.marker('kde').exists())
        self.assertIn('reconfigureEffect glass', self.calls.read_text())
        self.remove('kde')
        groups = cristal.ini_read(kwinrc)
        self.assertNotIn('Effect-blurplus', groups)
        self.assertEqual((groups['Plugins']['glassEnabled'], groups['Plugins']['blurEnabled']), ('false', 'true'))
        self.assertFalse(cristal.marker('kde').exists())

    def test_kde_with_its_own_glass_settings_is_left_alone(self):
        self.glass_plugin()
        kwinrc = self.config / 'kwinrc'; kwinrc.write_text('[Effect-blurplus]\nWindowClasses=konsole\n')
        self.put('kde', '--forzar')
        self.assertEqual(kwinrc.read_text(), '[Effect-blurplus]\nWindowClasses=konsole\n')

    # ---- GNOME

    def liquid_glass(self, **settings):
        (self.tmp / '.local/share/gnome-shell/extensions' / cristal.GNOME_UUID / 'schemas').mkdir(parents=True)
        base = {'enabled-extensions': f"['{cristal.GNOME_UUID}']", 'application-glass-all-windows': 'false',
                'application-window-whitelist': '@as []', 'application-window-blacklist': '@as []',
                'enable-application-glass': 'false', 'application-content-opacity': '0.85'}
        (self.bin / 'gsettings.json').write_text(json.dumps({**base, **settings}))
        self.stub('gsettings', GSETTINGS)

    def gnome(self):
        return json.loads((self.bin / 'gsettings.json').read_text())

    def test_gnome_whitelist_gets_kitsune_whole_and_back(self):
        self.liquid_glass()
        self.put('gnome')
        g = self.gnome()
        self.assertEqual(cristal.gvariant_list(g['application-window-whitelist']), ['kitsune', 'kitsune-browser'])
        self.assertEqual((g['enable-application-glass'], g['application-content-opacity']), ('true', '1.0'))
        self.remove('gnome')
        g = self.gnome()
        self.assertEqual(cristal.gvariant_list(g['application-window-whitelist']), [])
        self.assertEqual((g['enable-application-glass'], g['application-content-opacity']), ('false', '0.85'))

    def test_gnome_with_other_windows_keeps_their_opacity(self):
        self.liquid_glass(**{'application-window-whitelist': "['org.gnome.Nautilus']", 'enable-application-glass': 'true'})
        self.put('gnome')
        g = self.gnome()
        self.assertEqual(cristal.gvariant_list(g['application-window-whitelist']), ['org.gnome.Nautilus', 'kitsune', 'kitsune-browser'])
        self.assertEqual(g['application-content-opacity'], '0.85')
        self.remove('gnome')
        self.assertEqual(cristal.gvariant_list(self.gnome()['application-window-whitelist']), ['org.gnome.Nautilus'])

    def test_gnome_all_windows_takes_kitsune_out_of_the_blacklist(self):
        self.liquid_glass(**{'application-glass-all-windows': 'true', 'application-window-blacklist': "['kitsune', 'mpv']"})
        self.put('gnome')
        self.assertEqual(cristal.gvariant_list(self.gnome()['application-window-blacklist']), ['mpv'])
        self.remove('gnome')
        self.assertEqual(cristal.gvariant_list(self.gnome()['application-window-blacklist']), ['kitsune', 'mpv'])

    def test_gnome_with_the_extension_off_is_left_alone(self):
        self.liquid_glass(**{'enabled-extensions': '@as []'})
        self.put('gnome')
        self.assertEqual(cristal.gvariant_list(self.gnome()['application-window-whitelist']), [])
        self.assertFalse(cristal.marker('gnome').exists())

    # ---- el escritorio

    def test_the_desktop_comes_from_the_session(self):
        self.assertEqual(cristal.desktop_of({'NIRI_SOCKET': '/run/x'}), 'niri')
        self.assertEqual(cristal.desktop_of({'HYPRLAND_INSTANCE_SIGNATURE': 'a'}), 'hyprland')
        self.assertEqual(cristal.desktop_of({'XDG_CURRENT_DESKTOP': 'KDE'}), 'kde')
        self.assertEqual(cristal.desktop_of({'XDG_CURRENT_DESKTOP': 'ubuntu:GNOME'}), 'gnome')
        self.assertIsNone(cristal.desktop_of({'XDG_CURRENT_DESKTOP': 'sway'}))


if __name__ == '__main__':
    unittest.main()

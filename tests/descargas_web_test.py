"""web/downloads.json a partir de una versión publicada (tools/descargas_web.py)."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('descargas_web', ROOT / 'tools/descargas_web.py')
descargas = importlib.util.module_from_spec(spec)
spec.loader.exec_module(descargas)
BASE = 'https://github.com/Riscooo/kitsune/releases/download'


def assets(tag, sizes=(88297304, 108118710, 92747607)):
    names = ['Linux-x86_64.tar.xz', 'macOS-AppleSilicon.dmg', 'Windows-x64.exe']
    return [{'name': f'Kitsune-{tag[1:]}-{n}', 'size': s, 'url': f'{BASE}/{tag}/Kitsune-{tag[1:]}-{n}'} for n, s in zip(names, sizes)] + \
        [{'name': 'SHA256SUMS.txt', 'size': 320, 'url': f'{BASE}/{tag}/SHA256SUMS.txt'}]


class DownloadsTest(unittest.TestCase):
    def test_it_rebuilds_the_published_beta_6_list_exactly(self):
        published = json.loads((ROOT / 'web/downloads.json').read_text())
        if published.get('linux', {}).get('release') == '0.7.0-beta.6':
            self.assertEqual(descargas.downloads('v0.7.0-beta.6', assets('v0.7.0-beta.6')), published)

    def test_a_final_release_has_no_beta_note_and_a_short_label(self):
        listing = descargas.downloads('v0.8.0', assets('v0.8.0'))
        self.assertEqual(listing['version'], '0.8')
        self.assertEqual(listing['linux']['note'], 'se instala sin sudo')
        self.assertEqual(descargas.downloads('v0.8.1', assets('v0.8.1'))['version'], '0.8.1')

    def test_the_intel_mac_is_listed_only_when_the_release_has_it(self):
        with_intel = assets('v0.8.0') + [{'name': 'Kitsune-0.8.0-macOS-Intel.dmg', 'size': 115343360,
                                          'url': f'{BASE}/v0.8.0/Kitsune-0.8.0-macOS-Intel.dmg'}]
        listing = descargas.downloads('v0.8.0', with_intel)
        self.assertEqual(listing['macos-intel']['size'], '110 MB')
        self.assertNotIn('macos-intel', descargas.downloads('v0.8.0', assets('v0.8.0')))

    def test_missing_or_misplaced_packages_are_refused(self):
        with self.assertRaises(ValueError):
            descargas.downloads('v0.8.0', assets('v0.8.0')[1:])
        moved = assets('v0.8.0')
        moved[0]['url'] = 'https://evil.example/x.tar.xz'
        with self.assertRaises(ValueError):
            descargas.downloads('v0.8.0', moved)
        with self.assertRaises(ValueError):
            descargas.downloads('0.8.0', assets('v0.8.0'))


if __name__ == '__main__':
    unittest.main()

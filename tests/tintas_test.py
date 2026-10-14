"""El catálogo de tintas: bien formado, legible y copiado al inicio integrado."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('kitsune_tintas', ROOT / 'install/tintas.py')
tintas = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tintas)
spec = importlib.util.spec_from_file_location('kitsune_appearance', ROOT / 'install/appearance.py')
appearance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(appearance)
RAW = json.loads((ROOT / 'start/tintas.json').read_text())


class TintasTests(unittest.TestCase):
    def test_catalog_has_papel_first_and_at_least_five_more(self):
        catalog = tintas.parse(RAW)
        self.assertEqual(list(catalog)[0], 'papel')
        self.assertGreaterEqual(len(catalog), 6)
        self.assertEqual(catalog['papel']['claro'], appearance.PAPEL)
        self.assertEqual(catalog['papel']['oscuro'], appearance.SUMI)

    def test_every_tinta_reads_at_least_as_well_as_papel(self):
        for tinta in tintas.parse(RAW).values():
            for theme in ('claro', 'oscuro'):
                self.assertEqual(tintas.problems(tinta[theme]), [], f"{tinta['id']} {theme}")

    def test_negro_absoluto_reads_at_least_as_well_as_papel_in_every_tinta(self):
        # Negro absoluto: fondo y superficies en negro puro, y aun así los contrastes de Papel.
        for tinta_id, tinta in tintas.load().items():
            palette = tintas.negro(tinta['oscuro'])
            with self.subTest(tinta=tinta_id):
                self.assertEqual((palette['bg'], palette['surface']), ('#000000', '#000000'))
                self.assertEqual(tintas.problems(palette), [])
                self.assertEqual({key: palette[key] for key in ('text', 'muted', 'primary', 'secondary')},
                                 {key: tinta['oscuro'][key] for key in ('text', 'muted', 'primary', 'secondary')})

    def test_bad_catalogs_are_rejected(self):
        def broken(change):
            value = copy.deepcopy(RAW)
            change(value)
            with self.assertRaises(ValueError):
                tintas.parse(value)
        broken(lambda v: v['tintas'].pop(0))                                   # sin Papel
        broken(lambda v: v['tintas'][1].update(id='../x'))                     # id raro
        broken(lambda v: v['tintas'][1].update(id='papel'))                    # repetido
        broken(lambda v: v['tintas'][1]['claro'].update(text='#e0e0e0'))       # texto ilegible
        broken(lambda v: v['tintas'][1]['oscuro'].update(primary='red'))       # color mal escrito
        broken(lambda v: v['tintas'][1]['claro'].pop('muted'))                 # falta un token
        broken(lambda v: v['tintas'][1].update(extra=1))                       # campo de más
        broken(lambda v: v.update(version=2))

    def test_the_integrated_home_has_the_same_catalog(self):
        result = subprocess.run([sys.executable, str(ROOT / 'tools/tintas.py'), '--check'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()

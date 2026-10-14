"""La comparativa de memoria de la web sale de web/ram.json (tools/web_ram.py) y está al día."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('web_ram', ROOT / 'tools/web_ram.py')
web_ram = importlib.util.module_from_spec(spec)
spec.loader.exec_module(web_ram)


class WebRamTest(unittest.TestCase):
    def test_the_web_matches_the_measurement(self):
        result = subprocess.run([sys.executable, str(ROOT / 'tools/web_ram.py'), '--check'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_versions_are_short_and_numbers_follow_each_language(self):
        cases = {'Mozilla Firefox 158.0': 'Firefox 158', 'Google Chrome for Testing 155.0.8059.79': 'Chrome 155',
                 'Mozilla Zen 1.23.2b': 'Zen 1.23.2b', 'Kitsune 0.8.0 · Gecko 157.0.1': 'Kitsune 0.8 · Gecko 157'}
        for version, short in cases.items():
            self.assertEqual(web_ram.short_version({'browser': 'X', 'version': version}), short)
        self.assertEqual(web_ram.megabytes(1271, 'es'), '1271 MB')
        self.assertEqual(web_ram.megabytes(12345, 'es'), '12.345 MB')
        self.assertEqual(web_ram.megabytes(1271, 'en'), '1,271 MB')

    def test_bars_go_from_less_to_more_memory_and_kitsune_is_marked(self):
        report = {'date': '2026-10-14', 'results': [
            {'browser': 'Zen', 'version': 'Mozilla Zen 1.23.2b', 'saver': False, 'pssMB': 2600},
            {'browser': 'Kitsune', 'version': 'Kitsune 0.8.0 · Gecko 157.0.1', 'saver': True, 'pssMB': 1300}]}
        block = web_ram.render(report, 'es')
        self.assertLess(block.index('Kitsune 0.8'), block.index('Zen 1.23.2b'))
        self.assertIn('class="ram-kitsune"', block)
        self.assertIn('width="50.0"', block)
        self.assertNotIn('style=', block)  # la web no permite estilos en línea (CSP)


if __name__ == '__main__':
    unittest.main()

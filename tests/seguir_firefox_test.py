"""Las notas del borrador de versión que deja tools/seguir_firefox.py."""
import datetime
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('seguir_firefox', ROOT / 'tools/seguir_firefox.py')
seguir = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seguir)


class ReleaseNotesTest(unittest.TestCase):
    def test_notes_fill_release_and_gecko_and_list_every_sha256(self):
        template = (ROOT / 'docs/notas/0.8.0-beta.1.md').read_text()
        sums = f"{'a' * 64}  Kitsune-0.8.0-beta.1-Linux-x86_64.tar.xz\n{'b' * 64}  Kitsune-0.8.0-beta.1-Windows-x64.exe\n"
        notes = seguir.release_notes(template, '0.8.0-beta.1', '158.0', sums, datetime.date(2026, 10, 14))
        self.assertIn('**Gecko 158.0**', notes)
        self.assertIn('tar -xf Kitsune-0.8.0-beta.1-Linux-x86_64.tar.xz', notes)
        self.assertNotIn('{release}', notes)
        self.assertNotIn('{gecko}', notes)
        self.assertIn(f"- `Kitsune-0.8.0-beta.1-Windows-x64.exe`: `{'b' * 64}`", notes)
        self.assertIn('14/10/2026', notes)

    def test_without_notes_there_is_still_a_line_and_the_sums(self):
        notes = seguir.release_notes(None, '0.8.1', '158.0.1', f"{'c' * 64}  K.dmg\n", datetime.date(2026, 11, 2))
        self.assertTrue(notes.startswith('Kitsune y Kitsune Zero **0.8.1** con **Gecko 158.0.1**'))
        self.assertIn(f"- `K.dmg`: `{'c' * 64}`", notes)


class AutomaticTest(unittest.TestCase):
    def test_a_new_gecko_alone_gets_the_next_beta_or_the_next_patch_release(self):
        self.assertEqual(seguir.next_release('0.8.0-beta.1'), '0.8.0-beta.2')
        self.assertEqual(seguir.next_release('0.8.0-beta.9'), '0.8.0-beta.10')
        self.assertEqual(seguir.next_release('0.8.0'), '0.8.1')
        for bad in ('', None, '0.8', '0.8.0-rc.1', '0.8.0-beta.1; rm -rf /'):
            with self.assertRaises(ValueError):
                seguir.next_release(bad)

    def test_the_automatic_name_starts_the_code_version_betas_and_skips_published_ones(self):
        out = {'0.7.0-beta.6', '0.8.0-beta.1'}
        self.assertEqual(seguir.auto_release('0.8.0', '0.7.0-beta.6', out.__contains__), '0.8.0-beta.2')
        self.assertEqual(seguir.auto_release('0.8.0', '0.7.0-beta.6', set().__contains__), '0.8.0-beta.1')
        # El código no ha cambiado de versión: solo un Gecko nuevo sobre lo publicado.
        self.assertEqual(seguir.auto_release('0.8.0', '0.8.0', {'0.8.0'}.__contains__), '0.8.1')
        self.assertEqual(seguir.auto_release('0.7.0', '0.7.0-beta.6', out.__contains__), '0.7.0-beta.7')

    def test_the_daily_unit_runs_the_automatic_follow_up_from_the_repository(self):
        unit = (ROOT / 'install/kitsune-engine-update.service').read_text()
        self.assertIn('ExecStart=/usr/bin/python3 @REPO@/tools/seguir_firefox.py --auto', unit)
        self.assertIn('OOMScoreAdjust=900', unit)
        self.assertIn('s|@REPO@|${repo}|g', (ROOT / 'install/install.sh').read_text())


if __name__ == '__main__':
    unittest.main()

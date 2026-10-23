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


class LeftoversTest(unittest.TestCase):
    def test_a_passing_test_leaves_nothing_in_tmp_and_a_failing_one_keeps_its_evidence(self):
        import tempfile
        folder = Path(tempfile.mkdtemp())
        (folder / 'kitsune-de-antes').mkdir()

        def test(name, result):
            def run():
                (folder / f'kitsune-{name}-x1').mkdir()
                (folder / f'kitsune-{name}-x1/perfil').write_text('perfil')
                return result
            return run
        self.assertTrue(seguir.without_leftovers(test('pasa', True), folder))
        self.assertFalse(seguir.without_leftovers(test('falla', False), folder))
        self.assertEqual(sorted(path.name for path in folder.iterdir()), ['kitsune-de-antes', 'kitsune-falla-x1'])


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


class ApartTest(unittest.TestCase):
    """Publicar sin tocar el Kitsune de este PC (Risco, 21-10: «no me actualices directamente mi Kitsune»)."""

    def test_by_default_the_engine_is_the_one_of_this_pc(self):
        self.assertEqual(seguir.current_engine({}), Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
        self.assertEqual(seguir.passed_env({}), [])

    def test_with_its_own_folders_every_step_and_every_test_use_the_engine_there(self):
        env = {'XDG_DATA_HOME': '/mnt/datos/publicar/data', 'XDG_STATE_HOME': '/mnt/datos/publicar/state', 'HOME': '/x'}
        self.assertEqual(seguir.current_engine(env), Path('/mnt/datos/publicar/data/kitsune-browser/engine/current/kitsune'))
        # systemd-run no hereda el entorno: cada paso las recibe a mano (y nada más).
        self.assertEqual(seguir.passed_env(env), ['--setenv=XDG_DATA_HOME=/mnt/datos/publicar/data',
                                                  '--setenv=XDG_STATE_HOME=/mnt/datos/publicar/state'])
        self.assertEqual(seguir.test_command('zero_island_native', Path('/m/kitsune')),
                         [seguir.sys.executable, 'tests/zero_island_native.py', '--browser', '/m/kitsune'])


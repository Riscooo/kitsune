#!/usr/bin/env python3
"""Kitsune para Windows se actualiza solo: la orden actualizar.cmd (kitsune-updater.sys.mjs) con el instalador de
verdad, en el Wine de Proton y sin pantalla.

Risco, 22-10: en el portátil del insti (Windows) tuvo que bajarse la beta 4 a mano. Sin un Windows a mano, esto
comprueba la parte que solo existe allí, con un Kitsune instalado en una carpeta con espacios, eñe, tildes y %:
1. Mientras Kitsune sigue abierto (aquí, un cmd.exe que acaba a los 20 s), no se instala nada.
2. Cuando se cierra, se instala en esa misma carpeta y no vuelve el acceso del escritorio que se había quitado.
3. Con «Reiniciar ahora», después se vuelve a abrir Kitsune (aquí, una orden que deja una marca), ya instalado.

    python3 tests/updater_windows_wine.py --installer Kitsune-0.8.0-beta.4-Windows-x64.exe
"""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
PROTON = Path.home() / '.local/share/Steam/steamapps/common/Proton - Experimental/files/bin/wine'
FOLDER = 'C:\\Program Files\\Kitsune Ñandú 100%'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--installer', type=Path, required=True, help='Kitsune-<versión>-Windows-x64.exe')
    parser.add_argument('--wine', type=Path, default=PROTON)
    # Un prefijo de Wine ocupa cerca de 1 GB con Kitsune instalado: en la caché de compilar (en /mnt/datos), no en /tmp.
    parser.add_argument('--prefix', type=Path, default=Path.home() / '.cache/kitsune-build/wine-actualizar')
    args = parser.parse_args()
    env = {**os.environ, 'WINEPREFIX': str(args.prefix), 'WINEDEBUG': '-all',
           'WINEDLLOVERRIDES': 'mscoree,mshtml=;winex11.drv,winewayland.drv=d'}
    for name in ('DISPLAY', 'WAYLAND_DISPLAY'):
        env.pop(name, None)

    # La salida, a un archivo y no a una tubería: los servicios que Wine arranca de paso (rpcss.exe…) la heredan y, con
    # el servidor siempre en marcha, no la cierran nunca.
    def wine(*command, extra=None, **options):
        with tempfile.TemporaryFile() as output:
            done = subprocess.run([str(args.wine), *command], env={**env, **(extra or {})}, stdout=output,
                                  stderr=subprocess.STDOUT, **options)
            output.seek(0)
            done.stdout = output.read().decode(errors='replace')
            return done

    def check(name):
        print('PASS ' + name, flush=True)

    if not (args.prefix / 'drive_c').exists():
        wine('wineboot', '-i', timeout=600)
    # El servidor de Wine, siempre en marcha durante la prueba: si arranca a mitad, se lleva 10 s.
    wineserver = args.wine.with_name('wineserver')
    subprocess.run([str(wineserver), '-p'], env=env)  # da 2 si ya estaba en marcha: también vale
    try:
        run(args, env, wine, check)
    finally:
        subprocess.run([str(wineserver), '-k'], env=env)


def run(args, env, wine, check):
    drive = args.prefix / 'drive_c'
    work = drive / 'kitsune-prueba'
    shutil.rmtree(work, ignore_errors=True)
    (work / 'actualizacion').mkdir(parents=True)
    name = args.installer.name
    shutil.copy(args.installer, work / 'actualizacion' / name)
    script = subprocess.run(['node', '--input-type=module', '-e',
                             "import { windowsScript } from './install/native/kitsune-updater.sys.mjs';"
                             f"process.stdout.write(windowsScript({name!r}))"],
                            cwd=ROOT, check=True, capture_output=True, text=True).stdout
    (work / 'actualizacion/actualizar.cmd').write_bytes(script.encode('ascii'))
    # «Kitsune» vuelto a abrir: deja dicho si lo encontró ya instalado.
    (work / 'reabrir.cmd').write_bytes(b'@echo off\r\nif exist "%KITSUNE_ACTUALIZAR_CARPETA%\\platform.ini" '
                                       b'(echo instalado>"%~dp0reabierto.txt") else (echo sin instalar>"%~dp0reabierto.txt")\r\n')
    (work / 'inicial.cmd').write_bytes(f'@echo off\r\n"%~dp0actualizacion\\{name}" /S '
                                       '/InstallDirectoryPath="%KITSUNE_ACTUALIZAR_CARPETA%"\r\n'.encode('ascii'))
    installed = drive / FOLDER[3:].replace('\\', '/')
    shutil.rmtree(installed, ignore_errors=True)

    # El Kitsune de partida, instalado como lo haría Risco (con su acceso en el escritorio).
    wine('cmd', '/c', 'C:\\kitsune-prueba\\inicial.cmd', extra={'KITSUNE_ACTUALIZAR_CARPETA': FOLDER}, timeout=600)
    assert (installed / 'kitsune.exe').exists() and (installed / 'platform.ini').exists(), sorted(os.listdir(drive / 'Program Files'))
    desktops = [drive / 'users' / user / 'Desktop' / 'Kitsune.lnk' for user in ('Public', 'steamuser')]
    assert any(path.exists() for path in desktops), desktops
    for path in desktops:
        path.unlink(missing_ok=True)
    (installed / 'platform.ini').unlink()
    kitsunes = lambda: sorted(path.name for path in (drive / 'Program Files').iterdir() if path.name.startswith('Kitsune'))
    before = kitsunes()

    # «Kitsune», abierto 20 s: un cmd.exe que espera. Sin pantalla no arranca ningún programa con ventana, timeout.exe
    # no quiere la entrada redirigida y una copia renombrada de un programa de Wine no arranca (son de mentira).
    # actualizar.cmd no lanza otro cmd.exe mientras espera, así que no puede confundirlo.
    fake = subprocess.Popen([str(args.wine), 'cmd', '/c', 'ping -n 21 127.0.0.1 >nul'], env=env,
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    pid = None
    for _ in range(30):
        rows = [line.split() for line in wine('tasklist', '/NH').stdout.splitlines()]
        pid = next((row[1] for row in rows if row and row[0].lower() == 'cmd.exe'), None)
        if pid:
            break
        time.sleep(0.5)
    assert pid, 'el Kitsune de prueba (cmd.exe) no aparece en tasklist'
    started = time.monotonic()
    log = tempfile.TemporaryFile()
    update = subprocess.Popen([str(args.wine), 'cmd', '/c', 'C:\\kitsune-prueba\\actualizacion\\actualizar.cmd'],
                              env={**env, 'KITSUNE_ACTUALIZAR_PID': pid, 'KITSUNE_ACTUALIZAR_IMAGEN': 'cmd.exe',
                                   'KITSUNE_ACTUALIZAR_CARPETA': FOLDER, 'KITSUNE_ACTUALIZAR_REABRIR': '1',
                                   'KITSUNE_ACTUALIZAR_EXE': 'C:\\kitsune-prueba\\reabrir.cmd'},
                              stdout=log, stderr=subprocess.STDOUT)
    closed = None
    while update.poll() is None:
        if closed is None and fake.poll() is not None:
            closed = time.monotonic()
        if closed is None:
            assert not (installed / 'platform.ini').exists(), 'se ha instalado con Kitsune abierto'
        assert time.monotonic() - started < 300, 'actualizar.cmd no acaba'
        time.sleep(0.2)
    fake.wait(timeout=30)
    closed = closed or time.monotonic()
    log.seek(0)
    output = log.read().decode(errors='replace')
    assert update.returncode == 0, (update.returncode, output)
    assert closed - started > 4, f'el Kitsune de prueba acabó demasiado pronto ({closed - started:.1f} s) para probar la espera'
    check(f'Con Kitsune abierto no se instala nada; se espera a que se cierre ({closed - started:.0f} s)')

    assert (installed / 'platform.ini').exists() and (installed / 'kitsune.exe').exists(), sorted(os.listdir(installed))
    assert kitsunes() == before, (before, kitsunes())
    assert not any(path.exists() for path in desktops), 'ha vuelto el acceso del escritorio que se quitó'
    check(f'Al cerrarse, se instala en su misma carpeta («{FOLDER}») y no vuelve el acceso del escritorio quitado')

    mark = work / 'reabierto.txt'
    for _ in range(100):
        if mark.exists():
            break
        time.sleep(0.2)
    assert mark.exists() and mark.read_text(errors='replace').strip() == 'instalado', mark.exists() and mark.read_text(errors='replace')
    check('Con «Reiniciar ahora», después vuelve a abrir Kitsune, ya instalado')


if __name__ == '__main__':
    main()

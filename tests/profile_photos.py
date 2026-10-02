#!/usr/bin/env python3
"""Real upload/preview/API avatar tests, using only generated test pictures."""
from __future__ import annotations

import argparse
import contextlib
import io
import json
from pathlib import Path
import shutil
import tempfile
import threading
import urllib.request

from PIL import Image, ImageDraw, PngImagePlugin
from browser_smoke import DEFAULT_BROWSER, ROOT, WebDriver, eventually, prepare_profile, wait_start
from profiles_ui import load_home


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=DEFAULT_BROWSER)
    parser.add_argument('--evidence', type=Path)
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-profile-photos-'))
    evidence = args.evidence.absolute() if args.evidence else root / 'evidence'
    evidence.mkdir(parents=True, exist_ok=True)
    profile, _ = prepare_profile(root)
    browser_data = root / 'browser-data'
    templates = browser_data / 'templates'
    templates.mkdir(parents=True)
    shutil.copyfile(ROOT / 'install/user.js', templates / 'user.js')
    shutil.copytree(ROOT / 'chrome', templates / 'chrome')
    home = load_home()
    manager = home.profiles_module.ProfileManager(browser_data, root / 'state', launch=lambda *args: None)
    manager.snapshot()
    appearance = home.make_appearance(browser_data, root / 'state', 'default')
    server = home.create_server(profile / 'start', root / 'state/home.json', port=0, profiles=manager, appearance=appearance)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    photos = root / 'photos'
    photos.mkdir()
    picture = Image.new('RGB', (480, 240), '#d94646')
    drawing = ImageDraw.Draw(picture)
    drawing.rectangle((120, 0, 359, 239), fill='#24bf83')
    drawing.rectangle((360, 0, 479, 239), fill='#2658b8')
    picture.save(photos / 'center-crop.jpg', quality=98)
    picture = Image.new('RGBA', (300, 500), (0, 0, 0, 0))
    ImageDraw.Draw(picture).ellipse((25, 125, 275, 375), fill='#be82ed')
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text('TestPrivateMetadata', 'This must not survive rasterization')
    picture.save(photos / 'transparent.png', pnginfo=metadata)
    Image.new('RGB', (300, 180), '#4084e8').save(photos / 'latest.webp')
    Image.new('RGB', (9000, 2), '#ffffff').save(photos / 'too-wide.png')
    (photos / 'vector.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16"/></svg>')
    report = {'isolatedRoot': str(root), 'evidence': str(evidence), 'checks': [], 'screenshots': [], 'generatedPicturesOnly': True, 'launchesMocked': True}
    driver = None

    def js(source, *values, asynchronous=False):
        driver.context('content')
        return driver.script(source, values, asynchronous=asynchronous)

    def idle():
        eventually(lambda: js("return document.querySelector('#profiles-dialog').getAttribute('aria-busy')==='false'"))

    def upload(name):
        element = driver.element('#profile-photo')
        driver.command('POST', f'/element/{element}/value', {'text': str(photos / name)})

    def picture_src():
        return js("return document.querySelector('#profile-preview-avatar img')?.getAttribute('src')||null")

    def current():
        return manager.snapshot()['profiles'][0]

    def fetch_avatar(url):
        with urllib.request.urlopen(origin + url, timeout=10) as response:
            return Image.open(io.BytesIO(response.read()))

    def capture(name):
        driver.settle()
        report['screenshots'].append(driver.screenshot(name, chrome=True))
        driver.context('content')

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        driver.navigate(origin + '/')
        wait_start(driver)
        eventually(lambda: js("return document.documentElement.dataset.profilesReady==='true'"))
        js("""window.photoGoogleState={googleRemember:true,native:{available:true,status:'queued',googleRemember:false}};
          const real=window.fetch.bind(window);window.fetch=(input,options)=>input==='/api/appearance'?Promise.resolve(new Response(JSON.stringify(photoGoogleState),{status:200,headers:{'Content-Type':'application/json'}})):real(input,options);""")
        driver.click('#profiles-open')
        idle()
        driver.click('#profile-edit')
        assert js("return !!document.querySelector('#profile-photo')"), 'Photo form source is not ready'
        upload('center-crop.jpg')
        idle()
        eventually(lambda: picture_src() and picture_src().startswith('data:image/jpeg;base64,'))
        assert len(picture_src()) <= 128 * 1024
        driver.click('#profile-remember-google')
        driver.click('#profile-save')
        idle()
        avatar = current()['avatar']
        assert current()['rememberGoogle'] is True
        image = fetch_avatar(avatar).convert('RGB')
        assert image.size == (256, 256)
        for point in ((32, 32), (128, 128), (224, 224)):
            red, green, blue = image.getpixel(point)
            assert green > 150 and red < 80 and blue < 170, (point, red, green, blue)
        for selector in ('#current-profile-avatar img', '#profile-detail-avatar img', '[data-profile-id=default] .profile-avatar img'):
            eventually(lambda selector=selector: js("const i=document.querySelector(arguments[0]);return !!i&&i.complete&&i.naturalWidth===256&&!i.hidden", selector))
        report['checks'].append('JPEG upload is center-cropped to256, persisted by real API, and shown in header/list/detail; rememberGoogle saves with it')
        assert 'Se conservará' not in js("return document.querySelector('#profile-google-status').textContent")
        js("photoGoogleState.native.status='applied';photoGoogleState.native.googleRemember=true")
        eventually(lambda: 'Se conservará la sesión de Google' in js("return document.querySelector('#profile-google-status').textContent"))
        report['checks'].append('Google preservation is not presented as applied until the matching native acknowledgement (test fixture) arrives')
        capture('profile-photo-saved-1540.png')

        driver.click('#profile-edit')
        driver.click('#profile-remember-google')
        js("photoGoogleState.googleRemember=false;photoGoogleState.native.googleRemember=true;photoGoogleState.native.googlePolicyManaged=false")
        driver.click('#profile-save')
        idle()
        eventually(lambda: js("return document.querySelector('#profile-google-status').textContent") == 'Kitsune no gestiona esta excepción; Google se conserva por tus ajustes de privacidad.')
        assert current()['rememberGoogle'] is False
        report['checks'].append('An applied manual Google privacy exception is explained honestly instead of shown as pending when app management is off')
        driver.click('#profile-edit')
        driver.click('#profile-remember-google')
        js("photoGoogleState.googleRemember=true;photoGoogleState.native.googleRemember=true;photoGoogleState.native.googlePolicyManaged=true")
        driver.click('#profile-save')
        idle()

        driver.click('#profile-edit')
        driver.fill('#profile-name', 'Personal con foto')
        driver.click('#profile-save')
        idle()
        assert current()['avatar'] == avatar
        assert current()['rememberGoogle'] is True
        report['checks'].append('Editing labels without choosing a new photo preserves the saved avatar hash')

        driver.click('#profile-edit')
        upload('transparent.png')
        idle()
        eventually(lambda: picture_src() and picture_src().startswith('data:image/png;base64,'))
        draft = picture_src()
        before = manager.snapshot()
        js("""window.photoRealFetch=window.fetch.bind(window);window.fetch=(input,options)=>String(input).startsWith('/api/profiles')&&['POST','PATCH'].includes(options?.method)?Promise.resolve(new Response('{}',{status:503,headers:{'Content-Type':'application/json'}})):window.photoRealFetch(input,options);""")
        driver.click('#profile-save')
        idle()
        assert picture_src() == draft and current()['avatar'] == avatar
        assert manager.snapshot() == before
        assert js("return document.querySelector('#profile-save').disabled")
        js('window.fetch=window.photoRealFetch')
        driver.click('#profiles-reload')
        idle()
        assert picture_src() == draft
        driver.shortcut('\ue00c')
        driver.click('#profiles-open')
        idle()
        assert picture_src() == draft
        driver.click('#profile-save')
        idle()
        alpha_avatar = current()['avatar']
        image = fetch_avatar(alpha_avatar)
        assert image.size == (256, 256) and image.mode == 'RGBA'
        assert image.getpixel((0, 0))[3] == 0 and image.getpixel((128, 128))[3] == 255
        assert 'TestPrivateMetadata' not in image.info and 'exif' not in image.info
        report['checks'].append('Transparent PNG stays transparent and loses source metadata; 503/reconnect/Escape preserve the photo draft')

        driver.click('#profile-edit')
        upload('latest.webp')
        idle()
        eventually(lambda: picture_src() and picture_src().startswith('data:image/jpeg;base64,'))
        draft = picture_src()
        state = manager.snapshot()
        manager.edit('default', 'Cambio desde otra ventana', '', 'pink', state['revision'])
        driver.click('#profile-save')
        idle()
        assert picture_src() == draft
        assert js("return document.querySelector('#profile-name').value") == 'Personal con foto'
        assert js("return document.querySelector('#profile-remember-google').checked")
        assert current()['avatar'] == alpha_avatar
        driver.click('#profile-save')
        idle()
        latest_avatar = current()['avatar']
        assert latest_avatar != alpha_avatar
        report['checks'].append('WebP rasterizes locally and a409 conflict preserves photo/name/checkbox until explicit retry')

        driver.click('#profile-edit')
        upload('vector.svg')
        idle()
        eventually(lambda: js("return !document.querySelector('#profile-photo-error').hidden"))
        assert picture_src() == latest_avatar
        upload('too-wide.png')
        idle()
        assert '8192' in js("return document.querySelector('#profile-photo-error').textContent")
        assert picture_src() == latest_avatar
        report['checks'].append('SVG and oversized image dimensions are rejected without replacing the existing photo')

        # Hold decoders to deterministically exercise cancel and close races.
        js("window.photoRealDecoder=window.createImageBitmap.bind(window);window.photoDecoders=[];window.createImageBitmap=(...args)=>new Promise(resolve=>photoDecoders.push(()=>photoRealDecoder(...args).then(resolve)))")
        upload('transparent.png')
        eventually(lambda: js('return photoDecoders.length===1'))
        assert js("return document.querySelector('#profile-save').disabled")
        driver.click('#profile-cancel')
        driver.click('#profile-edit')
        js('photoDecoders.shift()()')
        js("const done=arguments[arguments.length-1];setTimeout(()=>done(true),250)", asynchronous=True)
        assert picture_src() == latest_avatar
        upload('transparent.png')
        eventually(lambda: js('return photoDecoders.length===1'))
        driver.shortcut('\ue00c')
        driver.click('#profiles-open')
        idle()
        js('photoDecoders.shift()()')
        js("const done=arguments[arguments.length-1];setTimeout(()=>done(true),250)", asynchronous=True)
        assert picture_src() == latest_avatar
        upload('transparent.png')
        eventually(lambda: js('return photoDecoders.length===1'))
        upload('center-crop.jpg')
        eventually(lambda: js('return photoDecoders.length===2'))
        js('photoDecoders.pop()()')
        idle()
        last_selected = picture_src()
        assert last_selected.startswith('data:image/jpeg;base64,')
        js('photoDecoders.shift()()')
        js("const done=arguments[arguments.length-1];setTimeout(()=>done(true),250)", asynchronous=True)
        assert picture_src() == last_selected
        js('window.createImageBitmap=window.photoRealDecoder')
        report['checks'].append('Late decoders cannot change a canceled/reopened form; latest selected file wins; saving is disabled during preparation')

        driver.click('#profile-cancel')
        driver.click('#profile-edit')
        driver.click('#profile-photo-remove')
        assert picture_src() is None and current()['avatar'] == latest_avatar
        driver.click('#profile-save')
        idle()
        assert current()['avatar'] is None
        assert js("return !document.querySelector('#current-profile-avatar img') && !document.querySelector('#profile-detail-avatar img')")
        driver.command('POST', '/refresh', {})
        wait_start(driver)
        eventually(lambda: js("return document.documentElement.dataset.profilesReady==='true'"))
        assert js("return !document.querySelector('#current-profile-avatar img')")
        report['checks'].append('Removing a photo is staged until save and initials remain after reload')

        driver.click('#profiles-open')
        idle()
        driver.click('#profile-create')
        driver.fill('#profile-name', 'Segundo espacio con foto')
        upload('latest.webp')
        idle()
        driver.click('#profile-remember-google')
        driver.click('#profile-save')
        idle()
        created = next(item for item in manager.snapshot()['profiles'] if item['name'] == 'Segundo espacio con foto')
        assert created['avatar'].startswith(f"/api/profile-avatars/{created['id']}/")
        assert created['rememberGoogle'] is True
        assert fetch_avatar(created['avatar']).size == (256, 256)
        assert js("return !document.querySelector('#current-profile-avatar img')")
        assert js("return document.querySelector('#profile-google-status').textContent") == 'Abre este perfil para aplicar la conservación de Google.'
        report['checks'].append('Creating another profile saves its own photo and Google preference without changing this window or claiming it is applied')
        driver.click('[data-profile-id=default]')
        driver.shortcut('\ue00c')

        # A stale 404 picture falls back locally; it must not hide the identity.
        driver.click('#profiles-open')
        idle()
        js("""const real=window.fetch.bind(window);window.fetch=async(input,options)=>{const response=await real(input,options);if(input==='/api/profiles'&&!options?.method){const value=await response.json();value.profiles[0].avatar='/api/profile-avatars/default/'+'f'.repeat(64)+'.png';return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}})}return response}""")
        driver.shortcut('\ue00c')
        driver.click('#profiles-open')
        idle()
        eventually(lambda: js("return !document.querySelector('#current-profile-avatar img') && document.querySelector('#current-profile-avatar').textContent.trim().length>0"))
        report['checks'].append('Missing saved image falls back to initials, never an external URL')
        driver.context('chrome')
        driver.script("const done=arguments[arguments.length-1];document.documentElement.style.setProperty('min-width','0px','important');requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));", asynchronous=True)
        driver.context('content')
        driver.command('POST', '/window/rect', {'width': 390, 'height': 844})
        eventually(lambda: js('return innerWidth===390'))
        driver.click('#profile-edit')
        upload('transparent.png')
        idle()
        assert js("return document.querySelector('#profiles-dialog').scrollWidth<=document.querySelector('#profiles-dialog').clientWidth+1")
        capture('profile-photo-editor-390.png')
        report['checks'].append('Photo editor remains inside a390px viewport')
        driver.context('chrome')
        errors = driver.script("return Services.console.getMessageArray().map(m=>({message:m.message,source:m.sourceName||'',flags:m.flags??null,category:m.category||''})).filter(m=>m.source.startsWith(arguments[0])&&m.flags===0&&m.category.toLowerCase().includes('javascript'));", [origin])
        assert not errors, errors
        report['consoleErrors'] = errors
        report['status'] = 'passed'
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = str(error)
        if driver:
            with contextlib.suppress(Exception): capture('failure.png')
        raise
    finally:
        if driver: driver.close()
        server.shutdown(); server.server_close()
        (evidence / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()

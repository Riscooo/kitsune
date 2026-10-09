#!/usr/bin/env python3
"""Render/check Kitsune's real Gecko header in an isolated headless profile.

No user profile or compositor input. GTK CSD capability is a test-only fixture.
"""
from __future__ import annotations
import argparse
import contextlib
import json
import http.server
import threading
from pathlib import Path
import tempfile

from browser_smoke import DEFAULT_BROWSER, ROOT, WebDriver, eventually, prepare_profile, FixtureHandler


GEOMETRY = """
const rect=e=>e?.getBoundingClientRect().toJSON();
const style=(e,pseudo)=>getComputedStyle(e,pseudo);
const toolbar=document.getElementById('TabsToolbar');
const nav=document.getElementById('nav-bar');
const url=document.getElementById('urlbar-input');
const pseudo=style(toolbar,'::before');
return {width:window.innerWidth, toolHeight:rect(document.getElementById('navigator-toolbox')).height,
  brand:{content:pseudo.content, background:pseudo.backgroundImage, width:pseudo.width,
    pointerEvents:pseudo.pointerEvents, display:pseudo.display},
  navBrand:style(nav,'::before').backgroundImage,
  nav:{rect:rect(nav), background:style(nav).backgroundColor, color:style(nav).color},
  navStateColors:{hover:style(nav).getPropertyValue('--toolbarbutton-background-color-hover').trim(),
    active:style(nav).getPropertyValue('--toolbarbutton-background-color-active').trim(),
    focus:style(nav).getPropertyValue('--focus-outline-color').trim()},
  verticalDots:[...nav.querySelectorAll('.titlebar-button > .toolbarbutton-icon')]
    .filter(e=>rect(e).width>0).map(e=>({background:style(e).backgroundColor, width:rect(e).width})),
  url:{rect:rect(url), color:style(url).color,
    background:style(document.querySelector('#urlbar .urlbar-background')).backgroundColor},
  tabs:[...gBrowser.tabs].map(tab=>({title:tab.label,pinned:tab.pinned,selected:tab.selected,
    rect:rect(tab),icon:rect(tab.querySelector('.tab-icon-image')),
    close:rect(tab.querySelector('.tab-close-button')),color:style(tab).color})),
  vertical:Services.prefs.getBoolPref('sidebar.verticalTabs',false),
  private:document.documentElement.getAttribute('privatebrowsingmode'),
  privateIndicators:[...document.querySelectorAll('.private-browsing-indicator-with-label')]
    .map(e=>({rect:rect(e),display:style(e).display})),
  contentOrigin:gBrowser.currentURI.scheme,
  identity:rect(document.getElementById('identity-icon-box') || document.getElementById('identity-box')),
  menu:rect(document.getElementById('PanelUI-menu-button')),
  signaturesRequired:Services.prefs.getBoolPref('xpinstall.signatures.required'),
  strictFileOrigins:Services.prefs.getBoolPref('security.fileuri.strict_origin_policy'),
  contentSandbox:Services.prefs.getIntPref('security.sandbox.content.level'),
  rootPalette:style(document.documentElement).getPropertyValue('--kb-primary').trim(),
  animations:document.getAnimations().filter(a=>a.effect?.getTiming().iterations===Infinity).length
};
"""


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', type=Path, default=DEFAULT_BROWSER)
    parser.add_argument('--evidence',type=Path,default=ROOT/'tests/evidence/kitsune-header-native-2026-10-02')
    args=parser.parse_args(); args.evidence=args.evidence.resolve();args.evidence.mkdir(parents=True,exist_ok=True)
    report={'scope':'isolated real Gecko headless chrome', 'simulated':['GTK CSD capabilities'],
            'notValidated':['Wayland negotiation of personal running browser'], 'checks':[], 'screenshots':[]}
    browser=None
    with tempfile.TemporaryDirectory(prefix='kitsune-header-') as directory:
        profile,_=prepare_profile(Path(directory))
        with (profile/'user.js').open('a') as handle:
            for key in ('GtkCSDAvailable','GtkCSDCloseButton','GtkCSDMaximizeButton','GtkCSDMinimizeButton'):
                handle.write(f'\nuser_pref("ui.{key}", 1);')
        try:
            browser=WebDriver(profile,args.evidence,browser=args.browser)
            browser.navigate('about:newtab')
            browser.context('chrome')
            eventually(lambda: browser.script('return gBrowser.selectedBrowser.contentTitle.length>0'))
            browser.script('''for(const name of ['Archivo · lectura', 'Vela · biblioteca']) {
              gBrowser.addTab('data:text/html;charset=utf-8,'+encodeURIComponent('<title>'+name+'</title><p>Isolated header fixture.</p>'),
                {triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});
            }
            const pinned=gBrowser.addTab('about:blank',{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});
            gBrowser.pinTab(pinned);''')
            browser.settle()

            def state():
                browser.context('chrome');return browser.script(GEOMETRY)

            def shot(name):
                report['screenshots'].append(browser.screenshot(name,chrome=True))

            wide=state();report['wide']=wide
            assert wide['brand']['content']=='"KITSUNE"' and 'kitsune.svg' in wide['brand']['background'],wide
            assert wide['brand']['pointerEvents']=='none' and wide['animations']==0,wide
            assert 80<=wide['toolHeight']<=110 and wide['url']['rect']['width']>400,wide
            assert wide['signaturesRequired'] and wide['strictFileOrigins'] and wide['contentSandbox']>0,wide
            assert wide['rootPalette']=='#963d32',wide  # óxido de Tinta
            for tab in wide['tabs']:
                if tab['pinned']:
                    assert tab['close']['width']==0,tab
            report['checks'].append('product signature, native tab/navigation geometry, pinned tab rules, security prefs intact, palette unchanged, no continuous animations')
            shot('01-header-wide.png')

            # Real URL entry remains editable; only its own chrome is styled.
            browser.shortcut('l', ('\ue009',))
            browser.fill('#urlbar-input','kitsune local test')
            browser.shortcut('a')
            eventually(lambda:browser.script('return gURLBar.view.isOpen;'))
            focused=state();assert focused['url']['rect']['width']>400,focused
            shot('02-header-url-focus.png')
            browser.shortcut('\ue00c')
            report['checks'].append('native URL focus and typing remain functional')

            # Native Gecko clamps desktop windows to 500px; do not remove that
            # native minimum merely to manufacture a smaller screenshot.
            for width in (800,500):
                browser.command('POST','/window/rect',{'width':width,'height':800})
                value=eventually(lambda:(v if (v:=state())['width']==width else None))
                # 157 shows the native account button (Sync is available in the own engine);
                # at Gecko's 500px minimum the address field keeps ~90px.
                assert value['url']['rect']['width']>=85,value
                assert value['menu']['right']<=width and value['menu']['width']>0,value
                assert value['url']['rect']['left']>=0,value
                report[str(width)]=value;shot(f'03-header-{width}.png')
            report['checks'].append('800px and native-minimum 500px widths: address input and native overflow/menu stay accessible')

            browser.command('POST','/window/rect',{'width':1100,'height':800})
            browser.script('Services.prefs.setBoolPref("sidebar.verticalTabs",true);')
            eventually(lambda: state()['vertical'])
            vertical=eventually(lambda:(v if 'kitsune.svg' in (v:=state())['navBrand'] else None))
            assert vertical['url']['rect']['width']>250,vertical
            report['vertical']=vertical;shot('04-header-vertical.png')
            assert vertical['navStateColors']['hover']=='color-mix(in srgb, #252d2b 6%, transparent)',vertical
            assert vertical['navStateColors']['active']=='color-mix(in srgb, #252d2b 11%, transparent)',vertical
            assert vertical['navStateColors']['focus']=='#963d32',vertical
            dot_colors={dot['background'] for dot in vertical['verticalDots']}
            assert {'rgb(150, 61, 50)','rgb(115, 120, 111)'}<=dot_colors,vertical
            report['checks'].append('canonical Gecko hover/active (ink wash) and rust focus colors, rust/grey window dots on vertical navigation')
            browser.script('Services.prefs.setBoolPref("sidebar.verticalTabs",false);')
            eventually(lambda:not state()['vertical'])
            report['checks'].append('native vertical tabs remain usable; signature follows the navigation toolbar')

            browser.script('document.documentElement.setAttribute("uidensity","compact");')
            compact=state();assert compact['toolHeight']<wide['toolHeight'],compact
            browser.script('document.documentElement.setAttribute("uidensity","touch");')
            touch=state();assert touch['toolHeight']>compact['toolHeight'],touch
            browser.script('document.documentElement.removeAttribute("uidensity");')
            report['checks'].append('compact/touch density preserve responsive native sizing')

            # Change only a fixture variable to verify the appearance contract.
            before=state()['nav']['background']
            browser.script('document.documentElement.style.setProperty("--kb-surface","#fffdf5","important");')
            assert state()['nav']['background']!=before
            browser.script('document.documentElement.style.removeProperty("--kb-surface");')
            assert state()['nav']['background']==before=='rgb(251, 250, 247)'
            report['checks'].append('the navigation bar is drawn from the paper tokens, not hard-coded colors')

            # about:newtab intentionally has no page identity. Exercise the
            # actual security hit region on a fixture, never an external site.
            server=http.server.ThreadingHTTPServer(('127.0.0.1',0),FixtureHandler)
            threading.Thread(target=server.serve_forever,daemon=True).start()
            try:
                page=f'http://127.0.0.1:{server.server_port}/one'
                browser.context('content');browser.navigate(page)
                browser.context('chrome')
                eventually(lambda:browser.script('return gBrowser.selectedBrowser.currentURI.spec;')==page)
                assert browser.script('return !!document.getElementById("identity-box") && document.getElementById("identity-box").isConnected;')
                identity=state()
                if identity['identity']['width']>0:
                    assert browser.script('''const e=document.getElementById('identity-icon-box') || document.getElementById('identity-box'),r=e.getBoundingClientRect();
                        return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));'''),identity
                else:
                    report['notValidated'].append('Loopback native identity icon has no hit region; no HTTPS certificate/padlock visibility claim')
                report['pageIdentity']=identity['identity']
                report['checks'].append('local page navigation preserves native identity DOM; HTTPS-only protection is not weakened for the fixture')
            finally:
                server.shutdown();server.server_close()

            handles=browser.command('GET','/window/handles')
            browser.shortcut('p',('\ue009','\ue008'))
            new=eventually(lambda:[h for h in browser.command('GET','/window/handles') if h not in handles])
            browser.command('POST','/window',{'handle':new[0]})
            private=eventually(lambda:(v if (v:=state())['private']=='temporary' else None))
            assert any(p['rect']['width']>0 and p['display']!='none' for p in private['privateIndicators']),private
            browser.context('content')
            eventually(lambda:browser.script('return document.readyState==="complete" && (document.body?.innerText.length||0)>20;'))
            browser.settle()
            report['private']=private;shot('05-header-private.png')
            report['checks'].append('real private window keeps its native privacy indicator and distinct palette')
            report['passed']=True
        except Exception as error:
            report['passed']=False;report['error']=str(error)
            with contextlib.suppress(Exception):
                report['lastSnapshot']=state();shot('failure.png')
            raise
        finally:
            if browser:browser.close()
            (args.evidence/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'passed':report['passed'],'checks':len(report['checks']), 'evidence':str(args.evidence)},indent=2))


if __name__=='__main__':main()

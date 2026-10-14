#!/usr/bin/env python3
"""Estudio: qué zonas de la parte de arriba de las webs se usan menos.

Para Kitsune Zero: con la web ampliada (sin marco), los botones de ampliar y dividir tienen que ir
encima de la web, y deberían caer donde menos estorben en la mayoría de las webs.

Carga cada web con el motor real (sin Zero, sin ventana), a dos anchos de pantalla, y en una rejilla
de puntos de la franja de arriba mira qué hay en cada punto: algo que se pulsa (enlace, botón,
campo…), texto, imagen (también los fondos con imagen, que suelen ser logos) o nada. Después mide,
para cada sitio posible de una píldora de botones, en cuántas webs taparía algo.

    python3 tools/zonas_web.py --salida /ruta/zonas.json      # las webs, a 1540 y 1280 de ancho
    python3 tools/zonas_web.py --resumen /ruta/zonas.json     # solo el análisis de un estudio hecho

Usa la red (son webs de verdad) y tarda unos 10 minutos.
"""
import argparse
import json
from pathlib import Path
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests'))

# De todo un poco: buscadores, vídeo, redes, noticias (de aquí y de fuera), tiendas, documentación,
# herramientas de trabajo, viajes, servicios… Las que piden cuenta enseñan su portada o su acceso.
SITES = [
    'https://www.google.com', 'https://www.bing.com', 'https://duckduckgo.com', 'https://www.youtube.com',
    'https://www.twitch.tv', 'https://www.netflix.com/es/', 'https://open.spotify.com', 'https://www.reddit.com',
    'https://x.com', 'https://www.instagram.com', 'https://www.linkedin.com', 'https://www.facebook.com',
    'https://es.wikipedia.org/wiki/Kitsune', 'https://en.wikipedia.org/wiki/Fox', 'https://elpais.com', 'https://www.elmundo.es',
    'https://www.marca.com', 'https://www.rtve.es', 'https://www.bbc.com', 'https://www.nytimes.com',
    'https://www.theguardian.com/international', 'https://news.ycombinator.com', 'https://www.amazon.es', 'https://es.aliexpress.com',
    'https://www.ebay.es', 'https://www.pccomponentes.com', 'https://es.wallapop.com', 'https://www.zara.com/es/',
    'https://www.idealista.com', 'https://www.booking.com', 'https://www.airbnb.es', 'https://www.ryanair.com/es/es',
    'https://github.com', 'https://github.com/mozilla-firefox/firefox', 'https://stackoverflow.com/questions', 'https://developer.mozilla.org/es/',
    'https://www.npmjs.com', 'https://vercel.com', 'https://www.notion.com', 'https://www.figma.com',
    'https://www.canva.com', 'https://chatgpt.com', 'https://claude.ai', 'https://www.office.com',
    'https://mail.proton.me', 'https://outlook.live.com', 'https://www.imdb.com', 'https://medium.com',
    'https://dev.to', 'https://www.apple.com/es/', 'https://www.microsoft.com/es-es', 'https://kitsune-navegador.vercel.app',
]
WIDTHS = (1540, 1280)
HEIGHT = 1000
BAND = 140     # px de arriba que se miran
STEP = 6       # separación de la rejilla

# Qué hay en cada punto de la rejilla: «p» (se pulsa), «t» (texto), «i» (imagen), «·» (nada).
SAMPLE = """
const band = arguments[0], step = arguments[1];
const W = innerWidth;
const PRESS = 'a[href],button,input,select,textarea,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=search],[role=combobox],[onclick],[contenteditable=""],[contenteditable=true]';
const hasText = (el, x, y) => {
  for (const node of el.childNodes) {
    if (node.nodeType !== 3 || !node.textContent.trim()) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    for (const r of range.getClientRects()) if (x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1) return true;
  }
  return false;
};
const isImage = el => /^(img|svg|picture|video|canvas|iframe|path|use|g|circle|rect|image)$/i.test(el.localName)
  || (getComputedStyle(el).backgroundImage || 'none') !== 'none' && el.getBoundingClientRect().width < 400;
const rows = [];
for (let y = 2; y < band; y += step) {
  let row = '';
  for (let x = 2; x < W; x += step) {
    const el = document.elementFromPoint(x, y);
    if (!el || el === document.documentElement || el === document.body) { row += '·'; continue; }
    if (el.closest(PRESS)) row += 'p';
    else if (hasText(el, x, y)) row += 't';
    else if (isImage(el)) row += 'i';
    else row += '·';
  }
  rows.push(row);
}
return { rows, width: W, height: innerHeight, title: document.title.slice(0, 80) };
"""


def survey(output: Path, browser: Path | None):
    from browser_smoke import WebDriver, prepare_profile
    root = Path(tempfile.mkdtemp(prefix='kitsune-zonas-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    kwargs = {'browser': browser} if browser else {}
    driver = WebDriver(profile, evidence, **kwargs)
    results = []
    try:
        for width in WIDTHS:
            driver.context('chrome')
            # El tamaño de la ventana para que la web mida «width» de ancho (con la barra de Gecko encima).
            driver.command('POST', '/window/rect', {'width': width, 'height': HEIGHT + 120})
            for url in SITES:
                entry = {'url': url, 'width': width}
                try:
                    driver.navigate(url)
                    time.sleep(3)
                    driver.context('content')
                    entry.update(driver.script(SAMPLE, [BAND, STEP]))
                except Exception as error:  # una web que no carga no para el estudio
                    entry['error'] = str(error)[:200]
                results.append(entry)
                print(f"{width} {url:50} {'error' if 'error' in entry else entry.get('title', '')[:40]}", flush=True)
    finally:
        driver.close()
    output.write_text(json.dumps({'band': BAND, 'step': STEP, 'sites': results}, ensure_ascii=False))
    return output


def occupied(rows, x, y, w, h, step):
    """¿Taparía algo una píldora de w × h en (x, y)? Lo que se pulsa, el texto y las imágenes cuentan."""
    for row_index in range(max(0, (y - 2) // step), min(len(rows), (y + h - 2) // step + 1)):
        row = rows[row_index]
        for col in range(max(0, (x - 2) // step), min(len(row), (x + w - 2) // step + 1)):
            if row[col] != '·':
                return True
    return False


def analyse(data, pill=(70, 30)):
    """Para cada sitio candidato (pegado a la izquierda, a la derecha o en medio, a varias alturas),
    en qué fracción de las webs taparía algo."""
    step, w, h = data['step'], *pill
    sites = [s for s in data['sites'] if 'rows' in s]
    candidates = {}
    for site in sites:
        width = site['width']
        spots = {}
        for y in range(4, data['band'] - h + 1, 4):
            for x in list(range(8, 400, 8)) + list(range(width - 400, width - w - 8 + 1, 8)):
                side = 'izquierda' if x < width / 2 else 'derecha'
                offset = x if side == 'izquierda' else width - (x + w)
                spots[(side, offset, y)] = (x, y)
            for dx in range(-200, 201, 8):
                spots[('centro', dx, y)] = (width // 2 - w // 2 + dx, y)
        for key, (x, y) in spots.items():
            candidates.setdefault(key, []).append(occupied(site['rows'], x, y, w, h, step))
    scored = sorted(((sum(v) / len(v), key, len(v)) for key, v in candidates.items() if len(v) == len(sites)), key=lambda item: (item[0], item[1][2]))
    return sites, scored


def summary(path: Path):
    data = json.loads(path.read_text())
    sites, scored = analyse(data)
    failed = [s['url'] for s in data['sites'] if 'error' in s]
    print(f"{len(sites)} cargas buenas ({len({s['url'] for s in sites})} webs × {len(WIDTHS)} anchos), {len(failed)} fallidas")
    print("Los 12 sitios que menos tapan (fracción de webs donde la píldora de 70×30 taparía algo):")
    for rate, (side, offset, y), n in scored[:12]:
        print(f"  {rate:5.1%}  {side:9} a {offset:4} px del borde · {y:3} px de arriba")
    by_side = {}
    for rate, (side, offset, y), n in scored:
        by_side.setdefault(side, (rate, offset, y))
    print("Lo mejor de cada lado:", {side: f'{rate:.1%} ({offset} px, y {y})' for side, (rate, offset, y) in by_side.items()})
    return scored


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--salida', type=Path, help='dónde guardar el estudio (JSON)')
    parser.add_argument('--resumen', type=Path, help='analizar un estudio ya hecho')
    parser.add_argument('--browser', type=Path)
    args = parser.parse_args()
    if args.resumen:
        summary(args.resumen)
    elif args.salida:
        summary(survey(args.salida, args.browser))
    else:
        parser.error('--salida o --resumen')


if __name__ == '__main__':
    main()

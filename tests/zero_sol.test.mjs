import assert from 'node:assert/strict'
import test from 'node:test'
import {
  sunTimes, themeAt, normalizeConfig, parseCoords, parseClock, contrast, luminance, mix, ensureContrast,
  PALETTES, PERIODS, cssVars, exportTheme, timeline, DARK_PALETTES, LIGHT_PALETTES, SCHEMES,
} from '../zero/modules/zero-sol.mjs'

const MIN = 60000
const near = (actual, expected, minutes, what) =>
  assert.ok(Math.abs(actual - expected) <= minutes * MIN, `${what}: ${new Date(actual).toISOString()} frente a ${new Date(expected).toISOString()}`)

test('el sol sale y se pone cuando dicen las efemérides (Madrid, con unos minutos de margen)', () => {
  // Madrid (40.4168, -3.7038). Solsticio de verano: sale 06:44 y se pone 21:48 (CEST, UTC+2).
  const summer = sunTimes(Date.UTC(2026, 5, 21, 12), 40.4168, -3.7038)
  near(summer.sunrise, Date.UTC(2026, 5, 21, 4, 44), 4, 'salida en verano')
  near(summer.sunset, Date.UTC(2026, 5, 21, 19, 48), 4, 'puesta en verano')
  // Solsticio de invierno: sale 08:33 y se pone 17:51 (CET, UTC+1).
  const winter = sunTimes(Date.UTC(2026, 11, 21, 12), 40.4168, -3.7038)
  near(winter.sunrise, Date.UTC(2026, 11, 21, 7, 33), 4, 'salida en invierno')
  near(winter.sunset, Date.UTC(2026, 11, 21, 16, 51), 4, 'puesta en invierno')
})

test('cerca del polo hay días sin noche y noches sin día (Tromsø)', () => {
  assert.equal(sunTimes(Date.UTC(2026, 5, 21, 12), 69.65, 18.96).polar, 'day')
  assert.equal(sunTimes(Date.UTC(2026, 11, 21, 12), 69.65, 18.96).polar, 'night')
  const theme = themeAt(new Date(2026, 5, 21, 2, 0), { mode: 'solar', latitude: 69.65, longitude: 18.96 })
  assert.equal(theme.period, 'dia')
  assert.equal(theme.sun.polar, 'day')
})

test('las coordenadas se guardan con un decimal (unos 10 km), y lo que no son coordenadas no se acepta', () => {
  assert.deepEqual(parseCoords('40.4168, -3.7038'), { latitude: 40.4, longitude: -3.7 })
  assert.deepEqual(parseCoords('40,42; -3,71'), { latitude: 40.4, longitude: -3.7 })
  assert.deepEqual(parseCoords(' -33.87 151.21 '), { latitude: -33.9, longitude: 151.2 })
  for (const bad of ['', 'Madrid', '91, 0', '0, 181', '40.4', null, undefined]) assert.equal(parseCoords(bad), null, String(bad))
  assert.equal(parseClock('07:30'), 450)
  assert.equal(parseClock('7.05'), 425)
  for (const bad of ['24:00', '7:60', 'siete', '']) assert.equal(parseClock(bad), null, bad)
})

test('lo que no vale en la configuración se queda en su valor de serie', () => {
  const c = normalizeConfig({ mode: 'raro', latitude: 'x', longitude: 4, sunrise: '20:00', sunset: '06:00', period: 'mediodia', transition: 999, step: 0 })
  assert.equal(c.mode, 'solar')
  assert.equal(c.latitude, null)
  assert.equal(c.sunrise, '07:30')
  assert.equal(c.sunset, '19:30')
  assert.equal(c.period, 'dia')
  assert.equal(c.transition, 180)
  assert.equal(c.step, 1)
  const custom = normalizeConfig({ palettes: { dia: { surface: '#FFFFFF', text: 'rojo', scheme: 'dark', material: 3 } } })
  assert.equal(custom.palettes.dia.surface, '#ffffff')
  assert.equal(custom.palettes.dia.text, PALETTES.dia.text)
  assert.equal(custom.palettes.dia.scheme, 'dark')
  assert.equal(custom.palettes.dia.material, 1)
  assert.equal(custom.palettes.noche.surface, PALETTES.noche.surface)
})

test('las cuatro luces se leen bien: texto AAA, secundario AA y acentos visibles sobre su superficie', () => {
  for (const period of PERIODS) {
    const p = PALETTES[period]
    assert.ok(contrast(p.text, p.surface) >= 7, `${period}: texto ${contrast(p.text, p.surface).toFixed(2)}`)
    assert.ok(contrast(p.text, p.raised) >= 7, `${period}: texto sobre lo elevado`)
    assert.ok(contrast(p.quiet, p.surface) >= 4.5, `${period}: secundario ${contrast(p.quiet, p.surface).toFixed(2)}`)
    assert.ok(contrast(p.accent, p.surface) >= 3, `${period}: acento ${contrast(p.accent, p.surface).toFixed(2)}`)
  }
  // El día es blanco perla; la noche, grafito azulado.
  assert.equal(PALETTES.dia.surface, '#f5f7fa')
  assert.equal(PALETTES.noche.surface, '#252d39')
  assert.equal(PALETTES.dia.scheme, 'light')
  assert.equal(PALETTES.noche.scheme, 'dark')
})

test('el estilo Oscuro es oscuro a todas horas, teñido por la luz; el Claro, claro también de noche; Auto, como siempre', () => {
  // Las paletas de los dos estilos nuevos se leen tan bien como las de serie.
  for (const [name, family] of [['oscuro', DARK_PALETTES], ['claro', LIGHT_PALETTES]]) {
    for (const period of PERIODS) {
      const p = family[period]
      assert.ok(contrast(p.text, p.surface) >= 7, `${name}/${period}: texto ${contrast(p.text, p.surface).toFixed(2)}`)
      assert.ok(contrast(p.text, p.raised) >= 7, `${name}/${period}: texto sobre lo elevado`)
      assert.ok(contrast(p.quiet, p.surface) >= 4.5, `${name}/${period}: secundario ${contrast(p.quiet, p.surface).toFixed(2)}`)
      assert.ok(contrast(p.accent, p.surface) >= 3, `${name}/${period}: acento ${contrast(p.accent, p.surface).toFixed(2)}`)
    }
  }
  assert.deepEqual(SCHEMES, ['auto', 'light', 'dark'])
  assert.equal(normalizeConfig({ scheme: 'raro' }).scheme, 'auto')
  // A lo largo de un día «por la hora», cada 20 minutos: Oscuro nunca es claro, Claro nunca es oscuro.
  const day = new Date(2026, 5, 21)
  const seen = { dark: new Set(), light: new Set() }
  for (let minutes = 0; minutes < 24 * 60; minutes += 20) {
    const at = new Date(+day + minutes * MIN)
    const dark = themeAt(at, { mode: 'clock', scheme: 'dark' })
    const light = themeAt(at, { mode: 'clock', scheme: 'light' })
    assert.equal(dark.scheme, 'dark', `oscuro a las ${minutes / 60}`)
    assert.equal(light.scheme, 'light', `claro a las ${minutes / 60}`)
    assert.equal(dark.style, 'dark')
    assert.ok(contrast(dark.colors.text, dark.colors.surface) >= 4.5 && contrast(light.colors.text, light.colors.surface) >= 4.5)
    seen.dark.add(dark.colors.surface); seen.light.add(light.colors.surface)
  }
  // La luz sigue tiñendo: no es un único color oscuro (ni claro) todo el día.
  assert.ok(seen.dark.size > 4 && seen.light.size > 4, `oscuros distintos: ${seen.dark.size}; claros: ${seen.light.size}`)
  // Cada luz fija con cada estilo; Auto es lo de siempre (claro de día, oscuro de noche).
  assert.equal(themeAt(Date.now(), { mode: 'fixed', period: 'dia', scheme: 'dark' }).colors.surface, DARK_PALETTES.dia.surface)
  assert.equal(themeAt(Date.now(), { mode: 'fixed', period: 'noche', scheme: 'light' }).colors.surface, LIGHT_PALETTES.noche.surface)
  assert.equal(themeAt(Date.now(), { mode: 'fixed', period: 'noche' }).colors.surface, PALETTES.noche.surface)
  assert.equal(themeAt(Date.now(), { mode: 'fixed', period: 'dia', scheme: 'auto' }).scheme, 'light')
  assert.equal(exportTheme(themeAt(Date.now(), { mode: 'fixed', scheme: 'dark' })).style, 'dark')
})

test('los colores se mezclan en OKLab y el contraste se recupera sin cambiar de tinta', () => {
  assert.equal(mix('#000000', '#ffffff', 0), '#000000')
  assert.equal(mix('#000000', '#ffffff', 1), '#ffffff')
  const half = mix('#f5f7fa', '#252d39', 0.5)
  assert.ok(luminance(half) > luminance('#252d39') && luminance(half) < luminance('#f5f7fa'))
  const fixed = ensureContrast('#777777', '#808080', 4.5)
  assert.ok(contrast(fixed, '#808080') >= 4.5)
  assert.equal(ensureContrast('#1d222a', '#f5f7fa', 4.5), '#1d222a')   // si ya se lee, no se toca
})

test('por la hora: de día, de noche y en mitad del amanecer, con la próxima mirada donde cambia algo', () => {
  const config = { mode: 'clock', sunrise: '07:30', sunset: '19:30', transition: 50, step: 5 }
  const noon = themeAt(new Date(2026, 2, 10, 13, 0), config)
  assert.equal(noon.period, 'dia')
  assert.equal(noon.scheme, 'light')
  assert.deepEqual(noon.colors.surface, PALETTES.dia.surface)
  // Quieto hasta que empieza el atardecer (19:30 − 2 × 50 min = 17:50).
  assert.equal(noon.next, +new Date(2026, 2, 10, 17, 50))
  const night = themeAt(new Date(2026, 2, 10, 3, 0), config)
  assert.equal(night.period, 'noche')
  assert.equal(night.scheme, 'dark')
  assert.equal(night.next, +new Date(2026, 2, 10, 6, 40))
  const dawn = themeAt(new Date(2026, 2, 10, 7, 30), config)
  assert.equal(dawn.from, 'noche')
  assert.equal(dawn.to, 'amanecer')
  assert.ok(dawn.progress > 0 && dawn.progress < 1)
  assert.equal(dawn.next, +new Date(2026, 2, 10, 7, 35))   // durante el cambio, cada 5 minutos
  assert.equal(dawn.source, 'clock')
})

test('sin coordenadas, «del sol» va por la hora; con ellas, por el sol', () => {
  assert.equal(themeAt(new Date(2026, 2, 10, 13, 0), { mode: 'solar' }).source, 'clock')
  const madrid = themeAt(new Date(2026, 5, 21, 14, 0), { mode: 'solar', latitude: 40.4, longitude: -3.7 })
  assert.equal(madrid.source, 'solar')
  assert.ok(madrid.sun.sunrise && madrid.sun.sunset)
})

test('una luz fija no cambia sola, y no programa nada', () => {
  const theme = themeAt(new Date(2026, 2, 10, 23, 0), { mode: 'fixed', period: 'atardecer' })
  assert.equal(theme.period, 'atardecer')
  assert.equal(theme.next, null)
  assert.equal(theme.colors.surface, PALETTES.atardecer.surface)
})

for (const [name, config] of [
  ['por la hora', { mode: 'clock' }],
  ['del sol en Madrid, en invierno', { mode: 'solar', latitude: 40.4, longitude: -3.7, day: [2026, 11, 21] }],
  ['del sol en Madrid, en verano', { mode: 'solar', latitude: 40.4, longitude: -3.7, day: [2026, 5, 21] }],
  ['del sol en Helsinki, en invierno (días cortos)', { mode: 'solar', latitude: 60.2, longitude: 24.9, day: [2026, 11, 21] }],
]) {
  test(`un día entero ${name}: siempre legible, sin saltos y un solo cambio de esquema en cada sentido`, () => {
    const [y, m, d] = config.day ?? [2026, 2, 10]
    let previous = null, flips = 0, maxStep = 0, checks = 0
    for (let minute = 0; minute < 24 * 60; minute += 1) {
      const theme = themeAt(new Date(y, m, d, 0, minute), config)
      assert.ok(contrast(theme.colors.text, theme.colors.surface) >= 4.5, `${minute} min: texto ${contrast(theme.colors.text, theme.colors.surface).toFixed(2)}`)
      assert.ok(contrast(theme.colors.text, theme.colors.raised) >= 4.5, `${minute} min: texto sobre lo elevado`)
      assert.ok(contrast(theme.colors.accent, theme.colors.surface) >= 3, `${minute} min: acento`)
      assert.ok(contrast(theme.colors.quiet, theme.colors.surface) >= 3, `${minute} min: secundario`)
      assert.ok(theme.next > theme.at, 'la próxima mirada es en el futuro')
      if (previous) {
        if (previous.scheme !== theme.scheme) flips += 1
        maxStep = Math.max(maxStep, Math.abs(luminance(theme.colors.surface) - luminance(previous.colors.surface)))
      }
      previous = theme
      checks += 1
    }
    assert.equal(checks, 1440)
    assert.equal(flips, 2, 'claro → oscuro al anochecer y oscuro → claro al amanecer')
    assert.ok(maxStep < 0.03, `el mayor salto de un minuto a otro es pequeño (${maxStep.toFixed(4)})`)
  })
}

test('la línea del día está ordenada aunque las transiciones crucen la medianoche', () => {
  const keys = timeline(+new Date(2026, 5, 21, 12), normalizeConfig({ mode: 'clock', sunrise: '00:20', sunset: '23:50', transition: 60 }))
  for (let i = 1; i < keys.length; i += 1) assert.ok(keys[i][0] >= keys[i - 1][0])
})

test('el tema sale como variables CSS y como JSON para otros programas', () => {
  const theme = themeAt(new Date(2026, 2, 10, 13, 0), { mode: 'clock' })
  const vars = cssVars(theme)
  assert.equal(vars['--sol-surface'], PALETTES.dia.surface)
  assert.equal(vars['--sol-material'], '0.85')
  const json = exportTheme(theme)
  assert.equal(json.schema, 1)
  assert.equal(json.period, 'dia')
  assert.match(json.at, /^\d{4}-\d{2}-\d{2}T/)
  assert.match(json.next, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(json.colorsUnit.surface, '0.961 0.969 0.98')
  assert.equal(JSON.parse(JSON.stringify(json)).colors.text, theme.colors.text)
})

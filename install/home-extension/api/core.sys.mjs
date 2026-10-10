/* Inicio integrado de Kitsune: las mismas reglas que install/home-server.py,
 * install/appearance.py e install/profiles.py, sin E/S. Lo usa api/parent.js
 * dentro del motor (Windows y macOS, donde no hay servidor local) y lo prueban
 * los tests de Node. Los textos de error son los del servidor: la página los
 * enseña tal cual.
 */

export const MAX_REVISION = Number.MAX_SAFE_INTEGER
export const MAX_SETTINGS_BYTES = 32 * 1024
export const MAX_PROFILES = 24
export const COLORS = Object.freeze(['blue', 'pink', 'violet', 'teal', 'amber', 'red'])
export const PRIVACY_MODES = Object.freeze(['estricto', 'comodo'])
export const DEFAULT_PRIVACY_MODE = 'estricto'
// Lo que puede abrir la ficha de un perfil: siempre una de estas, nunca una dirección de la página.
export const ACTIONS = Object.freeze({
  home: null,
  google: 'https://accounts.google.com/ServiceLogin',
  privacy: 'about:preferences#privacy',
  passwords: 'about:logins',
  settings: 'about:preferences',
  general: 'about:preferences#general',
  search: 'about:preferences#search',
  downloads: 'about:downloads',
  extensions: 'about:addons',
})

export class HomeError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.name = 'HomeError'
    this.status = status
    this.extra = extra
  }
}
const invalid = message => new HomeError(400, message)

export const DEFAULT_DATA = Object.freeze({
  links: [
    { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/', color: 'red', icon: 'play' },
    { id: 'gmail', name: 'Gmail', url: 'https://mail.google.com/', color: 'blue', icon: 'mail' },
    { id: 'github', name: 'GitHub', url: 'https://github.com/', color: 'white', icon: 'code' },
    { id: 'anime', name: 'MyAnimeList', url: 'https://myanimelist.net/', color: 'violet', icon: 'sparkles' },
    { id: 'wiki', name: 'Wikipedia', url: 'https://es.wikipedia.org/', color: 'teal', icon: 'book' },
  ],
  art: true, motion: true, newTab: false, accent: 'blue', focus: false,
  wallpaper: 'night', themeSync: false, modules: { clock: true, shortcuts: true },
  theme: 'claro', background: null,
  windowControls: 'izquierda', brand: true,
  performance: 'normal', ramLimit: 2048,
  minimize: true,
})
const LEGACY_KEYS = ['links', 'art', 'motion', 'newTab', 'accent', 'focus']
const HASH = /^[0-9a-f]{64}$/
const LINK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/
export const clone = value => JSON.parse(JSON.stringify(value))
// Para api/parent.js, cuyo ámbito de Gecko no trae TextEncoder ni TextDecoder.
export const encodeText = text => new TextEncoder().encode(text)
export const decodeText = bytes => new TextDecoder().decode(bytes)
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const hasControl = text => [...text].some(char => char.charCodeAt(0) < 32)

export const validRevision = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_REVISION

const wellFormed = url => typeof url === 'string' && url.length >= 1 && url.length <= 4096 && !/\s/.test(url) && !hasControl(url) && !url.includes('\\')

function validUrl(url) {
  let parsed
  try { parsed = new URL(url) } catch { return false }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return false
  // Como urlsplit en el servidor: nada de @ en la autoridad ni % en el host.
  const authority = url.slice(url.indexOf('//') + 2).split(/[/?#]/)[0]
  return !authority.includes('@') && !authority.split(':')[0].includes('%')
}

/** Ajustes del inicio: los del servidor, con los de un cliente antiguo encima de los guardados. */
export function validateSettings(value, base = null) {
  const keys = isObject(value) ? Object.keys(value) : null
  if (!keys || !LEGACY_KEYS.every(key => keys.includes(key)) || keys.some(key => !Object.hasOwn(DEFAULT_DATA, key))) {
    throw invalid('La estructura de los ajustes no es válida.')
  }
  const data = { ...clone(base ?? DEFAULT_DATA), ...clone(value) }
  for (const key of ['art', 'motion', 'newTab', 'focus', 'themeSync']) {
    if (typeof data[key] !== 'boolean') throw invalid('Las preferencias deben ser verdaderas o falsas.')
  }
  if (!['blue', 'pink', 'system'].includes(data.accent)) throw invalid('El color de acento no es válido.')
  if (!['night', 'veil', 'dusk', 'ember'].includes(data.wallpaper)) throw invalid('El fondo seleccionado no es válido.')
  if (!['claro', 'oscuro'].includes(data.theme)) throw invalid('El tema no es válido.')
  if (!['izquierda', 'derecha'].includes(data.windowControls) || typeof data.brand !== 'boolean') throw invalid('Las opciones de la ventana no son válidas.')
  if (typeof data.minimize !== 'boolean') throw invalid('Las opciones de la ventana no son válidas.')
  if (!['normal', 'ahorro'].includes(data.performance) || ![1024, 2048, 4096].includes(data.ramLimit)) throw invalid('El modo de rendimiento no es válido.')
  if (data.background !== null && (typeof data.background !== 'string' || !HASH.test(data.background))) throw invalid('El fondo no es válido.')
  const modules = data.modules
  if (!isObject(modules) || Object.keys(modules).sort().join() !== 'clock,shortcuts' || Object.values(modules).some(flag => typeof flag !== 'boolean')) {
    throw invalid('Los módulos de inicio no son válidos.')
  }
  if (!Array.isArray(data.links) || data.links.length > 12) throw invalid('Se permiten hasta 12 accesos.')
  const ids = new Set()
  for (const link of data.links) {
    if (!isObject(link) || Object.keys(link).sort().join() !== 'color,icon,id,name,url') throw invalid('La estructura de un acceso no es válida.')
    if (typeof link.id !== 'string' || !LINK_ID.test(link.id) || ids.has(link.id)) throw invalid('El identificador de un acceso no es válido.')
    ids.add(link.id)
    if (typeof link.name !== 'string' || link.name.length < 1 || link.name.length > 36 || link.name !== link.name.trim() || hasControl(link.name)) {
      throw invalid('Cada acceso necesita un nombre de hasta 36 caracteres.')
    }
    if (!wellFormed(link.url)) throw invalid('La dirección de un acceso no es válida.')
    if (!validUrl(link.url)) throw invalid('Solo se admiten direcciones http o https sin credenciales.')
    if (!['red', 'blue', 'white', 'violet', 'teal'].includes(link.color)) throw invalid('El color de un acceso no es válido.')
    if (!['', 'play', 'mail', 'code', 'sparkles', 'book'].includes(link.icon)) throw invalid('El icono de un acceso no es válido.')
  }
  return clone(data)
}

/** Lo guardado en disco: { version: 2, data, revision }. Si no se entiende, no se sustituye. */
export function parseSettingsRecord(text) {
  let record
  try { record = JSON.parse(text) } catch { throw new HomeError(503, 'Los ajustes locales no están disponibles.') }
  if (!isObject(record) || Object.keys(record).sort().join() !== 'data,revision,version' || record.version !== 2 || !validRevision(record.revision)) {
    throw new HomeError(503, 'Los ajustes locales no están disponibles.')
  }
  try { return { version: 2, data: validateSettings(record.data), revision: record.revision } } catch {
    throw new HomeError(503, 'Los ajustes locales no están disponibles.')
  }
}

export const defaultSettingsRecord = () => ({ version: 2, data: clone(DEFAULT_DATA), revision: 0 })

/** PUT /api/settings: solo con la revisión vigente; el fondo solo se queda, se quita o pasa al recién guardado. */
export function updateSettings(record, data, revision, newBackground = null) {
  validateSettings(data)
  if (!validRevision(revision)) throw invalid('La revisión de los ajustes no es válida.')
  if (revision !== record.revision) return { updated: false, record }
  if (record.revision === MAX_REVISION) throw new HomeError(503, 'No se puede incrementar la revisión de los ajustes.')
  const validated = validateSettings(data, record.data)
  if (![null, record.data.background, newBackground].includes(validated.background)) throw invalid('El fondo no es válido.')
  const next = { version: 2, data: validated, revision: record.revision + 1 }
  if (new TextEncoder().encode(JSON.stringify(next)).length > MAX_SETTINGS_BYTES) throw invalid('Los ajustes superan el tamaño máximo.')
  return { updated: true, record: next }
}

// Apariencia: el control v6 que lee install/native/kitsune-appearance.sys.mjs.
const KEYS = ['bg', 'surface', 'surfaceHigh', 'text', 'muted', 'outline', 'primary', 'primaryContainer', 'secondary', 'tertiary']
const palette = colors => Object.fromEntries(KEYS.map((key, index) => [key, colors[index]]))
export const PALETTES = Object.freeze({
  claro: palette(['#f6f5f1', '#fbfaf7', '#e8ece4', '#252d2b', '#59625c', '#c7cdc4', '#963d32', '#eadfda', '#496b60', '#73786f']),
  oscuro: palette(['#161a19', '#1e2321', '#2a302d', '#ebe8e0', '#a9b0a8', '#3f4743', '#e0806b', '#4b2a23', '#8fb8aa', '#8d9389']),
})

/** El control sin la huella; `backgroundExists` dice si la imagen está en el perfil. */
export function appearanceControl(settings, { remember = false, backgroundExists = true } = {}) {
  const background = settings.background && backgroundExists ? settings.background : null
  return {
    version: 6, palette: { ...PALETTES[settings.theme] }, motion: settings.motion, googleRemember: remember === true,
    theme: settings.theme, background, windowControls: settings.windowControls, brand: settings.brand,
    performance: settings.performance, ramLimit: settings.ramLimit, minimize: settings.minimize,
  }
}

/** JSON con las claves ordenadas, para la huella (igual en cualquier orden de entrada). */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

/** Estado nativo a partir del acuse del módulo nativo (como appearance.py). */
export function nativeStatus(ack, fingerprint, now = Date.now()) {
  const native = { available: true, status: 'queued' }
  if (isObject(ack) && ack.version === 1 && ack.fingerprint === fingerprint && typeof ack.at === 'number' && now - ack.at >= 0 && now - ack.at < 30000) {
    Object.assign(native, { status: 'applied', googleRemember: ack.googleRemember === true, googlePolicyManaged: ack.googlePolicyManaged === true })
    if (PRIVACY_MODES.includes(ack.privacyMode)) native.privacyMode = ack.privacyMode
  }
  return native
}

// Perfiles: el registro vive junto a los perfiles de Gecko (no en uno de ellos).
const PROFILE_ID = /^(default|p-[0-9a-f]{16})$/
export const validProfileId = value => typeof value === 'string' && PROFILE_ID.test(value)
const badProfile = message => new HomeError(400, message)

export function validateLabel(name, email, color) {
  if (typeof name !== 'string' || name.length < 1 || name.length > 48 || name !== name.trim() || [...name].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) {
    throw badProfile('Escribe un nombre de entre 1 y 48 caracteres.')
  }
  if (typeof email !== 'string' || email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || [...email].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) {
    throw badProfile('Escribe un correo válido o deja este campo vacío. Es una etiqueta local, no una cuenta verificada.')
  }
  if (!COLORS.includes(color)) throw badProfile('El color del perfil no es válido.')
  return { name, email, color }
}

/** El perfil con el que se instala Kitsune: genérico, sin datos de nadie. */
export function defaultProfilesRecord(createdAt, geckoPath) {
  return {
    version: 1, revision: 0, defaultId: 'default', profiles: [{
      id: 'default', name: 'Personal', email: '', color: 'blue', createdAt, lastUsed: '',
      avatarHash: null, rememberGoogle: false, privacyMode: DEFAULT_PRIVACY_MODE, path: geckoPath,
    }],
  }
}

const PROFILE_KEYS = 'avatarHash,color,createdAt,email,id,lastUsed,name,path,privacyMode,rememberGoogle'
export function validateProfilesRecord(record) {
  const fail = () => new HomeError(503, 'El registro local de perfiles necesita revisión. No se ha sobrescrito.')
  if (!isObject(record) || Object.keys(record).sort().join() !== 'defaultId,profiles,revision,version' || record.version !== 1 || !validRevision(record.revision)) throw fail()
  if (!Array.isArray(record.profiles) || record.profiles.length < 1 || record.profiles.length > MAX_PROFILES) throw fail()
  const ids = new Set()
  for (const profile of record.profiles) {
    if (!isObject(profile) || Object.keys(profile).sort().join() !== PROFILE_KEYS) throw fail()
    if (!validProfileId(profile.id) || ids.has(profile.id)) throw fail()
    ids.add(profile.id)
    try { validateLabel(profile.name, profile.email, profile.color) } catch { throw fail() }
    if (profile.avatarHash !== null && (typeof profile.avatarHash !== 'string' || !HASH.test(profile.avatarHash))) throw fail()
    if (typeof profile.rememberGoogle !== 'boolean' || !PRIVACY_MODES.includes(profile.privacyMode)) throw fail()
    if (typeof profile.path !== 'string' || !profile.path || profile.path.length > 4096) throw fail()
    if ([profile.createdAt, profile.lastUsed].some(value => typeof value !== 'string' || value.length > 40)) throw fail()
  }
  if (!ids.has('default') || !ids.has(record.defaultId)) throw fail()
  return record
}

/** Lo que ve la página (el mismo formato que profiles.py): sin rutas. */
export function profilesSnapshot(record, currentId) {
  if (!record.profiles.some(profile => profile.id === currentId)) throw new HomeError(404, 'No se ha encontrado ese perfil.')
  return {
    version: 1, revision: record.revision, currentId, defaultId: record.defaultId,
    profiles: record.profiles.map(profile => ({
      id: profile.id, name: profile.name, email: profile.email, color: profile.color,
      createdAt: profile.createdAt, lastUsed: profile.lastUsed, rememberGoogle: profile.rememberGoogle,
      avatar: profile.avatarHash ? `/api/profile-avatars/${profile.id}/${profile.avatarHash}.png` : null,
      isDefault: profile.id === record.defaultId, isCurrent: profile.id === currentId, privacyMode: profile.privacyMode,
    })),
  }
}

export function findProfile(record, id) {
  if (!validProfileId(id)) throw badProfile('El identificador del perfil no es válido.')
  const profile = record.profiles.find(item => item.id === id)
  if (!profile) throw new HomeError(404, 'No se ha encontrado ese perfil.')
  return profile
}

export function checkProfilesRevision(record, revision, currentId) {
  if (!validRevision(revision)) throw badProfile('La revisión del registro no es válida.')
  if (revision !== record.revision) {
    throw new HomeError(409, 'Los perfiles han cambiado en otra ventana.', profilesSnapshot(record, currentId))
  }
  if (record.revision === MAX_REVISION) throw new HomeError(503, 'No se puede actualizar la revisión del registro.')
}

const OMITTED = Symbol('omitted')
/** Cuerpo de crear o editar: nombre, correo, color y revisión; foto, Google y modo, si vienen. */
export function parseProfileBody(value) {
  const allowed = ['name', 'email', 'color', 'revision', 'avatarData', 'rememberGoogle', 'privacyMode']
  if (!isObject(value) || !['name', 'email', 'color', 'revision'].every(key => Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => !allowed.includes(key))) throw badProfile('La solicitud del perfil no es válida.')
  const body = { ...validateLabel(value.name, value.email, value.color), revision: value.revision }
  body.rememberGoogle = Object.hasOwn(value, 'rememberGoogle') ? value.rememberGoogle : OMITTED
  if (body.rememberGoogle !== OMITTED && typeof body.rememberGoogle !== 'boolean') throw badProfile('La preferencia de Google debe estar activada o desactivada.')
  body.privacyMode = Object.hasOwn(value, 'privacyMode') ? value.privacyMode : OMITTED
  if (body.privacyMode !== OMITTED && !PRIVACY_MODES.includes(body.privacyMode)) throw badProfile('El modo de privacidad debe ser Estricto o Cómodo.')
  body.avatarData = Object.hasOwn(value, 'avatarData') ? value.avatarData : OMITTED
  if (body.avatarData !== OMITTED && body.avatarData !== null && (typeof body.avatarData !== 'string' || body.avatarData.length > 2 * 1024 * 1024)) {
    throw badProfile('La foto del perfil no es válida.')
  }
  return body
}
export const isOmitted = value => value === OMITTED

/** Líneas de user.js que gestiona Kitsune en cada perfil (el resto del archivo no se toca). */
export const USER_JS_BEGIN = '// @@KITSUNE_PROFILE_BEGIN@@'
export const USER_JS_END = '// @@KITSUNE_PROFILE_END@@'
export function withProfileBlock(text, privacyMode) {
  if (!PRIVACY_MODES.includes(privacyMode)) throw badProfile('El modo de privacidad debe ser Estricto o Cómodo.')
  const block = `${USER_JS_BEGIN}\n// Modo de privacidad del perfil (lo lee kitsune.cfg al arrancar).\nuser_pref("kitsune.privacy.requested", ${JSON.stringify(privacyMode)});\n${USER_JS_END}\n`
  const start = text.indexOf(USER_JS_BEGIN)
  const end = text.indexOf(USER_JS_END)
  if (start !== -1 && end > start) return text.slice(0, start) + block + text.slice(end + USER_JS_END.length).replace(/^\n/, '')
  return (text && !text.endsWith('\n') ? `${text}\n` : text) + block
}

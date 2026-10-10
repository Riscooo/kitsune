/* Inicio integrado de Kitsune (Windows y macOS): lo que en Linux hace el servidor
 * local, aquí dentro del motor. Solo responde a la página de esta extensión
 * (experiment API «kitsuneHome», ámbito addon_parent): ninguna web llega aquí.
 * Las reglas están en api/core.sys.mjs; esto es solo la parte de Gecko.
 *
 * Dónde guarda cada cosa:
 *   <perfil>/kitsune-home.json                       ajustes del inicio
 *   <perfil>/chrome/kitsune-appearance(.json|-ack)  control del módulo nativo
 *   <perfil>/chrome/kitsune-background-<sha>.jpg     fondo propio
 *   <carpeta de perfiles>/kitsune-profiles.json      registro de perfiles
 *   <carpeta de perfiles>/kitsune-avatars/<id>/      fotos de perfil
 */
/* global ExtensionAPI, ChromeUtils, Services, IOUtils, PathUtils, Cc, Ci */
'use strict'

const SETTINGS_FILE = 'kitsune-home.json'
const PROFILES_FILE = 'kitsune-profiles.json'
const MAX_BACKGROUND_JPEG = 4 * 1024 * 1024
const MAX_AVATAR_PNG = 512 * 1024
const BACKGROUND_BOX = [2560, 1600]
const TOKEN = 'integrado'

// Gecko solo carga módulos de sistema desde resource:// o chrome://, y la extensión
// ve su carpeta ya resuelta (jar: dentro del motor). Se usa su dirección resource://,
// solo si de verdad apunta a los archivos de esta extensión.
function coreModule(extension) {
  const resources = Services.io.getProtocolHandler('resource').QueryInterface(Ci.nsIResProtocolHandler)
  for (const base of ['resource://builtin-addons/kitsune-home/', Services.prefs.getStringPref('kitsune.home.testResource', '')]) {
    if (!/^resource:\/\/[a-z0-9-]+\/(?:[a-z0-9-]+\/)*$/.test(base)) continue
    try {
      if (resources.resolveURI(Services.io.newURI(base)) === extension.rootURI.spec) return `${base}api/core.sys.mjs`
    } catch { /* esa dirección no existe en este motor */ }
  }
  throw new Error('Kitsune: no se encuentra el núcleo del inicio integrado.')
}

this.kitsuneHome = class extends ExtensionAPI {
  getAPI(context) {
    const core = ChromeUtils.importESModule(coreModule(context.extension))
    const { HomeError } = core
    let settingsQueue = Promise.resolve()
    let profilesQueue = Promise.resolve()
    // Una operación de escritura detrás de otra (como el lock del servidor).
    const serial = (queue, task) => {
      const next = queue.then(task, task)
      return [next, next.catch(() => {})]
    }

    const profileDir = () => PathUtils.profileDir
    const chromeDir = () => PathUtils.join(profileDir(), 'chrome')
    // Carpeta común a todos los perfiles (la de profiles.ini); los tests la cambian.
    const profilesRoot = () => Services.prefs.getStringPref('kitsune.home.profilesRoot', '') ||
      Services.dirsvc.get('UAppData', Ci.nsIFile).path
    const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00')

    function sha256(bytes) {
      const hasher = Cc['@mozilla.org/security/hash;1'].createInstance(Ci.nsICryptoHash)
      hasher.init(hasher.SHA256)
      hasher.update(bytes, bytes.length)
      return [...hasher.finish(false)].map(char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('')
    }

    async function readFile(path, maxBytes) {
      const info = await IOUtils.stat(path)
      if (info.type !== 'regular' || info.size > maxBytes) throw new HomeError(503, 'El archivo local no es válido.')
      return IOUtils.read(path, { maxBytes })
    }
    const readText = async (path, maxBytes) => core.decodeText(await readFile(path, maxBytes))
    async function writeAtomic(path, data) {
      await IOUtils.makeDirectory(PathUtils.parent(path), { createAncestors: true, permissions: 0o700 })
      await IOUtils.write(path, data, { tmpPath: `${path}.tmp`, flush: true })
      await IOUtils.setPermissions(path, 0o600).catch(() => {})
    }
    const writeJson = (path, value) => writeAtomic(path, core.encodeText(JSON.stringify(value)))

    // Imágenes: solo PNG, JPEG o WebP fijos; se vuelven a codificar aquí, nunca se guarda el original.
    const IMAGE_TYPES = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }
    function decodeDataUrl(value, { maxBytes, tooBig, wrongType, unreadable }) {
      if (typeof value !== 'string' || value.length > maxBytes * 4 / 3 + 64) throw new HomeError(400, tooBig)
      const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value)
      if (!match) throw new HomeError(400, wrongType)
      let bytes
      try { bytes = Uint8Array.fromBase64(match[2]) } catch { throw new HomeError(400, unreadable) }
      if (!bytes.length || bytes.length > maxBytes) throw new HomeError(400, tooBig)
      const magic = { png: [0x89, 0x50, 0x4e, 0x47], jpeg: [0xff, 0xd8, 0xff], webp: [0x52, 0x49, 0x46, 0x46] }[match[1]]
      if (magic.some((byte, index) => bytes[index] !== byte)) throw new HomeError(400, wrongType)
      return { bytes, type: IMAGE_TYPES[match[1]] }
    }
    const imgTools = () => Cc['@mozilla.org/image/tools;1'].getService(Ci.imgITools)
    function decodeImage({ bytes, type }, { maxSide, maxPixels, unreadable }) {
      let image
      try { image = imgTools().decodeImageFromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), type) } catch {
        throw new HomeError(400, unreadable)
      }
      const { width, height } = image
      if (!width || !height || width > maxSide || height > maxSide || width * height > maxPixels) throw new HomeError(400, unreadable)
      // Una imagen animada se guarda con su primer fotograma (Gecko no lo sabe hasta decodificarla).
      return image
    }
    function streamBytes(stream) {
      const binary = Cc['@mozilla.org/binaryinputstream;1'].createInstance(Ci.nsIBinaryInputStream)
      binary.setInputStream(stream)
      const chunks = []
      let available
      while ((available = binary.available()) > 0) chunks.push(Uint8Array.from(binary.readByteArray(available)))
      const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
      let offset = 0
      for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length }
      return out
    }

    // Ajustes del inicio.
    const settingsPath = () => PathUtils.join(profileDir(), SETTINGS_FILE)
    async function readSettings() {
      try {
        return core.parseSettingsRecord(await readText(settingsPath(), core.MAX_SETTINGS_BYTES))
      } catch (error) {
        if (error.name === 'NotFoundError') return core.defaultSettingsRecord()
        // Nunca se sustituyen unos ajustes que no se entienden por los de fábrica.
        throw error instanceof HomeError ? error : new HomeError(503, 'No se pueden leer los ajustes locales.')
      }
    }
    const backgroundPath = digest => PathUtils.join(chromeDir(), `kitsune-background-${digest}.jpg`)
    async function pruneBackgrounds(keep) {
      for (const path of await IOUtils.getChildren(chromeDir()).catch(() => [])) {
        const name = PathUtils.filename(path)
        if (/^kitsune-background-[0-9a-f]{64}\.jpg$/.test(name) && name !== `kitsune-background-${keep}.jpg`) await IOUtils.remove(path).catch(() => {})
      }
    }

    // Apariencia: el control del módulo nativo, el mismo que escribe appearance.py.
    async function refreshAppearance(settings) {
      const backgroundExists = settings.background ? await IOUtils.exists(backgroundPath(settings.background)) : true
      let remember = false
      try {
        const registry = await readProfiles()
        remember = registry.profiles.find(profile => samePath(profile.path, profileDir()))?.rememberGoogle === true
      } catch { /* sin registro, Google no se recuerda */ }
      const value = core.appearanceControl(settings, { remember, backgroundExists })
      value.fingerprint = sha256(core.encodeText(core.canonicalJson(value)))
      const control = PathUtils.join(chromeDir(), 'kitsune-appearance.json')
      let same = false
      try { same = core.canonicalJson(JSON.parse(await readText(control, 8192))) === core.canonicalJson(value) } catch { /* se escribe */ }
      if (!same) await writeJson(control, value)
      let ack = null
      try { ack = JSON.parse(await readText(PathUtils.join(chromeDir(), 'kitsune-appearance-ack.json'), 8192)) } catch { /* aún no */ }
      return { ...value, native: core.nativeStatus(ack, value.fingerprint) }
    }

    // Perfiles: un perfil de Kitsune es un perfil de Gecko con nombre, color, foto y modo.
    const profilesPath = () => PathUtils.join(profilesRoot(), PROFILES_FILE)
    const normalize = path => PathUtils.normalize(path).replace(/[\\/]+$/, '')
    const samePath = (a, b) => normalize(a).toLowerCase() === normalize(b).toLowerCase()
    async function readProfiles() {
      try {
        return core.validateProfilesRecord(JSON.parse(await readText(profilesPath(), 128 * 1024)))
      } catch (error) {
        if (error.name === 'NotFoundError') return null
        throw error instanceof HomeError ? error : new HomeError(503, 'El registro local de perfiles necesita revisión. No se ha sobrescrito.')
      }
    }
    // El registro y el perfil de esta ventana; el primer perfil abierto es «Personal».
    async function loadProfiles() {
      let record = await readProfiles()
      if (!record) {
        record = core.defaultProfilesRecord(now(), profileDir())
        await writeJson(profilesPath(), record)
      }
      let current = record.profiles.find(profile => samePath(profile.path, profileDir()))
      if (!current) {
        // Un perfil de Gecko que Kitsune aún no conocía (p. ej. abierto con -P): se apunta sin tocar sus datos.
        if (record.profiles.length >= core.MAX_PROFILES) throw new HomeError(503, 'Hay demasiados perfiles locales.')
        current = { id: newId(record), name: 'Perfil', email: '', color: 'teal', createdAt: now(), lastUsed: now(),
          avatarHash: null, rememberGoogle: false, privacyMode: core.DEFAULT_PRIVACY_MODE, path: profileDir() }
        record = { ...record, revision: record.revision + 1, profiles: [...record.profiles, current] }
        core.validateProfilesRecord(record)
        await writeJson(profilesPath(), record)
      }
      return { record, currentId: current.id }
    }
    function newId(record) {
      let id
      const random = Cc['@mozilla.org/security/random-generator;1'].getService(Ci.nsIRandomGenerator)
      do { id = `p-${random.generateRandomBytes(8).map(byte => byte.toString(16).padStart(2, '0')).join('')}` }
      while (record.profiles.some(profile => profile.id === id))
      return id
    }
    const avatarPath = (id, digest) => PathUtils.join(profilesRoot(), 'kitsune-avatars', id, `${digest}.png`)
    async function storeAvatar(id, data) {
      const source = decodeDataUrl(data, { maxBytes: 1536 * 1024, tooBig: 'La foto es demasiado grande. Elige una imagen de hasta 1,5 MB.',
        wrongType: 'Elige una foto PNG, JPEG o WebP.', unreadable: 'No se ha podido leer la foto.' })
      const image = decodeImage(source, { maxSide: 8192, maxPixels: 16_000_000, unreadable: 'No se ha podido leer la foto.' })
      // Cuadrada y centrada, 256 px, PNG nuevo: sin EXIF ni nada del original.
      const side = Math.min(image.width, image.height)
      const square = imgTools().decodeImageFromArrayBuffer(streamBytes(imgTools().encodeCroppedImage(image, 'image/png',
        Math.floor((image.width - side) / 2), Math.floor((image.height - side) / 2), side, side, '')).buffer, 'image/png')
      const png = streamBytes(imgTools().encodeScaledImage(square, 'image/png', 256, 256, ''))
      if (png.length > MAX_AVATAR_PNG) throw new HomeError(400, 'No se ha podido leer la foto.')
      const digest = sha256(png)
      await writeAtomic(avatarPath(id, digest), png)
      return digest
    }
    const discardAvatar = (id, digest) => digest ? IOUtils.remove(avatarPath(id, digest)).catch(() => {}) : null
    async function writePrivacy(path, mode) {
      const userJs = PathUtils.join(path, 'user.js')
      let text = ''
      try { text = await readText(userJs, 512 * 1024) } catch (error) { if (error.name !== 'NotFoundError') throw error }
      const next = core.withProfileBlock(text, mode)
      if (next !== text) await writeAtomic(userJs, core.encodeText(next))
    }
    const profileService = () => Cc['@mozilla.org/toolkit/profile-service;1'].getService(Ci.nsIToolkitProfileService)
    async function createGeckoProfile(id) {
      const service = profileService()
      const profile = service.createUniqueProfile(null, `kitsune-${id}`, 'kitsune-home')
      if (service.asyncFlush) await service.asyncFlush()
      else service.flush()
      return profile.rootDir.path
    }
    function launch(profile, action, isCurrent) {
      const url = core.ACTIONS[action]
      const window = Services.wm.getMostRecentWindow('navigator:browser')
      if (isCurrent && window) {
        // Este mismo perfil: una pestaña (o una ventana nueva para el inicio) aquí mismo.
        if (url) window.openTrustedLinkIn(url, 'tab')
        else window.OpenBrowserWindow()
        return
      }
      // Otro perfil: otra instancia de Kitsune con ese perfil; si ya está abierta, Gecko le pasa la orden.
      const process = Cc['@mozilla.org/process/util;1'].createInstance(Ci.nsIProcess)
      process.init(Services.dirsvc.get('XREExeF', Ci.nsIFile))
      const args = ['--profile', profile.path, ...(url ? [url] : [])]
      process.runw(false, args, args.length)
    }

    async function profileMutation(method, path, value) {
      const match = /^\/api\/profiles\/(default|p-[0-9a-f]{16})(?:\/(open|default))?$/.exec(path)
      if (path !== '/api/profiles' && !match) throw new HomeError(405, 'Método no permitido.')
      const action = path === '/api/profiles' ? 'create' : (match[2] ?? 'edit')
      if ((method === 'PATCH') !== (action === 'edit')) throw new HomeError(405, 'Método no permitido.')
      const { record, currentId } = await loadProfiles()
      const snapshot = next => core.profilesSnapshot(next, currentId)
      if (action === 'open') {
        if (value === null || typeof value !== 'object' || Array.isArray(value) ||
            Object.keys(value).some(key => !['action', 'revision'].includes(key)) || !Object.hasOwn(value, 'action')) {
          throw new HomeError(400, 'La solicitud de apertura no es válida.')
        }
        if (typeof value.action !== 'string' || !Object.hasOwn(core.ACTIONS, value.action)) throw new HomeError(400, 'La acción del perfil no es válida.')
        if (Object.hasOwn(value, 'revision')) core.checkProfilesRevision(record, value.revision, currentId)
        const profile = core.findProfile(record, match[1])
        const next = core.clone(record)
        next.profiles.find(item => item.id === profile.id).lastUsed = now()
        next.revision++
        await writeJson(profilesPath(), next)
        try { launch(profile, value.action, profile.id === currentId) } catch {
          await writeJson(profilesPath(), record)
          throw new HomeError(503, 'No se ha podido abrir el perfil. Sus datos siguen guardados.')
        }
        return { ...snapshot(next), openedId: profile.id, launchRequested: true }
      }
      if (action === 'default') {
        if (value === null || typeof value !== 'object' || Object.keys(value).join() !== 'revision') throw new HomeError(400, 'La solicitud del perfil no es válida.')
        core.checkProfilesRevision(record, value.revision, currentId)
        core.findProfile(record, match[1])
        const next = { ...core.clone(record), defaultId: match[1], revision: record.revision + 1 }
        await writeJson(profilesPath(), next)
        // El perfil con el que se abre Kitsune también es el predeterminado de Gecko.
        try {
          const target = next.profiles.find(item => item.id === match[1])
          for (const profile of profileService().profiles) {
            if (samePath(profile.rootDir.path, target.path)) { profileService().defaultProfile = profile; break }
          }
          if (profileService().asyncFlush) await profileService().asyncFlush()
        } catch { /* el registro de Kitsune ya está guardado */ }
        return snapshot(next)
      }
      const body = core.parseProfileBody(value)
      core.checkProfilesRevision(record, body.revision, currentId)
      const next = core.clone(record)
      if (action === 'create') {
        if (next.profiles.length >= core.MAX_PROFILES) throw new HomeError(400, `Se permiten hasta ${core.MAX_PROFILES} perfiles locales.`)
        const id = newId(next)
        const mode = core.isOmitted(body.privacyMode) ? core.DEFAULT_PRIVACY_MODE : body.privacyMode
        const geckoPath = await createGeckoProfile(id)
        await writePrivacy(geckoPath, mode)
        const avatarHash = core.isOmitted(body.avatarData) || body.avatarData === null ? null : await storeAvatar(id, body.avatarData)
        next.profiles.push({ id, name: body.name, email: body.email, color: body.color, createdAt: now(), lastUsed: '',
          avatarHash, rememberGoogle: core.isOmitted(body.rememberGoogle) ? false : body.rememberGoogle, privacyMode: mode, path: geckoPath })
        next.revision++
        core.validateProfilesRecord(next)
        try { await writeJson(profilesPath(), next) } catch (error) { await discardAvatar(id, avatarHash); throw error }
        return { ...snapshot(next), createdId: id }
      }
      const profile = next.profiles.find(item => item.id === core.findProfile(record, match[1]).id)
      const oldHash = profile.avatarHash
      Object.assign(profile, { name: body.name, email: body.email, color: body.color })
      if (!core.isOmitted(body.avatarData)) profile.avatarHash = body.avatarData === null ? null : await storeAvatar(profile.id, body.avatarData)
      if (!core.isOmitted(body.rememberGoogle)) profile.rememberGoogle = body.rememberGoogle
      if (!core.isOmitted(body.privacyMode)) {
        profile.privacyMode = body.privacyMode
        await writePrivacy(profile.path, body.privacyMode)
      }
      next.revision++
      core.validateProfilesRecord(next)
      try { await writeJson(profilesPath(), next) } catch (error) {
        if (profile.avatarHash !== oldHash) await discardAvatar(profile.id, profile.avatarHash)
        throw error
      }
      if (profile.avatarHash !== oldHash) await discardAvatar(profile.id, oldHash)
      return snapshot(next)
    }

    async function memory() {
      const info = await ChromeUtils.requestProcInfo()
      const total = info.memory + info.children.reduce((sum, child) => sum + (child.memory || 0), 0)
      return { memoryMB: Math.round(total / 1048576), processes: 1 + info.children.length }
    }

    async function storeBackground(value) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new HomeError(400, 'La solicitud del fondo no es válida.')
      if (Object.keys(value).join() === 'preset') throw new HomeError(400, 'Ese fondo de serie no está disponible.')
      if (Object.keys(value).join() !== 'imageData') throw new HomeError(400, 'La solicitud del fondo no es válida.')
      const source = decodeDataUrl(value.imageData, { maxBytes: 12 * 1024 * 1024, tooBig: 'La imagen es demasiado grande. Elige una de hasta 12 MB.',
        wrongType: 'Elige una imagen PNG, JPEG o WebP.', unreadable: 'No se ha podido leer la imagen.' })
      const image = decodeImage(source, { maxSide: 12000, maxPixels: 50_000_000, unreadable: 'No se ha podido leer la imagen.' })
      const scale = Math.min(1, BACKGROUND_BOX[0] / image.width, BACKGROUND_BOX[1] / image.height)
      const jpeg = streamBytes(imgTools().encodeScaledImage(image, 'image/jpeg', Math.max(1, Math.round(image.width * scale)),
        Math.max(1, Math.round(image.height * scale)), 'quality=88'))
      if (!jpeg.length || jpeg.length > MAX_BACKGROUND_JPEG) throw new HomeError(400, 'No se ha podido leer la imagen.')
      const digest = sha256(jpeg)
      await writeAtomic(backgroundPath(digest), jpeg)
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const current = await readSettings()
          const result = core.updateSettings(current, { ...current.data, background: digest }, current.revision, digest)
          if (result.updated) {
            await writeJson(settingsPath(), result.record)
            return result.record
          }
        }
        throw new HomeError(503, 'No se ha podido guardar el fondo. Tus ajustes siguen como estaban.')
      } finally {
        await pruneBackgrounds((await readSettings().catch(() => null))?.data.background ?? null)
      }
    }

    const json = (status, body) => ({ status, body: JSON.stringify(body) })
    const bytes = (data, contentType) => ({ status: 200, contentType, bytes: data.buffer.slice(data.byteOffset, data.byteOffset + data.length) })

    async function handle(method, path, text) {
      let value = null
      if (text !== null && text !== undefined) {
        if (typeof text !== 'string' || text.length > 17 * 1024 * 1024) throw new HomeError(413, 'La solicitud es demasiado grande.')
        try { value = JSON.parse(text) } catch { throw new HomeError(400, 'JSON no válido.') }
      }
      if (method === 'GET' && path === '/api/settings') return json(200, { ...(await readSettings()), token: TOKEN })
      if (method === 'PUT' && path === '/api/settings') {
        if (value === null || typeof value !== 'object' || Object.keys(value).sort().join() !== 'data,revision') {
          throw new HomeError(400, 'La estructura de la solicitud no es válida.')
        }
        let task
        ;[task, settingsQueue] = serial(settingsQueue, async () => {
          const current = await readSettings()
          const result = core.updateSettings(current, value.data, value.revision)
          if (!result.updated) return json(409, { ...current, token: TOKEN, error: 'Los ajustes han cambiado en otra pestaña.' })
          await writeJson(settingsPath(), result.record)
          if (result.record.data.background !== current.data.background) await pruneBackgrounds(result.record.data.background)
          const reply = { ...result.record, token: TOKEN }
          try { reply.appearance = await refreshAppearance(result.record.data) } catch {
            reply.warning = 'Los ajustes están guardados; la apariencia nativa se aplicará cuando esté disponible.'
          }
          return json(200, reply)
        })
        return task
      }
      if (method === 'GET' && path === '/api/appearance') return json(200, await refreshAppearance((await readSettings()).data))
      if (method === 'POST' && path === '/api/background') {
        let task
        ;[task, settingsQueue] = serial(settingsQueue, async () => {
          const record = await storeBackground(value)
          const reply = { ...record, token: TOKEN }
          try { reply.appearance = await refreshAppearance(record.data) } catch {
            reply.warning = 'El fondo está guardado; el navegador lo aplicará cuando esté disponible.'
          }
          return json(200, reply)
        })
        return task
      }
      const background = /^\/api\/background\/([0-9a-f]{64})\.jpg$/.exec(path)
      if (method === 'GET' && background) {
        if ((await readSettings()).data.background !== background[1]) throw new HomeError(404, 'El fondo no está disponible.')
        try { return bytes(await readFile(backgroundPath(background[1]), MAX_BACKGROUND_JPEG), 'image/jpeg') } catch {
          throw new HomeError(404, 'El fondo no está disponible.')
        }
      }
      if (method === 'GET' && path === '/api/wallpapers') return json(200, { categories: [] })
      if (method === 'GET' && path === '/api/rendimiento') return json(200, await memory())
      if (method === 'GET' && path === '/api/profiles') {
        const { record, currentId } = await loadProfiles()
        return json(200, { ...core.profilesSnapshot(record, currentId), token: TOKEN })
      }
      const avatar = /^\/api\/profile-avatars\/(default|p-[0-9a-f]{16})\/([0-9a-f]{64})\.png$/.exec(path)
      if (method === 'GET' && avatar) {
        const { record } = await loadProfiles()
        const profile = core.findProfile(record, avatar[1])
        if (profile.avatarHash !== avatar[2]) throw new HomeError(404, 'La foto del perfil no está disponible.')
        const data = await readFile(avatarPath(avatar[1], avatar[2]), MAX_AVATAR_PNG).catch(() => null)
        if (!data || sha256(data) !== avatar[2]) throw new HomeError(404, 'La foto del perfil no está disponible.')
        return bytes(data, 'image/png')
      }
      if ((method === 'POST' || method === 'PATCH') && path.startsWith('/api/profiles')) {
        let task
        ;[task, profilesQueue] = serial(profilesQueue, async () => json(200, { ...(await profileMutation(method, path, value)), token: TOKEN }))
        return task
      }
      throw new HomeError(404, 'Recurso no encontrado.')
    }

    return {
      kitsuneHome: {
        async request(method, path, body) {
          try {
            if (typeof method !== 'string' || typeof path !== 'string' || !path.startsWith('/api/') || path.length > 256) {
              throw new HomeError(404, 'Recurso no encontrado.')
            }
            return await handle(method.toUpperCase(), path.split('?')[0], body)
          } catch (error) {
            if (error instanceof HomeError) {
              const extra = error.status === 409 ? { ...error.extra, token: TOKEN } : {}
              return json(error.status, { ...extra, error: error.message })
            }
            // Sin rutas, datos ni detalles del perfil en el registro del navegador.
            Services.console.logStringMessage(`Kitsune: el inicio integrado no ha podido completar una operación (${error?.name ?? 'Error'}).`)
            return json(503, { error: 'No se ha podido completar la operación local. Tus datos siguen guardados.' })
          }
        },
      },
    }
  }
}

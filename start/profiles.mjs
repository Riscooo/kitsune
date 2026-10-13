/** Usuarios de Kitsune en la misma ventana (no son cuentas en línea): cada uno tiene sus
 * sesiones y cookies en su contenedor; el base (baseId) es el del perfil y el dueño de la
 * privacidad de todo Kitsune. Cada cambio lo confirma el servicio local antes de verse aquí. */
import { paintAvatar, prepareAvatar } from './avatar.mjs'
export const PROFILE_COLORS = Object.freeze(['blue', 'pink', 'violet', 'teal', 'amber', 'red'])
const BAD_TEXT = /[\p{Cc}\p{Cs}]/u

export function profileInitials(name) {
  const words = String(name || '').trim().split(/\s+/u).filter(Boolean)
  if (!words.length) return 'K'
  const first = [...words[0]][0] || ''
  const last = words.length > 1 ? [...words.at(-1)][0] : ''
  return (first + last).toLocaleUpperCase('es').slice(0, 6)
}

export function validateProfileDraft(value) {
  const name = typeof value?.name === 'string' ? value.name.trim() : ''
  const email = typeof value?.email === 'string' ? value.email.trim() : ''
  if (!name || [...name].length > 48 || BAD_TEXT.test(name)) throw new Error('Ponle un nombre de entre 1 y 48 caracteres, sin caracteres de control.')
  if ([...email].length > 254 || /\s/u.test(email) || BAD_TEXT.test(email) || (email && !/^[^@]+@[^@]+\.[^@]+$/u.test(email))) throw new Error('Escribe un correo válido, sin espacios, o deja la etiqueta vacía.')
  if (!PROFILE_COLORS.includes(value?.color)) throw new Error('Elige uno de los seis colores del perfil.')
  return { name, email, color: value.color }
}

export function parseProfilesSnapshot(value) {
  if (!value || value.version !== 1 || typeof value.currentId !== 'string' || typeof value.defaultId !== 'string' || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.token !== 'string' || !value.token || !Array.isArray(value.profiles) || value.profiles.length < 1 || value.profiles.length > 24) throw new Error('Invalid profiles response')
  const ids = new Set()
  for (const item of value.profiles) {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/u.test(item.id) || ids.has(item.id) || typeof item.name !== 'string' || !item.name.trim() || [...item.name].length > 48 || BAD_TEXT.test(item.name) || typeof item.email !== 'string' || [...item.email].length > 254 || BAD_TEXT.test(item.email) || !PROFILE_COLORS.includes(item.color) || (item.privacyMode !== undefined && !Object.hasOwn(PRIVACY_MODES, item.privacyMode))) throw new Error('Invalid profile in response')
    ids.add(item.id)
  }
  if (!ids.has(value.currentId) || !ids.has(value.defaultId)) throw new Error('Invalid current/default profile')
  return value
}

export const PRIVACY_MODES = Object.freeze({ estricto: 'Estricto', comodo: 'Cómodo' })

// Lo que supone pasar a cada modo, en una frase (ventana de confirmación).
export const PRIVACY_EFFECTS = Object.freeze({
  comodo: 'Seguirás con tus cuentas abiertas al volver, pero las webs podrán reconocerte entre visitas.',
  estricto: 'Al cerrar Kitsune se cerrarán tus sesiones: tendrás que volver a entrar en tus cuentas. Alguna web puede fallar.',
})

export function privacyMode(profile) {
  return Object.hasOwn(PRIVACY_MODES, profile?.privacyMode) ? profile.privacyMode : 'estricto'
}

// The mode applies when the engine starts; the native acknowledgement reports the active one.
export function privacyModeStatus(profile, isCurrent, appearance) {
  const mode = privacyMode(profile)
  const label = `Privacidad: ${PRIVACY_MODES[mode]}`
  if (!isCurrent) return `${label} · se aplica al abrir este perfil`
  const active = appearance?.native?.status === 'applied' ? appearance.native.privacyMode : undefined
  if (!Object.hasOwn(PRIVACY_MODES, active ?? '')) return label
  return active === mode ? `${label} · activo` : `${label} · se aplicará al reiniciar Kitsune`
}

export function googleRetentionStatus(appearance, desired) {
  if (typeof desired !== 'boolean' || appearance?.googleRemember !== desired || appearance.native?.status !== 'applied') return null
  const native = appearance.native
  if (desired) return native.googleRemember === true ? 'Se conservará la sesión de Google en este perfil.' : null
  if (native.googlePolicyManaged !== false) return null
  return native.googleRemember === true
    ? 'Kitsune no gestiona esta excepción; Google se conserva por tus ajustes de privacidad.'
    : 'Sin una excepción de Google gestionada por Kitsune.'
}

export async function initializeProfiles({ announce = () => {}, onSnapshot = () => {}, switchTo = async () => false } = {}) {
  const $ = selector => document.querySelector(selector)
  const dialog = $('#profiles-dialog')
  if (!dialog) return
  const trigger = $('#profiles-open')
  let snapshot = null
  let selectedId = null
  let ready = false
  let busy = false
  let formMode = null
  let formId = null
  let color = 'blue'
  let returnFocus = trigger
  let operationId = 0
  let photoData
  let originalPhoto = null
  let photoBusy = false
  let photoRequest = 0
  let googleRequest = 0
  let googleTimer

  const selectedProfile = () => snapshot?.profiles.find(item => item.id === selectedId)
  // El usuario del perfil de Gecko: el suyo es el modo de privacidad de todo Kitsune.
  const baseId = () => snapshot?.baseId ?? snapshot?.currentId
  const isBase = profile => Boolean(profile) && profile.id === baseId()
  const icon = name => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    use.setAttribute('href', `#i-${name}`)
    svg.setAttribute('aria-hidden', 'true')
    svg.append(use)
    return svg
  }
  const avatar = (node, profile, draft) => paintAvatar(node, profile, profileInitials(profile.name), draft)
  let formPrivacy = 'estricto'

  /** Ventana breve con lo que hace cada modo y lo que supone el cambio. */
  function confirmPrivacy(to) {
    const popup = $('#privacy-dialog')
    if (!popup) return Promise.resolve(true)
    $('#privacy-dialog-title').textContent = `¿Pasar a ${PRIVACY_MODES[to]}?`
    $('#privacy-dialog-effect').textContent = PRIVACY_EFFECTS[to]
    popup.querySelectorAll('.privacy-card').forEach(card => { card.dataset.target = String(card.dataset.mode === to) })
    popup.returnValue = ''
    return new Promise(resolve => {
      popup.addEventListener('close', () => resolve(popup.returnValue === 'accept'), { once: true })
      popup.showModal()
      $('#privacy-cancel').focus()
    })
  }

  function photoMessage(message = 'PNG, JPG o WebP · hasta 8 MB', error = false) {
    const status = $('#profile-photo-status'), problem = $('#profile-photo-error')
    if (status) status.textContent = error ? '' : message
    if (problem) { problem.textContent = error ? message : ''; problem.hidden = !error }
  }

  function cancelPhoto() {
    photoRequest++
    if (photoBusy) photoMessage('Selección cancelada. Puedes volver a elegir una foto.')
    photoBusy = false
    if ($('#profile-photo')) $('#profile-photo').value = ''
    renderControls()
  }

  function updateGoogleStatus() {
    clearTimeout(googleTimer)
    const request = ++googleRequest
    const status = $('#profile-google-status')
    const profile = selectedProfile()
    if (!status || !profile || !dialog.open || formMode) return
    const privacy = $('#profile-privacy-status')
    const relogin = $('#profile-google-relogin')
    // La privacidad y Google son de todo Kitsune: solo en la ficha del usuario base.
    status.hidden = !isBase(profile)
    if (privacy) privacy.hidden = !isBase(profile)
    if (!isBase(profile)) { if (relogin) relogin.hidden = true; return }
    if (privacy) privacy.textContent = privacyModeStatus(profile, true)
    const desired = profile.rememberGoogle === true
    const comfortable = privacyMode(profile) === 'comodo'
    if (relogin) relogin.hidden = comfortable
    if (comfortable) {
      // En Cómodo no hay nada que aplicar para Google: solo se sigue el modo activo.
      status.textContent = 'En modo Cómodo las sesiones ya se conservan al cerrar.'
    } else if (!isBase(profile)) {
      status.textContent = desired ? 'Abre este perfil para aplicar la conservación de Google.' : 'Sin conservación de Google activada en Kitsune.'
      return
    } else {
      status.textContent = 'Aplicando…'
    }
    const started = performance.now()
    const check = async () => {
      try {
        const response = await fetch('/api/appearance', { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(4000) })
        if (!response.ok) throw new Error('Native state unavailable')
        const appearance = await response.json()
        if (request !== googleRequest || !dialog.open || formMode) return
        if (privacy) privacy.textContent = privacyModeStatus(profile, true, appearance)
        if (privacyMode(profile) === 'comodo') return
        const confirmed = googleRetentionStatus(appearance, desired)
        if (confirmed) {
          status.textContent = confirmed
          return
        }
      } catch { /* Keep pending until a native acknowledgement is available. */ }
      if (request !== googleRequest || !dialog.open || formMode || comfortable) return
      if (performance.now() - started >= 10_000) {
        status.textContent = 'Pendiente de aplicar. Abre o reinicia este perfil para completarlo.'
        return
      }
      googleTimer = setTimeout(check, 1000)
    }
    void check()
  }

  function notice(message = '', reload = false) {
    $('#profiles-message').textContent = message
    $('#profiles-notice').hidden = !message
    $('#profiles-reload').hidden = !reload
  }

  function setBusy(value, message = '') {
    busy = value
    dialog.setAttribute('aria-busy', String(value || photoBusy))
    $('#profiles-operation').textContent = message
    renderControls()
  }

  function renderControls() {
    const blocked = busy || !ready
    dialog.querySelectorAll('[data-privacy-switch]').forEach(button => { button.disabled = blocked })
    dialog.setAttribute('aria-busy', String(busy || photoBusy))
    $('#profile-create').disabled = blocked || Boolean(formMode) || snapshot?.profiles.length >= 24
    $('#profile-create').title = snapshot?.profiles.length >= 24 ? 'Has llegado al límite de 24 usuarios.' : ''
    $('#profile-save').disabled = blocked || photoBusy
    $('#profile-cancel').disabled = busy
    $('#profile-name').disabled = busy
    $('#profile-email').disabled = busy
    $('#profiles-reload').disabled = busy
    $('#profile-edit').disabled = blocked
    $('#profile-open').disabled = blocked
    dialog.querySelectorAll('[data-profile-id]').forEach(button => { button.disabled = blocked || Boolean(formMode) })
    dialog.querySelectorAll('[data-profile-action]').forEach(button => { button.disabled = blocked })
    dialog.querySelectorAll('[data-profile-swatch]').forEach(button => { button.disabled = busy })
    if ($('#profile-photo')) $('#profile-photo').disabled = busy
    if ($('#profile-photo-remove')) $('#profile-photo-remove').disabled = busy || !(photoData === undefined ? originalPhoto : photoData)
    dialog.querySelectorAll('input[name="profile-privacy"]').forEach(input => { input.disabled = busy })
    updatePrivacyForm()
  }

  function selectedPrivacy() {
    return dialog.querySelector('input[name="profile-privacy"]:checked')?.value === 'comodo' ? 'comodo' : 'estricto'
  }

  function updatePrivacyForm() {
    const remember = $('#profile-remember-google')
    if (!remember) return
    const comfortable = selectedPrivacy() === 'comodo'
    remember.disabled = busy || comfortable
    const help = $('#profile-remember-google-help')
    if (help) help.textContent = comfortable ? 'En modo Cómodo las sesiones ya se conservan.' : 'Conservar Google al cerrar; no inicia sesión.'
  }

  function renderList() {
    const list = $('#profiles-list')
    const focusedId = document.activeElement?.dataset.profileId
    list.replaceChildren()
    for (const profile of snapshot?.profiles || []) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'profile-list-item'
      button.dataset.profileId = profile.id
      button.setAttribute('aria-pressed', String(profile.id === selectedId))
      const glyph = document.createElement('span')
      glyph.className = 'profile-avatar'
      glyph.setAttribute('aria-hidden', 'true')
      avatar(glyph, profile)
      const copy = document.createElement('span')
      copy.className = 'profile-list-copy'
      const name = document.createElement('b')
      name.textContent = profile.name
      const hint = document.createElement('small')
      hint.textContent = profile.id === snapshot.currentId ? 'Esta pestaña' : isBase(profile) ? 'Principal' : 'Usuario'
      copy.append(name, hint)
      button.append(glyph, copy)
      button.addEventListener('click', () => {
        if (busy || formMode || !ready) return
        selectedId = profile.id
        notice()
        $('#profiles-operation').textContent = ''
        render()
      })
      list.append(button)
    }
    $('#profiles-count').textContent = snapshot ? `${snapshot.profiles.length} / 24` : '—'
    if (focusedId && !formMode) [...list.children].find(button => button.dataset.profileId === focusedId)?.focus({ preventScroll: true })
  }

  function render() {
    dialog.dataset.view = formMode ? 'form' : 'detail'
    const current = snapshot?.profiles.find(profile => profile.id === snapshot.currentId)
    if (current) {
      avatar($('#current-profile-avatar'), current)
      $('#current-profile-name').textContent = current.name
      $('#welcome-line').textContent = `Bienvenido, ${current.name}`
      trigger.setAttribute('aria-label', `Usuarios. Esta pestaña es de ${current.name}`)
      trigger.title = `Esta pestaña es de ${current.name}`
    }
    renderList()
    const profile = selectedProfile()
    $('#profiles-empty').hidden = Boolean(profile || formMode)
    $('#profile-detail').hidden = !profile || Boolean(formMode)
    $('#profile-form').hidden = !formMode
    if (profile && !formMode) {
      avatar($('#profile-detail-avatar'), profile)
      $('#profile-detail-name').textContent = profile.name
      $('#profile-detail-email').textContent = profile.email
      $('#profile-detail-email').hidden = !profile.email
      $('#profile-current-badge').hidden = profile.id !== snapshot.currentId
      $('#profile-default-badge').hidden = !isBase(profile)
      // Cambiar: esta misma pestaña pasa a ser la de ese usuario.
      $('#profile-open').hidden = profile.id === snapshot.currentId
      $('#profile-open span').textContent = 'Cambiar a este usuario'
      dialog.querySelector('.privacy-switch').hidden = !isBase(profile)
      // Google se abre en una pestaña de este usuario: solo desde la suya.
      dialog.querySelector('[data-profile-action="google"]').hidden = profile.id !== snapshot.currentId
      dialog.querySelectorAll('[data-privacy-switch]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.privacySwitch === privacyMode(profile))))
    }
    renderControls()
    updateGoogleStatus()
  }

  function accept(value) {
    snapshot = parseProfilesSnapshot(value)
    if (!snapshot.profiles.some(profile => profile.id === selectedId)) selectedId = snapshot.currentId
    ready = true
    onSnapshot(snapshot)
  }

  async function load({ quiet = false } = {}) {
    if (busy) return
    if (location.protocol === 'file:') {
      ready = false
      notice('Abre el inicio completo de Kitsune para gestionar los usuarios de este equipo.')
      $('#profiles-empty-copy').textContent = 'Los usuarios no están disponibles en la copia de emergencia del inicio.'
      return
    }
    setBusy(true, quiet ? '' : 'Actualizando tus usuarios…')
    try {
      const response = await fetch('/api/profiles', { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(5000) })
      if (!response.ok) throw new Error('Profiles unavailable')
      accept(await response.json())
      notice()
      render()
    } catch {
      ready = false
      if (!quiet || dialog.open) notice('No se ha podido conectar con los usuarios. Tu navegación sigue funcionando.', true)
      $('#profiles-empty-copy').textContent = 'No hemos podido cargar tus usuarios.'
    } finally {
      setBusy(false)
      document.documentElement.dataset.profilesReady = ready ? 'true' : 'false'
    }
  }

  async function mutate(path, method, data, pending) {
    if (busy || !ready) return null
    setBusy(true, pending)
    notice()
    const requestId = ++operationId
    try {
      const response = await fetch(path, {
        method, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json', 'X-Kitsune-Token': snapshot.token },
        body: JSON.stringify({ ...data, revision: snapshot.revision }),
      })
      if (response.status === 409) {
        accept(await response.json())
        render()
        notice(formMode ? 'Otra pestaña ha cambiado los usuarios. Tu borrador se conserva; revísalo y guarda de nuevo.' : 'La lista ha cambiado. Revisa el usuario y vuelve a intentarlo.')
        return null
      }
      if (!response.ok) {
        // The result of a failed/timed-out mutation is uncertain. Refresh the
        // registry before offering a retry; never duplicate a create blindly.
        if ([400, 413, 422].includes(response.status)) {
          notice('No se han guardado los cambios. Revisa los datos o elige otra foto.', true)
          return null
        }
        throw new Error('Profile mutation not confirmed')
      }
      const result = await response.json()
      accept(result)
      render()
      return result
    } catch {
      ready = false
      notice('No se ha confirmado el guardado. Actualiza la lista; tu borrador se conserva.', true)
      return null
    } finally {
      if (requestId === operationId) setBusy(false)
    }
  }

  function preview() {
    avatar($('#profile-preview-avatar'), { id: formId, name: $('#profile-name').value || 'Nuevo usuario', color, avatar: originalPhoto }, photoData)
    dialog.querySelectorAll('[data-profile-swatch]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.profileSwatch === color)))
  }

  function showForm(profile = null) {
    if (busy || !ready) return
    cancelPhoto()
    formMode = profile ? 'edit' : 'create'
    formId = profile?.id || null
    color = profile?.color || PROFILE_COLORS[(snapshot?.profiles.length || 0) % PROFILE_COLORS.length]
    photoData = undefined
    originalPhoto = profile?.avatar || null
    photoMessage()
    if ($('#profile-remember-google')) $('#profile-remember-google').checked = profile?.rememberGoogle === true
    // Privacidad y Google, solo al editar el usuario base (son de todo Kitsune).
    dialog.querySelector('.profile-privacy').hidden = !isBase(profile)
    if ($('#profile-remember-google')) $('#profile-remember-google').closest('label').hidden = !isBase(profile)
    const mode = privacyMode(profile)
    formPrivacy = mode
    dialog.querySelectorAll('input[name="profile-privacy"]').forEach(input => { input.checked = input.value === mode })
    updatePrivacyForm()
    $('#profile-name').value = profile?.name || ''
    $('#profile-email').value = profile?.email || ''
    $('#profile-form-title').textContent = profile ? 'Editar usuario' : 'Nuevo usuario'
    $('#profile-save span').textContent = profile ? 'Guardar cambios' : 'Crear usuario'
    $('#profile-form-note').textContent = profile ? 'Sus sesiones no cambian.' : 'Con sus propias sesiones y cookies. Historial, marcadores y contraseñas son comunes.'
    $('#profile-form-error').hidden = true
    notice()
    $('#profiles-operation').textContent = ''
    preview(); render()
    $('#profile-name').focus()
  }

  /** Abre la gestión de usuarios (con el formulario de uno nuevo, si se pide). */
  function show({ create = false } = {}) {
    returnFocus = trigger
    if (!dialog.open) dialog.showModal()
    $('#profiles-title').focus({ preventScroll: true })
    void load().then(() => { if (create && ready) showForm() })
  }
  dialog.addEventListener('close', () => {
    cancelPhoto()
    clearTimeout(googleTimer)
    googleRequest++
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
    else trigger.focus({ preventScroll: true })
  })
  $('#profiles-reload').addEventListener('click', () => void load())
  $('#profile-create').addEventListener('click', () => showForm())
  $('#profile-edit').addEventListener('click', () => showForm(selectedProfile()))
  $('#profile-cancel').addEventListener('click', () => {
    if (busy) return
    cancelPhoto()
    formMode = null
    formId = null
    photoData = undefined
    originalPhoto = null
    $('#profile-form-error').hidden = true
    render()
    $('#profile-edit').focus()
  })
  $('#profile-name').addEventListener('input', preview)
  // Al editar un perfil, cambiar de modo también pide confirmación; Cancelar lo deja como estaba.
  dialog.querySelectorAll('input[name="profile-privacy"]').forEach(input => input.addEventListener('change', async () => {
    const to = selectedPrivacy()
    if (formMode === 'edit' && to !== formPrivacy && !(await confirmPrivacy(to))) {
      dialog.querySelectorAll('input[name="profile-privacy"]').forEach(other => { other.checked = other.value === formPrivacy })
    } else {
      formPrivacy = to
    }
    updatePrivacyForm()
  }))
  // Cambio directo desde la ficha del perfil, sin entrar en Editar.
  dialog.querySelectorAll('[data-privacy-switch]').forEach(button => button.addEventListener('click', async () => {
    const profile = selectedProfile()
    const to = button.dataset.privacySwitch
    if (!profile || busy || !ready || to === privacyMode(profile) || !(await confirmPrivacy(to))) return
    const result = await mutate(`/api/profiles/${encodeURIComponent(profile.id)}`, 'PATCH',
      { name: profile.name, email: profile.email || '', color: profile.color, privacyMode: to }, `Pasando a ${PRIVACY_MODES[to]}…`)
    if (!result) return
    $('#profiles-operation').textContent = profile.id === snapshot.currentId
      ? `${profile.name}: modo ${PRIVACY_MODES[to]}. Se aplica al volver a abrir Kitsune.`
      : `${profile.name}: modo ${PRIVACY_MODES[to]}. Se aplica al abrir este perfil.`
    dialog.querySelector(`[data-privacy-switch="${to}"]`)?.focus({ preventScroll: true })
  }))
  $('#profile-photo')?.addEventListener('change', async event => {
    const file = event.target.files?.[0]
    if (!file || busy || !formMode || !dialog.open) return
    const request = ++photoRequest
    photoBusy = true
    photoMessage('Preparando foto…')
    renderControls()
    try {
      const data = await prepareAvatar(file)
      if (request !== photoRequest || !dialog.open || !formMode) return
      photoData = data
      preview()
      photoMessage('Lista para guardar.')
    } catch (error) {
      if (request === photoRequest && dialog.open && formMode) photoMessage(error.message, true)
    } finally {
      if (request === photoRequest) { photoBusy = false; event.target.value = ''; renderControls() }
    }
  })
  $('#profile-photo-remove')?.addEventListener('click', () => {
    if (busy || !formMode) return
    cancelPhoto()
    photoData = null
    preview()
    photoMessage('La foto se quitará al guardar.')
    renderControls()
  })
  for (const input of ['#profile-name', '#profile-email']) $(input).addEventListener('input', () => { $('#profile-form-error').hidden = true })
  dialog.querySelectorAll('[data-profile-swatch]').forEach(button => button.addEventListener('click', () => {
    if (busy) return
    color = button.dataset.profileSwatch
    preview()
  }))
  $('#profile-form').addEventListener('submit', async event => {
    event.preventDefault()
    if (busy || photoBusy || !ready || !formMode) return
    $('#profile-form-error').hidden = true
    let draft
    try { draft = validateProfileDraft({ name: $('#profile-name').value, email: $('#profile-email').value, color }) }
    catch (error) {
      $('#profile-form-error').textContent = error.message
      $('#profile-form-error').hidden = false
      return
    }
    const creating = formMode === 'create'
    if (photoData !== undefined) draft.avatarData = photoData
    if (!creating && formId === baseId()) {
      if ($('#profile-remember-google')) draft.rememberGoogle = $('#profile-remember-google').checked
      if (dialog.querySelector('input[name="profile-privacy"]')) draft.privacyMode = selectedPrivacy()
    }
    const result = await mutate(creating ? '/api/profiles' : `/api/profiles/${encodeURIComponent(formId)}`, creating ? 'POST' : 'PATCH', draft, creating ? 'Creando tu nuevo espacio…' : 'Guardando los detalles…')
    if (!result) return
    selectedId = creating ? result.createdId : formId
    if (!snapshot.profiles.some(profile => profile.id === selectedId)) selectedId = snapshot.currentId
    formMode = null
    formId = null
    photoData = undefined
    originalPhoto = null
    cancelPhoto()
    render()
    $('#profiles-operation').textContent = creating ? 'Usuario creado. Cámbiate a él cuando quieras.' : 'Detalles guardados en este equipo.'
    if (dialog.open) $('#profile-detail-name').focus({ preventScroll: true })
    else announce(creating ? 'Usuario creado.' : 'Usuario actualizado.')
  })
  // Cambiar de usuario: esta pestaña pasa a ser el inicio del otro (las demás no se tocan).
  $('#profile-open').addEventListener('click', async () => {
    const profile = selectedProfile()
    if (!profile || busy || !ready || profile.id === snapshot.currentId) return
    setBusy(true, `Cambiando a ${profile.name}…`)
    const sent = await switchTo(profile.id).catch(() => false)
    // Si la pestaña sigue aquí, el cambio no ha llegado (habría pasado a ser del otro usuario).
    setTimeout(() => { if (busy) { setBusy(false); notice('No se ha podido cambiar de usuario. Vuelve a intentarlo.') } }, sent ? 6000 : 0)
  })
  // Google, en una pestaña nueva de este usuario (hereda su contenedor); lo demás es de todo Kitsune.
  async function openAction(action) {
    if (action === 'google') { window.open('https://accounts.google.com/ServiceLogin', '_blank', 'noopener'); return }
    if (await mutate(`/api/profiles/${encodeURIComponent(baseId())}/open`, 'POST', { action }, 'Abriendo…')) {
      $('#profiles-operation').textContent = 'Abierto en una pestaña nueva.'
    }
  }
  dialog.querySelectorAll('[data-profile-action]').forEach(button => button.addEventListener('click', () => void openAction(button.dataset.profileAction)))
  render()
  await load({ quiet: true })
  return { show, reload: () => load({ quiet: true }) }
}

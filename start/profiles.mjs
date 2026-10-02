/** Local browser profiles are not online accounts. All mutations are confirmed
 * by the loopback service before this view reflects a saved change. */
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
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/u.test(item.id) || ids.has(item.id) || typeof item.name !== 'string' || !item.name.trim() || [...item.name].length > 48 || BAD_TEXT.test(item.name) || typeof item.email !== 'string' || [...item.email].length > 254 || BAD_TEXT.test(item.email) || !PROFILE_COLORS.includes(item.color)) throw new Error('Invalid profile in response')
    ids.add(item.id)
  }
  if (!ids.has(value.currentId) || !ids.has(value.defaultId)) throw new Error('Invalid current/default profile')
  return value
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

export async function initializeProfiles({ announce = () => {} } = {}) {
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
  const icon = name => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    use.setAttribute('href', `#i-${name}`)
    svg.setAttribute('aria-hidden', 'true')
    svg.append(use)
    return svg
  }
  const avatar = (node, profile, draft) => paintAvatar(node, profile, profileInitials(profile.name), draft)

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
    const desired = profile.rememberGoogle === true
    if (profile.id !== snapshot.currentId) {
      status.textContent = desired ? 'Abre este perfil para aplicar la conservación de Google.' : 'Sin conservación de Google activada en Kitsune.'
      return
    }
    status.textContent = 'Aplicando…'
    const started = performance.now()
    const check = async () => {
      try {
        const response = await fetch('/api/appearance', { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(4000) })
        if (!response.ok) throw new Error('Native state unavailable')
        const appearance = await response.json()
        if (request !== googleRequest || !dialog.open || formMode) return
        const confirmed = googleRetentionStatus(appearance, desired)
        if (confirmed) {
          status.textContent = confirmed
          return
        }
      } catch { /* Keep pending until a native acknowledgement is available. */ }
      if (request !== googleRequest || !dialog.open || formMode) return
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
    dialog.setAttribute('aria-busy', String(busy || photoBusy))
    $('#profile-create').disabled = blocked || Boolean(formMode) || snapshot?.profiles.length >= 24
    $('#profile-create').title = snapshot?.profiles.length >= 24 ? 'Has llegado al límite de 24 perfiles.' : ''
    $('#profile-save').disabled = blocked || photoBusy
    $('#profile-cancel').disabled = busy
    $('#profile-name').disabled = busy
    $('#profile-email').disabled = busy
    $('#profiles-reload').disabled = busy
    $('#profile-edit').disabled = blocked
    $('#profile-open').disabled = blocked
    $('#profile-make-default').disabled = blocked
    dialog.querySelectorAll('[data-profile-id]').forEach(button => { button.disabled = blocked || Boolean(formMode) })
    dialog.querySelectorAll('[data-profile-action]').forEach(button => { button.disabled = blocked })
    dialog.querySelectorAll('[data-profile-swatch]').forEach(button => { button.disabled = busy })
    if ($('#profile-photo')) $('#profile-photo').disabled = busy
    if ($('#profile-photo-remove')) $('#profile-photo-remove').disabled = busy || !(photoData === undefined ? originalPhoto : photoData)
    if ($('#profile-remember-google')) $('#profile-remember-google').disabled = busy
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
      hint.textContent = profile.id === snapshot.currentId ? 'En esta ventana' : profile.id === snapshot.defaultId ? 'Predeterminado' : 'Perfil local'
      copy.append(name, hint)
      button.append(glyph, copy)
      if (profile.id === snapshot.defaultId) {
        const mark = icon('check')
        mark.classList.add('profile-default-mark')
        button.append(mark)
      }
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
      trigger.setAttribute('aria-label', `Gestionar perfiles. Perfil de esta ventana: ${current.name}`)
      trigger.title = `Perfil de esta ventana: ${current.name}`
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
      $('#profile-default-badge').hidden = profile.id !== snapshot.defaultId
      $('#profile-open span').textContent = profile.id === snapshot.currentId ? 'Abrir este perfil' : 'Cambiar a este perfil'
      $('#profile-make-default').hidden = profile.id === snapshot.defaultId
      $('#profile-default-copy').textContent = profile.id === snapshot.defaultId ? 'Kitsune usa este perfil cuando lo abres sin elegir otro.' : 'Puedes usar este perfil al abrir Kitsune sin elegir otro.'
    }
    renderControls()
    updateGoogleStatus()
  }

  function accept(value) {
    snapshot = parseProfilesSnapshot(value)
    if (!snapshot.profiles.some(profile => profile.id === selectedId)) selectedId = snapshot.currentId
    ready = true
  }

  async function load({ quiet = false } = {}) {
    if (busy) return
    if (location.protocol === 'file:') {
      ready = false
      notice('Abre el inicio completo de Kitsune para gestionar los perfiles reales de este equipo.')
      $('#profiles-empty-copy').textContent = 'Los perfiles no están disponibles en la copia de emergencia del inicio.'
      return
    }
    setBusy(true, quiet ? '' : 'Actualizando tus perfiles…')
    try {
      const response = await fetch('/api/profiles', { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(5000) })
      if (!response.ok) throw new Error('Profiles unavailable')
      accept(await response.json())
      notice()
      render()
    } catch {
      ready = false
      if (!quiet || dialog.open) notice('No se ha podido conectar con los perfiles. Tu navegación sigue funcionando.', true)
      $('#profiles-empty-copy').textContent = 'No hemos podido cargar tus perfiles.'
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
        notice(formMode ? 'Otra ventana ha cambiado los perfiles. Tu borrador se conserva; revísalo y guarda de nuevo.' : 'La lista ha cambiado. Revisa el perfil y vuelve a intentarlo.')
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
    avatar($('#profile-preview-avatar'), { id: formId, name: $('#profile-name').value || 'Nuevo espacio', color, avatar: originalPhoto }, photoData)
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
    $('#profile-name').value = profile?.name || ''
    $('#profile-email').value = profile?.email || ''
    $('#profile-form-title').textContent = profile ? 'Editar perfil' : 'Nuevo perfil'
    $('#profile-save span').textContent = profile ? 'Guardar cambios' : 'Crear perfil'
    $('#profile-form-note').textContent = profile ? 'Tus marcadores y contraseñas no cambian.' : 'Un perfil independiente, guardado en este equipo.'
    $('#profile-form-error').hidden = true
    notice()
    $('#profiles-operation').textContent = ''
    preview(); render()
    $('#profile-name').focus()
  }

  trigger.addEventListener('click', () => {
    returnFocus = document.activeElement
    if (!dialog.open) dialog.showModal()
    $('#profiles-title').focus({ preventScroll: true })
    void load()
  })
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
    if ($('#profile-remember-google')) draft.rememberGoogle = $('#profile-remember-google').checked
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
    $('#profiles-operation').textContent = creating ? 'Perfil creado. Ábrelo cuando quieras empezar a usarlo.' : 'Detalles guardados en este equipo.'
    if (dialog.open) $('#profile-detail-name').focus({ preventScroll: true })
    else announce(creating ? 'Perfil creado.' : 'Perfil actualizado.')
  })
  $('#profile-make-default').addEventListener('click', async () => {
    const profile = selectedProfile()
    if (!profile) return
    if (await mutate(`/api/profiles/${encodeURIComponent(profile.id)}/default`, 'POST', {}, 'Cambiando el perfil predeterminado…')) {
      $('#profiles-operation').textContent = `${profile.name}: perfil predeterminado.`
      if (dialog.open) $('#profile-open').focus({ preventScroll: true })
    }
  })
  async function openProfile(action) {
    const profile = selectedProfile()
    if (!profile) return
    if (await mutate(`/api/profiles/${encodeURIComponent(profile.id)}/open`, 'POST', { action }, 'Abriendo…')) {
      $('#profiles-operation').textContent = `Apertura solicitada en ${profile.name}.`
    }
  }
  $('#profile-open').addEventListener('click', () => void openProfile('home'))
  dialog.querySelectorAll('[data-profile-action]').forEach(button => button.addEventListener('click', () => void openProfile(button.dataset.profileAction)))
  render()
  await load({ quiet: true })
}

/** Tarjeta de usuarios del inicio, como la de las cuentas de Google: el usuario de esta
 * pestaña arriba y los demás debajo. Elegir otro cambia esta misma pestaña a su inicio;
 * las demás pestañas no se tocan. */
import { paintAvatar } from './avatar.mjs'
import { profileInitials } from './profiles.mjs'

const USER_ID = /^(default|p-[0-9a-f]{16})$/u

/** Cómo se pide el cambio: al inicio integrado, por su API; al servidor de Linux, cargando
 * «/?cambiar=<id>», que el motor intercepta y convierte en el cambio de esta pestaña. */
export function switchRequest(id, { integrated }) {
  if (!USER_ID.test(id ?? '')) throw new Error('Usuario no válido')
  return integrated
    ? { kind: 'api', path: `/api/profiles/${id}/open`, body: { action: 'switch' } }
    : { kind: 'navigate', url: `/?cambiar=${id}` }
}

/** Pide el cambio. true si se ha enviado (si funciona, esta pestaña se sustituye y no vuelve). */
export async function switchTo(id, { integrated, token, fetcher = (...args) => globalThis.fetch(...args), navigate = url => location.assign(url) }) {
  const request = switchRequest(id, { integrated })
  if (request.kind === 'navigate') {
    navigate(request.url)
    return true
  }
  const response = await fetcher(request.path, {
    method: 'POST', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(8000),
    headers: { 'Content-Type': 'application/json', 'X-Kitsune-Token': token }, body: JSON.stringify(request.body),
  })
  return response.ok
}

/** Los usuarios que salen debajo: todos menos el de esta pestaña, en el orden del registro. */
export function otherUsers(snapshot) {
  return (snapshot?.profiles ?? []).filter(profile => profile.id !== snapshot.currentId)
}

export function initializeSwitcher({ integrated, onManage = () => {}, onAdd = () => {} } = {}) {
  const $ = selector => document.querySelector(selector)
  const card = $('#users-card')
  const trigger = $('#profiles-open')
  if (!card || !trigger) return { render() {}, switchTo: async () => false }
  let snapshot = null
  let switching = false

  const status = message => { $('#users-card-status').textContent = message }

  async function change(profile) {
    if (switching || !snapshot) return false
    switching = true
    status(`Cambiando a ${profile.name}…`)
    card.querySelectorAll('[data-user-id]').forEach(button => { button.disabled = true })
    let sent = false
    try { sent = await switchTo(profile.id, { integrated, token: snapshot.token }) } catch { sent = false }
    // Si la pestaña sigue aquí al rato, el cambio no ha llegado.
    setTimeout(() => {
      if (!switching) return
      switching = false
      status('No se ha podido cambiar de usuario. Vuelve a intentarlo.')
      render(snapshot)
    }, sent ? 6000 : 0)
    return sent
  }

  function render(value) {
    snapshot = value
    const me = snapshot?.profiles.find(profile => profile.id === snapshot.currentId)
    if (!me) return
    paintAvatar($('#users-card-avatar'), me, profileInitials(me.name))
    $('#users-card-hello').textContent = `Hola, ${me.name}`
    $('#users-card-email').textContent = me.email
    $('#users-card-email').hidden = !me.email
    const list = $('#users-card-list')
    list.replaceChildren()
    for (const profile of otherUsers(snapshot)) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'users-card-item'
      button.dataset.userId = profile.id
      button.disabled = switching
      const glyph = document.createElement('span')
      glyph.className = 'profile-avatar'
      glyph.setAttribute('aria-hidden', 'true')
      paintAvatar(glyph, profile, profileInitials(profile.name))
      const copy = document.createElement('span')
      copy.className = 'users-card-copy'
      const name = document.createElement('b')
      name.textContent = profile.name
      const detail = document.createElement('small')
      detail.textContent = profile.email || 'Cambiar en esta pestaña'
      copy.append(name, detail)
      button.append(glyph, copy)
      button.setAttribute('aria-label', `Cambiar esta pestaña a ${profile.name}`)
      button.addEventListener('click', () => void change(profile))
      list.append(button)
    }
    list.hidden = !list.children.length
    $('#users-add').disabled = snapshot.profiles.length >= 24
  }

  card.addEventListener('toggle', event => {
    trigger.setAttribute('aria-expanded', String(event.newState === 'open'))
    if (event.newState === 'open' && !switching) status('')
  })
  $('#users-manage').addEventListener('click', () => { card.hidePopover(); onManage() })
  $('#users-add').addEventListener('click', () => { card.hidePopover(); onAdd() })
  return { render, switchTo: id => {
    const profile = snapshot?.profiles.find(item => item.id === id)
    return profile ? change(profile) : Promise.resolve(false)
  } }
}

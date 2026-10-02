import { safeLink } from './navigation.mjs'
import { $, icon } from './dialogs.mjs'

export function editLinks(current, { item, id = item?.id, expected, remove = false }) {
  const existing = current.links.find(link => link.id === id)
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  if (remove && !existing) return current
  if (!remove && equal(existing, item)) return current
  if (existing && !equal(existing, expected)) {
    const error = new Error('Este acceso cambió en otra ventana. Revisa el borrador y vuelve a guardar para confirmarlo.')
    error.name = 'SettingsConflict'; throw error
  }
  if (expected && !existing) {
    const error = new Error('Este acceso se eliminó en otra ventana. Créalo de nuevo si quieres recuperarlo.')
    error.name = 'SettingsConflict'; throw error
  }
  if (!existing && !remove && current.links.length >= 12) throw new Error('Puedes guardar hasta 12 accesos.')
  return { ...current, links: remove ? current.links.filter(link => link.id !== id) : existing ? current.links.map(link => link.id === id ? item : link) : [...current.links, item] }
}

export function initializeShortcuts({ store, announce }) {
  let editing = false
  let editingId = null
  let expected = null
  let busy = false
  let currentSettings = store.data
  let renderSignature = ''
  function render(settings = store.data) {
    currentSettings = settings
    const signature = JSON.stringify([settings.links, settings.newTab, editing, busy, store.ready])
    if (renderSignature === signature) return
    renderSignature = signature
    const grid = $('#quick-links')
    grid.replaceChildren()
    for (const item of settings.links) {
      const wrapper = document.createElement('div')
      wrapper.className = 'quick-link'
      const anchor = document.createElement('a')
      anchor.href = item.url; anchor.title = item.url
      if (settings.newTab) { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer' }
      const glyph = document.createElement('span')
      glyph.className = `link-icon ${item.color}`
      if (item.icon) glyph.append(icon(item.icon))
      else glyph.textContent = [...item.name][0]?.toLocaleUpperCase('es') || '·'
      const name = document.createElement('span')
      name.className = 'link-name'; name.textContent = item.name
      anchor.append(glyph, name); wrapper.append(anchor)
      if (editing) {
        const button = document.createElement('button')
        button.className = 'link-edit'; button.type = 'button'
        button.setAttribute('aria-label', `Editar ${item.name}`)
        button.append(icon('edit')); button.disabled = busy || !store.ready
        button.addEventListener('click', () => open(item)); wrapper.append(button)
      }
      grid.append(wrapper)
    }
    if (settings.links.length < 12) {
      const button = document.createElement('button')
      button.type = 'button'; button.className = 'add-link'
      button.append(icon('plus'), document.createTextNode('Añadir'))
      button.disabled = busy || !store.ready
      button.addEventListener('click', () => open()); grid.append(button)
    }
    $('#edit-links span').textContent = editing ? 'Listo' : 'Editar'
    $('#edit-links').setAttribute('aria-pressed', String(editing))
    $('#edit-links').disabled = !store.ready || busy
  }
  function error(message) { $('#link-error').textContent = message; $('#link-error').hidden = !message }
  function open(item = null) {
    if (busy || !store.ready) return
    editingId = item?.id || crypto.randomUUID(); expected = item ? { ...item } : null
    $('#link-title').textContent = item ? 'Editar acceso' : 'Nuevo acceso'
    $('#link-name').value = item?.name || ''; $('#link-url').value = item?.url || ''
    $('#delete-link').hidden = !item; error('')
    $('#link-dialog').showModal(); $('#link-name').focus()
  }
  function controls(value) {
    busy = value; $('#link-form').setAttribute('aria-busy', String(value))
    $('#link-form button[type="submit"]').disabled = value; $('#delete-link').disabled = value
    render()
  }
  async function save(remove = false) {
    if (busy) return
    error(''); controls(true)
    try {
      const name = $('#link-name').value.trim()
      if (!remove && !name) throw new Error('Escribe un nombre para este acceso.')
      const item = remove ? null : { id: editingId, name: name.slice(0, 36), url: safeLink($('#link-url').value), color: expected?.color || 'blue', icon: expected?.icon || '' }
      const ok = await store.save(current => editLinks(current, { item, id: editingId, expected, remove }))
      if (!ok) {
        expected = store.data.links.find(link => link.id === editingId) || null
        error('No se ha confirmado. El borrador sigue aquí; puedes volver a guardar.'); return
      }
      $('#link-dialog').close(); announce(remove ? 'Acceso eliminado.' : 'Acceso guardado.')
    } catch (failure) { error(failure.message) }
    finally { controls(false) }
  }
  $('#link-form').addEventListener('submit', event => { event.preventDefault(); void save() })
  $('#delete-link').addEventListener('click', () => void save(true))
  $('#edit-links').addEventListener('click', () => { editing = !editing; render(currentSettings) })
  return { render }
}

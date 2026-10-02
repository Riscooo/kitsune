export const $ = selector => document.querySelector(selector)
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
  use.setAttribute('href', `#i-${name}`)
  svg.setAttribute('aria-hidden', 'true')
  svg.append(use)
  return svg
}
export function initializeDialogs() {
  const returns = new WeakMap()
  for (const name of ['settings', 'help']) $(`#${name}-open`)?.addEventListener('click', () => {
    const dialog = $(`#${name}-dialog`)
    returns.set(dialog, document.activeElement)
    if (!dialog.open) dialog.showModal()
  })
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(`#${button.dataset.close}`)?.close()))
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('close', () => returns.get(dialog)?.focus({ preventScroll: true }))
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return
      const box = dialog.getBoundingClientRect()
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close()
    })
  })
  const tabs = [...document.querySelectorAll('[data-settings-tab]')]
  const select = button => {
    tabs.forEach(tab => { tab.setAttribute('aria-selected', String(tab === button)); tab.tabIndex = tab === button ? 0 : -1 })
    document.querySelectorAll('[data-settings-panel]').forEach(panel => { panel.hidden = panel.dataset.settingsPanel !== button.dataset.settingsTab })
  }
  tabs.forEach((button, index) => {
    button.addEventListener('click', () => select(button))
    button.addEventListener('keydown', event => {
      let target
      if (event.key === 'ArrowRight') target = tabs[(index + 1) % tabs.length]
      if (event.key === 'ArrowLeft') target = tabs[(index + tabs.length - 1) % tabs.length]
      if (event.key === 'Home') target = tabs[0]
      if (event.key === 'End') target = tabs.at(-1)
      if (target) { event.preventDefault(); select(target); target.focus() }
    })
  })
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]') || event.target.closest('input, textarea, [contenteditable="true"]')) return
    if (event.key === '/') { event.preventDefault(); $('#query').focus() }
    if (event.key === '?') { event.preventDefault(); $('#help-open').click() }
  })
}

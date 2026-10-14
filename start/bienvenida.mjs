// La bienvenida: la primera vez que se abre «Tu inicio» en un perfil nuevo (bienvenida = false),
// tres elecciones que se ven al momento (tema, tinta y dónde van las pestañas) y dos pistas.
// «Empezar» la guarda como vista. Todo se puede cambiar después en Tu inicio → Apariencia.
export function initializeBienvenida({ $, save }) {
  const dialog = $('#welcome-dialog')
  if (!dialog) return { sync() {} }
  let shown = false
  let catalog = []
  const grid = $('#welcome-tintas')
  fetch('/api/tintas', { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(5000) })
    .then(response => response.ok ? response.json() : { tintas: [] })
    .then(value => { catalog = value.tintas ?? []; if (last) sync(...last) })
    .catch(() => {})
  let last = null
  for (const button of dialog.querySelectorAll('[data-welcome-theme]')) button.addEventListener('click', () => void save({ theme: button.dataset.welcomeTheme }))
  for (const button of dialog.querySelectorAll('[data-welcome-tabs]')) button.addEventListener('click', () => void save({ tabs: button.dataset.welcomeTabs }))
  $('#welcome-start').addEventListener('click', () => { void save({ bienvenida: true }); dialog.close() })
  // Cerrarla con Esc también cuenta como vista.
  dialog.addEventListener('cancel', () => { void save({ bienvenida: true }) })

  function sync(settings, ready) {
    last = [settings, ready]
    for (const button of dialog.querySelectorAll('[data-welcome-theme]')) button.setAttribute('aria-pressed', String(button.dataset.welcomeTheme === settings.theme))
    for (const button of dialog.querySelectorAll('[data-welcome-tabs]')) button.setAttribute('aria-pressed', String(button.dataset.welcomeTabs === settings.tabs))
    grid.replaceChildren(...catalog.map(tinta => {
      const palette = settings.theme === 'oscuro' && settings.negro ? { ...tinta.oscuro, bg: '#000000' } : tinta[settings.theme] ?? tinta.claro
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'tinta'
      button.setAttribute('role', 'radio')
      button.setAttribute('aria-checked', String(tinta.id === settings.tinta))
      button.title = tinta.name
      const swatch = document.createElement('span')
      swatch.className = 'tinta-swatch'
      swatch.setAttribute('aria-hidden', 'true')
      swatch.style.setProperty('--swatch-bg', palette.bg)
      swatch.style.setProperty('--swatch-primary', palette.primary)
      swatch.style.setProperty('--swatch-secondary', palette.secondary)
      swatch.style.setProperty('--swatch-text', palette.text)
      const name = document.createElement('span')
      name.className = 'tinta-name'
      name.textContent = tinta.name
      button.append(swatch, name)
      button.addEventListener('click', () => void save({ tinta: tinta.id }))
      return button
    }))
    // En las pruebas automáticas (navigator.webdriver) no sale, salvo que se pida con ?bienvenida.
    const automated = navigator.webdriver && !new URLSearchParams(location.search).has('bienvenida')
    if (!shown && ready && settings.bienvenida === false && !dialog.open && !automated) {
      shown = true
      dialog.showModal()
      $('#welcome-start').focus()
    }
  }
  return { sync }
}


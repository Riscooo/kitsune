// Antes de pintar: el tema de la última vez. En Linux el servidor ya lo pone en el
// HTML; en el inicio integrado (Windows y macOS) no hay servidor que lo haga.
try {
  const theme = localStorage.getItem('kitsune-tema')
  if ((theme === 'claro' || theme === 'oscuro') && !document.documentElement.dataset.theme) document.documentElement.dataset.theme = theme
  // Y la paleta de su tinta, si es la de ese tema (la que llegue del navegador manda luego).
  const saved = JSON.parse(localStorage.getItem('kitsune-paleta') ?? 'null')
  const root = document.documentElement
  if (saved && saved.theme === (root.dataset.theme || 'claro') && saved.palette && typeof saved.palette === 'object') {
    const names = { bg: 'bg', surface: 'surface', surfaceHigh: 'surface-high', text: 'text', muted: 'muted', outline: 'outline',
      primary: 'primary', primaryContainer: 'primary-container', secondary: 'secondary', tertiary: 'tertiary' }
    for (const [key, name] of Object.entries(names)) {
      if (typeof saved.palette[key] === 'string' && /^#[0-9a-f]{6}$/i.test(saved.palette[key])) root.style.setProperty(`--kb-${name}`, saved.palette[key])
    }
  }
} catch { /* sin almacenamiento: el tema llega con los ajustes */ }
// En Mac los botones de la ventana son los nativos: Tu inicio no ofrece moverlos.
if (/Mac/.test(navigator.platform)) document.documentElement.dataset.platform = 'mac'

// Antes de pintar: el tema de la última vez. En Linux el servidor ya lo pone en el
// HTML; en el inicio integrado (Windows y macOS) no hay servidor que lo haga.
try {
  const theme = localStorage.getItem('kitsune-tema')
  if ((theme === 'claro' || theme === 'oscuro') && !document.documentElement.dataset.theme) document.documentElement.dataset.theme = theme
} catch { /* sin almacenamiento: el tema llega con los ajustes */ }
// En Mac los botones de la ventana son los nativos: Tu inicio no ofrece moverlos.
if (/Mac/.test(navigator.platform)) document.documentElement.dataset.platform = 'mac'

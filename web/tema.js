// Antes de pintar: el tema guardado o el del sistema, para que no parpadee.
(() => {
  let theme = null
  try { theme = localStorage.getItem('kitsune-tema') } catch { /* sin almacenamiento */ }
  if (theme !== 'claro' && theme !== 'oscuro') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro'
  document.documentElement.dataset.theme = theme
})()

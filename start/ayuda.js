// Los enlaces de ayuda del motor llegan como /ayuda/<tema>: se abre la sección que toca.
const TOPICS = [
  [/password|login|autofill|credential/u, 'contrasenas'],
  [/track|fingerprint|cryptomin|social-media|protection|cookie|content-blocking/u, 'rastreadores'],
  [/privacy|sanitize|clear|history|private|global-privacy/u, 'privacidad'],
  [/addon|extension|theme|recommended|plugin/u, 'extensiones'],
  [/https|dns|certificate|security|phishing|safe|connection|insecure/u, 'seguridad'],
  [/download/u, 'descargas'],
  [/home|new-?tab|wallpaper|customiz|toolbar|appearance/u, 'apariencia'],
  [/keyboard|shortcut/u, 'atajos'],
]
const topic = decodeURIComponent(location.pathname.split('/').filter(Boolean).slice(1).join('/')).toLowerCase()
const match = topic && !location.hash ? TOPICS.find(([pattern]) => pattern.test(topic)) : null
if (match) {
  const section = document.getElementById(match[1])
  section?.classList.add('help-highlight')
  section?.scrollIntoView({ block: 'start' })
}

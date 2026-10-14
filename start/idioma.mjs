// «Tu inicio» en el idioma de Kitsune: castellano si Kitsune está en castellano y, si no, inglés.
// El idioma lo dice Kitsune (/api/idioma): con la protección anti-huella, navigator.language de
// esta página siempre diría en-US. Se recuerda para la próxima vez; si cambia, el inicio se recarga.
// El HTML y los textos fijos que pone el código se traducen con en.mjs (también lo que se añade
// después, con un MutationObserver); los textos con datos dentro usan tr('…', '…').
import EN from './en.mjs'

const STORAGE = 'kitsune-idioma'
const ATTRIBUTES = ['placeholder', 'aria-label', 'title', 'alt']
const spanish = locale => /^es\b/i.test(locale ?? 'es')
let saved = null
try { saved = localStorage.getItem(STORAGE) } catch { /* sin almacenamiento */ }
export let english = !spanish(saved)
export const tr = (es, en) => (english ? en : es)

const normalize = text => text.replace(/\s+/g, ' ').trim()
function translateText(node) {
  const key = normalize(node.nodeValue)
  const value = key && EN[key]
  if (value) node.nodeValue = node.nodeValue.replace(/\S[\s\S]*\S|\S/, value)
}
function translateElement(element) {
  for (const name of ATTRIBUTES) {
    const value = element.getAttribute?.(name)
    if (value && EN[normalize(value)]) element.setAttribute(name, EN[normalize(value)])
  }
}
/** Traduce lo que haya en `root` (texto y atributos) que esté en el diccionario. */
export function translate(root) {
  if (!english || !root) return
  if (root.nodeType === Node.TEXT_NODE) { translateText(root); return }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return
  if (root.nodeType === Node.ELEMENT_NODE) translateElement(root)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!['SCRIPT', 'STYLE'].includes(node.parentElement?.tagName)) translateText(node)
    } else translateElement(node)
  }
}

export async function initializeLanguage({ fetcher = (...args) => globalThis.fetch(...args) } = {}) {
  if (english) {
    document.documentElement.lang = 'en'
    if (EN[normalize(document.title)]) document.title = EN[normalize(document.title)]
    translate(document.body)
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') translateText(record.target)
        else if (record.type === 'attributes') translateElement(record.target)
        else for (const node of record.addedNodes) translate(node)
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES })
  }
  if (location.protocol === 'file:') return
  try {
    const response = await fetcher('/api/idioma', { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(4000) })
    const { locale } = await response.json()
    if (typeof locale !== 'string') return
    // Solo se recarga si el idioma ha quedado guardado: si no, volvería a empezar igual, sin parar.
    let stored = false
    try { localStorage.setItem(STORAGE, locale); stored = localStorage.getItem(STORAGE) === locale } catch { /* sin almacenamiento */ }
    if (stored && spanish(locale) === english) location.reload()
  } catch { /* se queda como estaba */ }
}

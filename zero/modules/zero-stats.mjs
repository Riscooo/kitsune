/* Kitsune Zero · las estadísticas, la parte pura (sin Gecko): cómo se guardan, se suman y se resumen.
 *
 * Risco (9-11): «un dashboard de tus estadísticas con el navegador, dónde te has pasado más tiempo, cuántas
 * búsquedas has hecho, y que se vea en qué gastas más tiempo». Lo cuenta zero-stats.sys.mjs y se queda en este
 * ordenador (un JSON en el perfil): nada sale de aquí, no se guarda qué se busca (solo cuántas veces) ni las
 * direcciones (solo el dominio).
 *
 * Datos: { version: 1, days: { 'AAAA-MM-DD': { sites: { dominio: segundos }, searches: n, pages: n, hours?: [24 segundos],
 * estudio?, pomos?, notas?, subrayados?, citas? } }, total?: { lo mismo, desde siempre }, logros?: { id: día } }.
 * Desde la 0.8.0-beta.8 se guarda algo más de un año (antes, 90 días), para el panel a pantalla completa y los logros
 * (zero-logros.mjs).
 */
export const KEEP_DAYS = 400;
/** Lo que se cuenta además del tiempo: segundos de estudio, pomodoros, notas, subrayados y citas. */
export const COUNTERS = Object.freeze(['estudio', 'pomos', 'notas', 'subrayados', 'citas']);
const MAX_SITES_PER_DAY = 400;
const SITE = /^[a-z0-9.-]{1,253}$/;

/** El día (local) de una fecha, como clave. */
export function dayKey(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Los `span` días que acaban en `today` (incluido), del más antiguo al de hoy. */
export function lastDays(today, span) {
  const [y, m, d] = today.split('-').map(Number);
  return Array.from({ length: span }, (_, i) => dayKey(new Date(y, m - 1, d - (span - 1 - i))));
}

export const emptyData = () => ({ version: 1, days: {} });

/** Lo que se lee del disco, comprobado: lo que no tiene la forma esperada se descarta (no rompe nada). */
export function sanitize(value) {
  const data = emptyData();
  const days = value && typeof value === 'object' && value.days && typeof value.days === 'object' ? value.days : {};
  const count = n => (Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 1e9) : 0);
  for (const [day, entry] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !entry || typeof entry !== 'object') continue;
    const sites = {};
    for (const [site, seconds] of Object.entries(entry.sites ?? {}).slice(0, MAX_SITES_PER_DAY)) {
      if (SITE.test(site) && Number.isFinite(seconds) && seconds > 0) sites[site] = Math.min(Math.round(seconds), 86400);
    }
    data.days[day] = { sites, searches: count(entry.searches), pages: count(entry.pages) };
    if (Array.isArray(entry.hours) && entry.hours.length === 24) data.days[day].hours = entry.hours.map(n => Math.min(count(n), 3600));
    for (const key of COUNTERS) if (count(entry[key])) data.days[day][key] = count(entry[key]);
  }
  if (value?.total && typeof value.total === 'object') {
    data.total = {};
    for (const key of COUNTERS) if (count(value.total[key])) data.total[key] = count(value.total[key]);
  }
  if (value?.logros && typeof value.logros === 'object') {
    data.logros = {};
    for (const [id, day] of Object.entries(value.logros).slice(0, 200)) if (/^[a-z0-9-]{1,40}$/.test(id) && /^\d{4}-\d{2}-\d{2}$/.test(day)) data.logros[id] = day;
  }
  return data;
}

function dayOf(data, day) {
  data.days[day] ??= { sites: {}, searches: 0, pages: 0 };
  return data.days[day];
}

/** Suma tiempo a una web (su dominio) en ese día (y, si se dice, en esa hora). */
export function addTime(data, day, site, seconds, hour = null) {
  const name = String(site ?? '').toLowerCase();
  if (!SITE.test(name) || !(seconds > 0)) return false;
  const entry = dayOf(data, day);
  if (!(name in entry.sites) && Object.keys(entry.sites).length >= MAX_SITES_PER_DAY) return false;
  entry.sites[name] = Math.min((entry.sites[name] ?? 0) + seconds, 86400);
  if (Number.isInteger(hour) && hour >= 0 && hour < 24) {
    entry.hours ??= Array(24).fill(0);
    entry.hours[hour] = Math.min(entry.hours[hour] + seconds, 3600);
  }
  return true;
}

/** Suma a uno de los contadores (COUNTERS), en el día y en el total. */
export function addCount(data, day, key, n = 1) {
  if (!COUNTERS.includes(key) || !(n > 0)) return false;
  const entry = dayOf(data, day);
  entry[key] = (entry[key] ?? 0) + n;
  data.total ??= {};
  data.total[key] = (data.total[key] ?? 0) + n;
  return true;
}

export function addSearch(data, day) { dayOf(data, day).searches++; }
export function addPage(data, day) { dayOf(data, day).pages++; }

/** Quita los días de hace más de `keep`. */
export function prune(data, today, keep = KEEP_DAYS) {
  const oldest = lastDays(today, keep)[0];
  for (const day of Object.keys(data.days)) if (day < oldest) delete data.days[day];
  return data;
}

/* En qué se va el tiempo: categorías por dominio (lo más común; lo demás, «Otras»). Se mira el dominio y sus
 * padres (m.youtube.com → youtube.com). */
export const CATEGORIES = Object.freeze([
  { id: 'social', es: 'Redes', en: 'Social' },
  { id: 'video', es: 'Vídeo', en: 'Video' },
  { id: 'music', es: 'Música', en: 'Music' },
  { id: 'study', es: 'Estudio y trabajo', en: 'Study & work' },
  { id: 'dev', es: 'Programar', en: 'Coding' },
  { id: 'ai', es: 'IA', en: 'AI' },
  { id: 'chat', es: 'Mensajes', en: 'Messaging' },
  { id: 'news', es: 'Noticias', en: 'News' },
  { id: 'shop', es: 'Compras', en: 'Shopping' },
  { id: 'games', es: 'Juegos', en: 'Games' },
  { id: 'search', es: 'Buscar', en: 'Search' },
  { id: 'other', es: 'Otras', en: 'Other' },
]);
const SITES = {
  social: 'instagram.com facebook.com x.com twitter.com tiktok.com reddit.com threads.net bsky.app linkedin.com pinterest.com tumblr.com snapchat.com mastodon.social',
  video: 'youtube.com youtu.be twitch.tv netflix.com primevideo.com disneyplus.com hbomax.com max.com vimeo.com dailymotion.com crunchyroll.com atresplayer.com rtve.es mitele.es movistarplus.es filmin.es kick.com',
  music: 'spotify.com soundcloud.com music.apple.com deezer.com tidal.com bandcamp.com music.youtube.com',
  study: 'docs.google.com drive.google.com classroom.google.com office.com live.com sharepoint.com cloud.microsoft officeapps.live.com onedrive.live.com notion.so wikipedia.org moodle.org educamos.com aulavirtual.es canva.com overleaf.com quizlet.com khanacademy.org coursera.org duolingo.com trello.com miro.com figma.com',
  dev: 'github.com gitlab.com stackoverflow.com developer.mozilla.org npmjs.com vercel.com pypi.org rust-lang.org',
  ai: 'claude.ai chatgpt.com openai.com gemini.google.com perplexity.ai copilot.microsoft.com',
  chat: 'web.whatsapp.com whatsapp.com discord.com telegram.org web.telegram.org mail.google.com outlook.live.com outlook.office.com proton.me slack.com teams.microsoft.com',
  news: 'elpais.com elmundo.es abc.es 20minutos.es eldiario.es lavanguardia.com marca.com as.com bbc.com bbc.co.uk nytimes.com theguardian.com cnn.com elconfidencial.com xataka.com',
  shop: 'amazon.es amazon.com aliexpress.com ebay.com ebay.es zalando.es shein.com temu.com elcorteingles.es pccomponentes.com wallapop.com vinted.es mediamarkt.es',
  games: 'store.steampowered.com steampowered.com steamcommunity.com epicgames.com itch.io chess.com lichess.org roblox.com minecraft.net nintendo.com playstation.com xbox.com',
  search: 'google.com google.es bing.com duckduckgo.com startpage.com search.brave.com ecosia.org',
};
const INDEX = new Map(Object.entries(SITES).flatMap(([id, list]) => list.split(' ').map(site => [site, id])));

export function categoryOf(site) {
  const parts = String(site ?? '').toLowerCase().split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const found = INDEX.get(parts.slice(i).join('.'));
    if (found) return found;
  }
  return 'other';
}

/** El resumen de los últimos `span` días (1 = hoy): totales, las webs y las categorías de más a menos tiempo, y el
 *  tiempo de cada día. */
export function summarize(data, today, span = 1) {
  const days = lastDays(today, span);
  const sites = new Map(), categories = new Map();
  let total = 0, searches = 0, pages = 0;
  const hours = Array(24).fill(0), counters = Object.fromEntries(COUNTERS.map(key => [key, 0]));
  const perDay = days.map(day => {
    const entry = data.days[day];
    let seconds = 0;
    for (const [site, value] of Object.entries(entry?.sites ?? {})) {
      seconds += value;
      sites.set(site, (sites.get(site) ?? 0) + value);
      const category = categoryOf(site);
      categories.set(category, (categories.get(category) ?? 0) + value);
    }
    total += seconds;
    searches += entry?.searches ?? 0;
    pages += entry?.pages ?? 0;
    (entry?.hours ?? []).forEach((value, hour) => { hours[hour] += value; });
    for (const key of COUNTERS) counters[key] += entry?.[key] ?? 0;
    return { day, seconds, estudio: entry?.estudio ?? 0 };
  });
  const sorted = map => [...map].map(([id, seconds]) => ({ id, seconds })).sort((a, b) => b.seconds - a.seconds || a.id.localeCompare(b.id));
  return { span, total, searches, pages, sites: sorted(sites).map(({ id, seconds }) => ({ site: id, seconds })), categories: sorted(categories), days: perDay, hours, counters };
}

/** El cambio respecto a los `span` días de antes: { antes (segundos), cambio (-1 a …; null si antes no hubo nada) }. */
export function compare(data, today, span) {
  const first = lastDays(today, span)[0], [previousEnd] = lastDays(first, 2);
  const antes = summarize(data, previousEnd, span).total, ahora = summarize(data, today, span).total;
  return { antes, cambio: antes > 0 ? (ahora - antes) / antes : null };
}

/** Un año de días por meses: [{ month: 'AAAA-MM', seconds }], del más antiguo al de ahora. */
export function byMonth(days) {
  const months = new Map();
  for (const { day, seconds } of days) months.set(day.slice(0, 7), (months.get(day.slice(0, 7)) ?? 0) + seconds);
  return [...months].map(([month, seconds]) => ({ month, seconds }));
}

/** El calendario de las últimas `weeks` semanas (de lunes a domingo): columnas de 7 { day, seconds, level } (null, los
 *  días que aún no han llegado). El nivel, de 0 a 4, según el día con más. */
export function calendar(data, today, weeks, of = entry => Object.values(entry?.sites ?? {}).reduce((a, b) => a + b, 0)) {
  const [y, m, d] = today.split('-').map(Number);
  const weekday = (new Date(y, m - 1, d).getDay() + 6) % 7;
  const days = lastDays(today, (weeks - 1) * 7 + weekday + 1).map(day => ({ day, seconds: of(data.days[day]) || 0 }));
  const max = Math.max(...days.map(item => item.seconds), 1);
  const cells = days.map(item => ({ ...item, level: item.seconds ? Math.max(1, Math.ceil((item.seconds / max) * 4)) : 0 }));
  while (cells.length < weeks * 7) cells.push(null);
  return Array.from({ length: weeks }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

/** «2 h 05 min», «35 min», «menos de 1 min». */
export function formatDuration(seconds, t = es => es) {
  const minutes = Math.floor((seconds ?? 0) / 60);
  if (minutes < 1) return t('menos de 1 min', 'under 1 min');
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return rest ? `${hours} h ${String(rest).padStart(2, '0')} min` : `${hours} h`;
}

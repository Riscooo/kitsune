/* Kitsune Zero · las descargas, en la isla.
 *
 * En Zero no está el botón de descargas de Gecko (la isla solo lleva atrás, adelante, recargar y el
 * menú): la isla hace de «actividad en directo», como la Dynamic Island. Mientras se descarga algo,
 * enseña el nombre, el porcentaje y una barra fina; al acabar dice «Descargado» y un clic lo abre.
 * Si falla, lo dice. Lo que ya estaba descargado al entrar en Zero no se anuncia.
 */
import { Downloads } from 'resource://gre/modules/Downloads.sys.mjs';

const state = new WeakMap(); // ventana → { list, view, keys }

const megas = bytes => `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0).replace('.', ',')} MB`;
const nameOf = download => { try { return PathUtils.filename(download.target.path); } catch { return download.source?.url ?? ''; } };

export function attach(win, ctx) {
  const { host, island } = ctx;
  if (!island?.activity) return;
  const t = host?.t ?? ((es) => es);
  const st = { keys: new WeakMap(), next: 0, alive: true };
  state.set(win, st);
  const keyOf = download => {
    if (!st.keys.has(download)) st.keys.set(download, `descarga-${st.next++}`);
    return st.keys.get(download);
  };
  const follow = download => {
    if (!st.alive) return;
    const key = keyOf(download), name = nameOf(download);
    if (download.succeeded) {
      island.endActivity(key);
      island.alert(t('Descargado', 'Downloaded'), name, 6000, 'done', { action: () => download.launch().catch(() => {}) });
    } else if (download.error) {
      island.endActivity(key);
      island.alert(t('No se pudo descargar', 'Download failed'), name, 5000, 'blocked');
    } else if (download.stopped) {
      island.endActivity(key); // cancelada o en pausa: deja de anunciarse
    } else {
      const progress = download.hasProgress ? download.progress / 100 : null;
      const detail = download.hasProgress
        ? `${download.progress} % · ${megas(download.currentBytes)} ${t('de', 'of')} ${megas(download.totalBytes)}`
        : megas(download.currentBytes);
      island.activity(key, { text: name, detail, icon: 'download', progress });
    }
  };
  st.view = {
    onDownloadAdded: download => { if (!download.succeeded && !download.stopped) { st.keys.set(download, keyOf(download)); follow(download); } },
    onDownloadChanged: download => { if (st.keys.has(download)) follow(download); },
    onDownloadRemoved: download => { if (st.keys.has(download)) island.endActivity(keyOf(download)); },
  };
  Downloads.getList(Downloads.ALL).then(list => {
    if (!st.alive) return;
    st.list = list;
    return list.addView(st.view);
  }).catch(() => {});
}

export function detach(win) {
  const st = state.get(win);
  if (!st) return;
  state.delete(win);
  st.alive = false;
  st.list?.removeView(st.view).catch?.(() => {});
}

/* Kitsune Zero · lo que suena en otra pestaña, en la isla (como la música en la Dynamic Island).
 *
 * Si una pestaña que no estás viendo reproduce algo (con el MediaController de Gecko, el de las
 * teclas multimedia del sistema):
 * - al empezar a sonar o al cambiar de canción, la isla lo dice un momento («título · artista»), y un
 *   clic en el aviso lleva a esa pestaña;
 * - mientras suena (o está en pausa), una onda pequeña junto al dominio; con la isla abierta, pausa y
 *   siguiente (si la web lo permite).
 * La tarjeta «lo que suena» de Kitsune vive en la barra de herramientas, que en Zero es la isla: Zero
 * no la usa (ni nada de Kitsune), va directo a Gecko.
 */
const EVENTS = ['activated', 'deactivated', 'metadatachange', 'playbackstatechange', 'supportedkeyschange'];
const state = new WeakMap(); // ventana → { tab, controller, said, … }

const controllerOf = tab => { try { return tab?.linkedBrowser?.browsingContext?.mediaController ?? null; } catch { return null; } };
const live = tab => !!tab?.isConnected && !tab.closing;

export function attach(win, ctx) {
  const { island } = ctx;
  if (!island?.nowPlaying) return;
  const st = { tab: null, controller: null, said: '', alive: true, cleanups: [] };
  state.set(win, st);
  const listen = (target, type, fn) => { target.addEventListener(type, fn); st.cleanups.push(() => target.removeEventListener(type, fn)); };

  const onController = () => refresh();
  const follow = tab => {
    const controller = controllerOf(tab);
    if (st.tab === tab && st.controller === controller) return;
    if (st.controller) for (const name of EVENTS) st.controller.removeEventListener(name, onController);
    st.tab = tab; st.controller = controller;
    if (controller) for (const name of EVENTS) controller.addEventListener(name, onController);
  };
  st.unfollow = () => follow(null);

  // Cuál: la que ya se seguía mientras siga activa (sonando o en pausa); si no, la que suene.
  const choose = () => {
    const active = win.gBrowser.tabs.filter(tab => live(tab) && controllerOf(tab)?.isActive);
    if (active.includes(st.tab)) return st.tab;
    return active.find(tab => controllerOf(tab).isPlaying) ?? active[0] ?? null;
  };

  const refresh = () => {
    if (!st.alive) return;
    follow(choose());
    const { tab, controller } = st;
    if (!live(tab) || !controller?.isActive || tab.selected) { island.nowPlaying(null); return; }
    let meta = null;
    try { meta = controller.getMetadata(); } catch { /* la web no dice nada */ }
    const title = String(meta?.title || tab.label || '').trim();
    const artist = String(meta?.artist || '').trim();
    const go = () => { if (live(tab)) win.gBrowser.selectedTab = tab; };
    island.nowPlaying({
      playing: controller.isPlaying, title,
      canNext: [...(controller.supportedKeys ?? [])].includes('nexttrack'),
      // Gecko 158 pide de dónde viene la pausa.
      toggle: () => { try { controller.isPlaying ? controller.pause('user') : controller.play(); } catch { /* ya no está */ } },
      next: () => { try { controller.nextTrack(); } catch { /* ya no está */ } },
      go,
    });
    // Al empezar a sonar o con otra canción, un aviso breve (una vez por canción).
    const said = `${title}\n${artist}`;
    if (controller.isPlaying && said !== st.said) {
      st.said = said;
      island.alert(title, artist && artist !== title ? artist : '', 3500, 'media', { action: go });
    }
  };

  const tabs = win.gBrowser.tabContainer;
  for (const type of ['TabSelect', 'TabClose', 'TabOpen']) listen(tabs, type, () => win.setTimeout(refresh, 0));
  // Una pestaña que empieza a sonar (o se calla): Gecko lo marca en sus atributos.
  listen(tabs, 'TabAttrModified', event => {
    if (event.detail?.changed?.some(name => name === 'soundplaying' || name === 'activemedia-blocked' || name === 'muted')) refresh();
  });
  refresh();
}

export function detach(win) {
  const st = state.get(win);
  if (!st) return;
  state.delete(win);
  st.alive = false;
  st.unfollow();
  for (const undo of st.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
}

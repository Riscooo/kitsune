/* Trusted Kitsune UI entry point. Never loaded in web content. */
{
  const { KitsuneAppearance } = ChromeUtils.importESModule('chrome://browser/content/kitsune-appearance.sys.mjs');
  KitsuneAppearance.start();
  KitsuneAppearance.decorate(window);
  // El inicio integrado (Windows y macOS), como about:home: sin su dirección en la barra.
  if (!gInitialPages.includes(KitsuneAppearance.integratedHome)) gInitialPages.push(KitsuneAppearance.integratedHome);
  // Usuarios en la misma ventana (contenedores), una vez por proceso.
  try {
    const { KitsuneUsers } = ChromeUtils.importESModule('chrome://browser/content/kitsune-users.sys.mjs');
    KitsuneUsers.start();
  } catch { /* sin usuarios, Kitsune sigue igual */ }
  // Espacios: grupos de pestañas que se ven por separado (como los de Zen).
  try {
    const { KitsuneSpaces } = ChromeUtils.importESModule('chrome://browser/content/kitsune-spaces.sys.mjs');
    void KitsuneSpaces.decorate(window).catch(() => {});
  } catch { /* sin espacios, Kitsune sigue igual */ }
  // Vista dividida (Ctrl+Alt+D) y modo compacto (Ctrl+Alt+C).
  try {
    const { KitsuneLayout } = ChromeUtils.importESModule('chrome://browser/content/kitsune-layout.sys.mjs');
    void KitsuneLayout.decorate(window).catch(() => {});
  } catch { /* sin atajos de distribución, Kitsune sigue igual */ }
  // Kitsune Zero (Ctrl+Alt+0): la ventana de cristal, en zero/ y separado de Kitsune.
  try {
    const { KitsuneZeroHost } = ChromeUtils.importESModule('chrome://browser/content/kitsune-zero-host.sys.mjs');
    void KitsuneZeroHost.decorate(window)?.catch?.(() => {});
  } catch { /* sin Zero, Kitsune sigue igual */ }
  // Traer de otro navegador (Zen, Firefox, Chrome…).
  try {
    const { KitsuneImport } = ChromeUtils.importESModule('chrome://browser/content/kitsune-import.sys.mjs');
    void KitsuneImport.decorate(window).catch(() => {});
  } catch { /* sin importar, Kitsune sigue igual */ }
  // Vista rápida: Alt+clic en un enlace lo abre flotando sobre la página.
  try {
    const { KitsuneGlance } = ChromeUtils.importESModule('chrome://browser/content/kitsune-glance.sys.mjs');
    KitsuneGlance.start();
  } catch { /* sin vista rápida, Kitsune sigue igual */ }
  // Paleta (Ctrl+K): pestañas, espacios, acciones con su atajo, marcadores e historial.
  try {
    const { KitsunePalette } = ChromeUtils.importESModule('chrome://browser/content/kitsune-palette.sys.mjs');
    void KitsunePalette.decorate(window).catch(() => {});
  } catch { /* sin paleta, Kitsune sigue igual */ }
  // Modo ahorro a la vista: la RAM en la barra y su panel.
  try {
    const { KitsuneSaver } = ChromeUtils.importESModule('chrome://browser/content/kitsune-saver.sys.mjs');
    void KitsuneSaver.decorate(window).catch(() => {});
  } catch { /* sin medidor, el modo ahorro sigue igual */ }
  // Lo que suena en otra pestaña: título, carátula y botones (como en Zen).
  try {
    const { KitsuneMedia } = ChromeUtils.importESModule('chrome://browser/content/kitsune-media.sys.mjs');
    void KitsuneMedia.decorate(window).catch(() => {});
  } catch { /* sin tarjeta, la música sigue igual */ }
  // Retoques de aspecto y de manejo, de un clic (como los Mods de Zen).
  try {
    const { KitsuneRetoques } = ChromeUtils.importESModule('chrome://browser/content/kitsune-retoques.sys.mjs');
    void KitsuneRetoques.decorate(window).catch(() => {});
  } catch { /* sin retoques */ }
  // Atajos de teclado a tu gusto (después de los módulos que ponen los suyos).
  try {
    const { KitsuneKeys } = ChromeUtils.importESModule('chrome://browser/content/kitsune-keys.sys.mjs');
    void KitsuneKeys.decorate(window).catch(() => {});
  } catch { /* con los atajos de serie */ }
  // Copia de Kitsune: tus cosas en un archivo cifrado, para otro ordenador.
  try {
    const { KitsuneCopia } = ChromeUtils.importESModule('chrome://browser/content/kitsune-copia.sys.mjs');
    void KitsuneCopia.decorate(window).catch(() => {});
  } catch { /* sin copia, Kitsune sigue igual */ }
  // Aviso de versión nueva (solo en los paquetes que se descargan: Windows, macOS y Linux).
  try {
    const { KitsuneUpdates } = ChromeUtils.importESModule('chrome://browser/content/kitsune-updates.sys.mjs');
    KitsuneUpdates.start();
    KitsuneUpdates.decorate(window);
  } catch { /* sin aviso, Kitsune sigue igual */ }
}

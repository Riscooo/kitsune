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
  // Aviso de versión nueva (solo en los paquetes que se descargan: Windows, macOS y Linux).
  try {
    const { KitsuneUpdates } = ChromeUtils.importESModule('chrome://browser/content/kitsune-updates.sys.mjs');
    KitsuneUpdates.start();
    KitsuneUpdates.decorate(window);
  } catch { /* sin aviso, Kitsune sigue igual */ }
}

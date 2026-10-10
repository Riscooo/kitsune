/* Trusted Kitsune UI entry point. Never loaded in web content. */
{
  const { KitsuneAppearance } = ChromeUtils.importESModule('chrome://browser/content/kitsune-appearance.sys.mjs');
  KitsuneAppearance.start();
  KitsuneAppearance.decorate(window);
  // El inicio integrado (Windows y macOS), como about:home: sin su dirección en la barra.
  if (!gInitialPages.includes(KitsuneAppearance.integratedHome)) gInitialPages.push(KitsuneAppearance.integratedHome);
  // Aviso de versión nueva (solo en los instaladores de Windows y macOS).
  try {
    const { KitsuneUpdates } = ChromeUtils.importESModule('chrome://browser/content/kitsune-updates.sys.mjs');
    KitsuneUpdates.start();
    KitsuneUpdates.decorate(window);
  } catch { /* sin aviso, Kitsune sigue igual */ }
}

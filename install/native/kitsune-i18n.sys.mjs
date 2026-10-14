/* Textos de Kitsune en el idioma de su interfaz: castellano si Kitsune está en castellano
 * (es-*) y, si no, inglés. Las dos versiones van juntas en cada sitio, t('…', '…'), para
 * que no se pierda ninguna; no hay más idiomas que los del motor (en-US y es-ES).
 */
export const isSpanish = (locale = Services.locale.appLocaleAsBCP47) => /^es\b/i.test(locale ?? '');
export const t = (spanish, english) => (isSpanish() ? spanish : english);

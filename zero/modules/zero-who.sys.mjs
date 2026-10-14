/* Kitsune Zero · de quién es una pestaña.
 *
 * Kitsune lleva a cada usuario en un contenedor de Gecko (el usuario base, sin contenedor). Zero lo
 * enseña con el color de Gecko para ese contenedor (identity-color-…), que Kitsune ya tiñe con la
 * tinta del usuario: así se ve igual que en la cabecera de Kitsune.
 */

/** El usuario de una pestaña: { id, name, color }, o null si es el base. */
export function userOf(win, tab) {
  const id = Number(tab?.getAttribute('usercontextid') || 0);
  if (!id) return null;
  try {
    const identities = win.ContextualIdentityService;
    const identity = identities.getPublicIdentityFromId(id);
    return identity ? { id, color: identity.color, name: identities.getUserContextLabel(id) } : null;
  } catch { return null; }
}

/** Pone en `node` la clase de color de su usuario (y quita la que tuviera). */
export function paintUser(node, who) {
  for (const name of [...node.classList]) if (name.startsWith('identity-color-')) node.classList.remove(name);
  if (who) node.classList.add(`identity-color-${who.color}`);
}

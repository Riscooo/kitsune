/* Oscurecer las webs claras (proceso principal). Al actor de cada web no le llegan los avisos de preferencias ni
 * de sharedData (Risco, 21-10): kitsune-appearance.sys.mjs le avisa con un mensaje («KitsuneOscurecer:Recheck»,
 * con la lista de webs que no se oscurecen), y esta mitad solo hace falta para poder enviarlo. */
export class KitsuneOscurecerParent extends JSWindowActorParent {}

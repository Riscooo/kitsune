(function() {
	//#region start/bridge.mjs
	const api = globalThis.browser?.kitsuneHome;
	const integrated = Boolean(api);
	const images = /* @__PURE__ */ new Map();
	if (api) {
		const networkFetch = globalThis.fetch.bind(globalThis);
		globalThis.fetch = async (input, init = {}) => {
			const url = new URL(typeof input === "string" ? input : input.url, location.href);
			if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return networkFetch(input, init);
			if (init.signal?.aborted) throw new DOMException("La petición se ha cancelado.", "AbortError");
			const reply = await api.request(String(init.method ?? "GET"), url.pathname, typeof init.body === "string" ? init.body : void 0);
			return new Response(reply.bytes ?? reply.body ?? "", {
				status: reply.status,
				headers: { "Content-Type": reply.contentType ?? "application/json; charset=utf-8" }
			});
		};
	}
	/** Dirección para <img> o url() de una imagen de /api/: en el integrado, un blob local. */
	async function imageUrl(path) {
		if (!api || !path.startsWith("/api/")) return path;
		if (images.has(path)) return images.get(path);
		const reply = await api.request("GET", path);
		if (reply.status !== 200 || !reply.bytes) throw new Error("La imagen no está disponible.");
		const url = URL.createObjectURL(new Blob([reply.bytes], { type: reply.contentType }));
		images.set(path, url);
		return url;
	}
	//#endregion
	//#region start/en.mjs
	var en_default = Object.freeze({
		"Kitsune · Inicio": "Kitsune · Home",
		"Personalizar inicio": "Customize home",
		"Usuarios": "Users",
		"Usuarios de Kitsune": "Kitsune users",
		"Hola": "Hi",
		"Gestionar usuarios": "Manage users",
		"Cambiar de usuario en esta pestaña": "Switch user in this tab",
		"Añadir usuario": "Add user",
		"Kitsune, inicio": "Kitsune, home",
		"Bienvenida": "Welcome",
		"Bienvenido": "Welcome",
		"Fecha y hora": "Date and time",
		"Buscar": "Search",
		"Buscar en Google o escribir una dirección": "Search Google or type an address",
		"Buscar en Google o escribir una URL": "Search Google or type a URL",
		"Tipo de búsqueda": "Search type",
		"Todo": "All",
		"Imágenes": "Images",
		"Vídeos": "Videos",
		"Mapas": "Maps",
		"Ver el informe": "See the report",
		"La búsqueda es demasiado larga.": "The search is too long.",
		"Escribe una dirección web o una búsqueda, no código ni rutas internas.": "Type a web address or a search, not code or internal paths.",
		"La búsqueda funciona sin JavaScript. Actívalo para personalizar el inicio.": "Search works without JavaScript. Turn it on to customize your home.",
		"Accesos": "Shortcuts",
		"Editar": "Edit",
		"Listo": "Done",
		"Accesos rápidos": "Quick shortcuts",
		"Abrir el inicio completo de Kitsune →": "Open the full Kitsune home →",
		"Enfoque": "Focus",
		"Salir de enfoque": "Leave focus",
		"Atajos": "Shortcuts",
		"Nuevo acceso": "New shortcut",
		"Editar acceso": "Edit shortcut",
		"Añadir": "Add",
		"Cerrar": "Close",
		"Nombre": "Name",
		"Mi sitio": "My site",
		"Dirección": "Address",
		"Eliminar": "Delete",
		"Guardar": "Save",
		"Acceso guardado.": "Shortcut saved.",
		"Acceso eliminado.": "Shortcut deleted.",
		"Escribe un nombre para este acceso.": "Type a name for this shortcut.",
		"Escribe una dirección válida.": "Type a valid address.",
		"Puedes guardar hasta 12 accesos.": "You can save up to 12 shortcuts.",
		"Este acceso cambió en otra ventana. Revisa el borrador y vuelve a guardar para confirmarlo.": "This shortcut changed in another window. Check the draft and save again to confirm.",
		"Este acceso se eliminó en otra ventana. Créalo de nuevo si quieres recuperarlo.": "This shortcut was deleted in another window. Create it again if you want it back.",
		"No se ha confirmado. El borrador sigue aquí; puedes volver a guardar.": "Not confirmed. The draft is still here; you can save again.",
		"Tu inicio": "Your home",
		"Cerrar ajustes": "Close settings",
		"Ajustes del inicio": "Home settings",
		"Apariencia": "Appearance",
		"Módulos": "Modules",
		"Navegación": "Browsing",
		"Reintentar conexión": "Retry connection",
		"Guardado en este perfil": "Saved in this profile",
		"Guardando…": "Saving…",
		"Sin conexión": "Offline",
		"Conectado. Puedes volver a guardar.": "Connected. You can save again.",
		"Sin conexión con los ajustes. Puedes seguir navegando.": "No connection to the settings. You can keep browsing.",
		"No se ha podido conectar con los ajustes.": "Could not connect to the settings.",
		"No se ha podido leer el guardado.": "Could not read what was saved.",
		"Respuesta de ajustes no válida.": "Invalid settings response.",
		"Otra ventana sigue cambiando estos ajustes. Revisa el estado y vuelve a guardar.": "Another window is still changing these settings. Check the state and save again.",
		"No se ha confirmado el guardado. Tus últimos ajustes confirmados siguen aquí.": "Saving was not confirmed. Your last confirmed settings are still here.",
		"Tema": "Theme",
		"Claro": "Light",
		"Papel y tinta": "Paper and ink",
		"Oscuro": "Dark",
		"Tinta sumi": "Sumi ink",
		"Se aplica a todo el navegador: barras, menús, ajustes y las webs que tienen modo oscuro.": "It applies to the whole browser: toolbars, menus, settings and the sites that have a dark mode.",
		"Tinta": "Ink",
		"Papel": "Paper",
		"Bambú": "Bamboo",
		"Índigo": "Indigo",
		"Noche y oro": "Night and gold",
		"Arena": "Sand",
		"Los colores de todo Kitsune, en Claro y en Oscuro. Cada tinta se lee al menos tan bien como Papel.": "The colors of all of Kitsune, in Light and in Dark. Every ink reads at least as well as Paper.",
		"Tema aplicado al navegador.": "Theme applied to the browser.",
		"Aplicando el tema al navegador…": "Applying the theme to the browser…",
		"Color aplicado al inicio. El tema del navegador no está disponible.": "Color applied to the home. The browser theme is not available.",
		"No se ha podido actualizar el tema. Reintentando…": "Could not update the theme. Retrying…",
		"Fondo": "Background",
		"Sin fondo": "No background",
		"Elegir imagen": "Choose image",
		"Quitar fondo": "Remove background",
		"PNG, JPG o WebP · hasta 12 MB. Se ve en el inicio y en las pestañas nuevas.": "PNG, JPG or WebP · up to 12 MB. It shows on the home page and on new tabs.",
		"Fondos de serie": "Built-in backgrounds",
		"Original": "Original",
		"Fondo puesto.": "Background set.",
		"Fondo quitado.": "Background removed.",
		"Fondo original.": "Original background.",
		"Preparando el fondo…": "Preparing the background…",
		"Elige una imagen PNG, JPEG o WebP.": "Choose a PNG, JPEG or WebP image.",
		"La imagen es demasiado grande. Elige una de hasta 12 MB.": "The image is too large. Choose one up to 12 MB.",
		"No se ha podido leer la imagen.": "Could not read the image.",
		"No se ha podido guardar el fondo.": "Could not save the background.",
		"No se ha confirmado el fondo. Vuelve a intentarlo.": "The background was not confirmed. Try again.",
		"No se ha podido cambiar el fondo.": "Could not change the background.",
		"La imagen no está disponible.": "The image is not available.",
		"Pestañas": "Tabs",
		"Dónde van": "Where they go",
		"Arriba, como siempre, o en una barra al lado. Con «Iconos» la barra se queda estrecha y se abre al pasar el ratón.": "On top, as always, or in a bar at the side. With «Icons» the bar stays narrow and opens when you hover over it.",
		"Arriba": "Top",
		"Al lado": "Side",
		"Iconos": "Icons",
		"Ventana": "Window",
		"Botones de la ventana": "Window buttons",
		"Los puntos de Kitsune o los de tu sistema (Windows, Linux o macOS).": "Kitsune's dots or your system's (Windows, Linux or macOS).",
		"Del sistema": "System",
		"Botones de cerrar y ampliar": "Close and maximize buttons",
		"A qué lado de la barra de pestañas van.": "Which side of the tab bar they go on.",
		"Izquierda": "Left",
		"Derecha": "Right",
		"Botón de minimizar": "Minimize button",
		"El punto verde junto a cerrar y ampliar. En Niri no hace nada: ocúltalo si quieres.": "The green dot next to close and maximize. On Niri it does nothing: hide it if you like.",
		"Logo de Kitsune en la barra": "Kitsune logo in the bar",
		"El ensō y «KITSUNE» junto a las pestañas.": "The ensō and «KITSUNE» next to the tabs.",
		"Rendimiento": "Performance",
		"Modo": "Mode",
		"Ahorro duerme las pestañas que no usas, pone un límite de RAM y limita a 60 fps.": "Saver puts tabs you are not using to sleep, sets a RAM limit and caps at 60 fps.",
		"Normal": "Normal",
		"Ahorro": "Saver",
		"Límite de RAM": "RAM limit",
		"Al pasarlo, Kitsune duerme las pestañas más antiguas (vuelven al abrirlas).": "Above it, Kitsune puts the oldest tabs to sleep (they come back when you open them).",
		"Movimiento": "Motion",
		"Animaciones suaves": "Smooth animations",
		"La tinta se posa al abrir el inicio y el ensō gira mientras carga una pestaña.": "The ink settles when the home opens and the ensō spins while a tab loads.",
		"Mostrar en el inicio": "Show on the home page",
		"Reloj y fecha": "Clock and date",
		"Abrir accesos en otra pestaña": "Open shortcuts in another tab",
		"Ajustes del navegador": "Browser settings",
		"Búsqueda": "Search",
		"Privacidad": "Privacy",
		"Descargas": "Downloads",
		"Extensiones": "Extensions",
		"Contraseñas": "Passwords",
		"Todos los ajustes": "All settings",
		"Cargando…": "Loading…",
		"Apertura solicitada en este perfil.": "Opening requested in this profile.",
		"No se ha podido leer el perfil actual.": "Could not read the current profile.",
		"Perfil no disponible.": "Profile not available.",
		"El perfil cambió. Vuelve a pulsar para abrir el ajuste.": "The profile changed. Click again to open the setting.",
		"No se ha podido confirmar la apertura. Puedes volver a intentarlo.": "Could not confirm the opening. You can try again.",
		"No se ha podido abrir el ajuste.": "Could not open the setting.",
		"La petición se ha cancelado.": "The request was cancelled.",
		"Direcciones": "Addresses",
		"Buscar aquí": "Search here",
		"Nueva pestaña": "New tab",
		"Recuperar pestaña": "Reopen tab",
		"Mayús": "Shift",
		"Ventana privada": "Private window",
		"Cerrar usuarios": "Close users",
		"Cada usuario tiene sus sesiones y cookies. Historial, marcadores y contraseñas son comunes.": "Each user has their own sessions and cookies. History, bookmarks and passwords are shared.",
		"Actualizar lista": "Refresh list",
		"Tus usuarios": "Your users",
		"USUARIOS": "USERS",
		"Seleccionar usuario": "Select user",
		"Detalles del usuario": "User details",
		"Cargando usuarios…": "Loading users…",
		"Esta pestaña": "This tab",
		"Principal": "Main",
		"Usuario": "User",
		"Cambiar a este usuario": "Switch to this user",
		"Cambiar en esta pestaña": "Switch in this tab",
		"Privacidad de Kitsune": "Kitsune privacy",
		"Estricto": "Strict",
		"Cómodo": "Comfortable",
		"Cuenta de Google": "Google account",
		"Entrar en Google": "Sign in to Google",
		"Si la sesión ya se borró, vuelve a entrar en Google.": "If the session was already cleared, sign in to Google again.",
		"Los usuarios no bloquean a quien use tu misma sesión del sistema.": "Users do not lock out someone using your same system session.",
		"Nuevo usuario": "New user",
		"Editar usuario": "Edit user",
		"Elegir foto": "Choose photo",
		"Quitar foto": "Remove photo",
		"PNG, JPG o WebP · hasta 8 MB": "PNG, JPG or WebP · up to 8 MB",
		"Personal o trabajo": "Personal or work",
		"Correo": "Email",
		"opcional": "optional",
		"tu@correo.com": "you@email.com",
		"Correo del usuario; no inicia sesión.": "The user's email; it does not sign in.",
		"Privacidad de Kitsune (todos los usuarios)": "Kitsune privacy (all users)",
		"Modo de privacidad": "Privacy mode",
		"Borra cookies y sesiones al cerrar. Bloqueo estricto y anti-huella.": "Clears cookies and sessions on close. Strict blocking and anti-fingerprinting.",
		"Conserva las sesiones al cerrar y rompe menos webs. Sin telemetría.": "Keeps sessions on close and breaks fewer sites. No telemetry.",
		"Se aplica al volver a abrir Kitsune.": "It applies when Kitsune opens again.",
		"Recordar sesión de Google": "Remember Google session",
		"Conservar Google al cerrar; no inicia sesión.": "Keep Google on close; it does not sign in.",
		"En modo Cómodo las sesiones ya se conservan.": "In Comfortable mode sessions are already kept.",
		"En modo Cómodo las sesiones ya se conservan al cerrar.": "In Comfortable mode sessions are already kept on close.",
		"Abre este perfil para aplicar la conservación de Google.": "Open this profile to apply the Google retention.",
		"Sin conservación de Google activada en Kitsune.": "No Google retention turned on in Kitsune.",
		"Se conservará la sesión de Google en este perfil.": "The Google session will be kept in this profile.",
		"Kitsune no gestiona esta excepción; Google se conserva por tus ajustes de privacidad.": "Kitsune does not manage this exception; Google is kept by your privacy settings.",
		"Sin una excepción de Google gestionada por Kitsune.": "No Google exception managed by Kitsune.",
		"Aplicando…": "Applying…",
		"Pendiente de aplicar. Abre o reinicia este perfil para completarlo.": "Waiting to apply. Open or restart this profile to finish.",
		"Color del usuario": "User color",
		"Azul luna": "Moon blue",
		"Rosa sakura": "Sakura pink",
		"Violeta nocturno": "Night violet",
		"Verde jade": "Jade green",
		"Ámbar": "Amber",
		"Rojo torii": "Torii red",
		"Cancelar": "Cancel",
		"Crear usuario": "Create user",
		"Guardar cambios": "Save changes",
		"Se guarda en este equipo.": "It is saved on this computer.",
		"Con sus propias sesiones y cookies. Historial, marcadores y contraseñas son comunes.": "With their own sessions and cookies. History, bookmarks and passwords are shared.",
		"Sus sesiones no cambian.": "Their sessions do not change.",
		"Aceptar": "Accept",
		"Borra cookies, sesiones y caché al cerrar. Bloqueo estricto de rastreadores, anti-huella y solo HTTPS.": "Clears cookies, sessions and cache on close. Strict tracker blocking, anti-fingerprinting and HTTPS only.",
		"Conserva sesiones y cookies al cerrar. Bloqueo estándar que rompe menos webs. Sin telemetría.": "Keeps sessions and cookies on close. Standard blocking that breaks fewer sites. No telemetry.",
		"Seguirás con tus cuentas abiertas al volver, pero las webs podrán reconocerte entre visitas.": "You will stay signed in when you come back, but sites will be able to recognize you between visits.",
		"Al cerrar Kitsune se cerrarán tus sesiones: tendrás que volver a entrar en tus cuentas. Alguna web puede fallar.": "When Kitsune closes, your sessions will be closed: you will have to sign in to your accounts again. Some site may break.",
		"Has llegado al límite de 24 usuarios.": "You have reached the limit of 24 users.",
		"Abre el inicio completo de Kitsune para gestionar los usuarios de este equipo.": "Open the full Kitsune home to manage the users of this computer.",
		"Los usuarios no están disponibles en la copia de emergencia del inicio.": "Users are not available in the emergency copy of the home.",
		"Actualizando tus usuarios…": "Updating your users…",
		"No se ha podido conectar con los usuarios. Tu navegación sigue funcionando.": "Could not connect to the users. Your browsing keeps working.",
		"No hemos podido cargar tus usuarios.": "We could not load your users.",
		"La lista ha cambiado. Revisa el usuario y vuelve a intentarlo.": "The list has changed. Check the user and try again.",
		"Otra pestaña ha cambiado los usuarios. Tu borrador se conserva; revísalo y guarda de nuevo.": "Another tab changed the users. Your draft is kept; check it and save again.",
		"No se han guardado los cambios. Revisa los datos o elige otra foto.": "The changes were not saved. Check the details or choose another photo.",
		"No se ha confirmado el guardado. Actualiza la lista; tu borrador se conserva.": "Saving was not confirmed. Refresh the list; your draft is kept.",
		"Preparando foto…": "Preparing photo…",
		"Lista para guardar.": "Ready to save.",
		"La foto se quitará al guardar.": "The photo will be removed when you save.",
		"Creando tu nuevo espacio…": "Creating your new space…",
		"Guardando los detalles…": "Saving the details…",
		"Detalles guardados en este equipo.": "Details saved on this computer.",
		"Usuario creado. Cámbiate a él cuando quieras.": "User created. Switch to it whenever you like.",
		"Usuario actualizado.": "User updated.",
		"Usuario creado.": "User created.",
		"No se ha podido cambiar de usuario. Vuelve a intentarlo.": "Could not switch user. Try again.",
		"Abriendo…": "Opening…",
		"Abierto en una pestaña nueva.": "Opened in a new tab.",
		"Selección cancelada. Puedes volver a elegir una foto.": "Selection cancelled. You can choose a photo again.",
		"No se puede leer la imagen. Elige un PNG, JPG o WebP válido.": "The image cannot be read. Choose a valid PNG, JPG or WebP.",
		"La foto debe tener como máximo 16 megapíxeles y 8192 px por lado.": "The photo must be at most 16 megapixels and 8192 px per side.",
		"Elige una foto de hasta 8 MB.": "Choose a photo up to 8 MB.",
		"Usa PNG, JPG o WebP. No se admiten SVG ni otros formatos.": "Use PNG, JPG or WebP. SVG and other formats are not supported.",
		"El formato de la foto no coincide con su contenido.": "The photo's format does not match its content.",
		"No se ha podido abrir esa foto. Prueba con otra imagen.": "Could not open that photo. Try another image.",
		"La foto es demasiado grande para procesarla.": "The photo is too large to process.",
		"No se ha podido preparar la foto.": "Could not prepare the photo.",
		"La foto tiene demasiado detalle. Prueba una imagen más sencilla o sin transparencia.": "The photo has too much detail. Try a simpler image or one without transparency.",
		"Ponle un nombre de entre 1 y 48 caracteres, sin caracteres de control.": "Give it a name of 1 to 48 characters, without control characters.",
		"Escribe un correo válido, sin espacios, o deja la etiqueta vacía.": "Type a valid email, without spaces, or leave the label empty.",
		"Elige uno de los seis colores del perfil.": "Choose one of the six profile colors.",
		"Usuario no válido": "Invalid user",
		"Cada acceso necesita un nombre de hasta 36 caracteres.": "Each shortcut needs a name of up to 36 characters.",
		"Se permiten hasta 12 accesos.": "Up to 12 shortcuts are allowed.",
		"Solo se admiten direcciones http o https sin credenciales.": "Only http or https addresses without credentials are allowed.",
		"Elige una foto PNG, JPEG o WebP.": "Choose a PNG, JPEG or WebP photo.",
		"Usa una foto estática PNG, JPEG o WebP.": "Use a still PNG, JPEG or WebP photo.",
		"Usa una imagen estática PNG, JPEG o WebP.": "Use a still PNG, JPEG or WebP image.",
		"La foto es demasiado grande. Elige una imagen de hasta 1,5 MB.": "The photo is too big. Choose an image of up to 1.5 MB.",
		"La foto tiene demasiada resolución. Usa una imagen de hasta 16 megapíxeles.": "The photo has too high a resolution. Use an image of up to 16 megapixels.",
		"La imagen tiene demasiada resolución. Usa una de hasta 50 megapíxeles.": "The image has too high a resolution. Use one of up to 50 megapixels.",
		"No se ha podido leer esta foto. Elige otra imagen PNG, JPEG o WebP.": "This photo could not be read. Choose another PNG, JPEG or WebP image.",
		"No se ha podido leer esta imagen. Elige otra PNG, JPEG o WebP.": "This image could not be read. Choose another PNG, JPEG or WebP.",
		"No se ha podido leer la foto.": "The photo could not be read.",
		"No se ha podido reducir la foto al tamaño permitido.": "The photo could not be reduced to the allowed size.",
		"No se ha podido reducir la imagen al tamaño permitido.": "The image could not be reduced to the allowed size.",
		"La foto guardada no se puede verificar. Elige otra foto.": "The saved photo cannot be verified. Choose another photo.",
		"Falta el componente local para procesar fotos.": "The local component that processes photos is missing.",
		"Falta el componente local para procesar imágenes.": "The local component that processes images is missing.",
		"El fondo de serie está dañado; vuelve a instalar Kitsune.": "The built-in background is damaged; install Kitsune again.",
		"Ese fondo de serie no está disponible.": "That built-in background is not available.",
		"Esa tinta no está en el catálogo.": "That ink is not in the catalog.",
		"Escribe un nombre de entre 1 y 48 caracteres.": "Type a name of 1 to 48 characters.",
		"Escribe un correo válido o deja este campo vacío. Es una etiqueta local, no una cuenta verificada.": "Type a valid email or leave this field empty. It is a local label, not a verified account.",
		"No se ha encontrado ese perfil.": "That profile was not found.",
		"No se ha podido abrir el perfil. Sus datos siguen guardados.": "The profile could not be opened. Its data is still saved.",
		"No hay un puerto local disponible para otro perfil.": "There is no local port free for another profile.",
		"Los perfiles locales no están disponibles.": "Local profiles are not available.",
		"El registro local de perfiles necesita revisión. No se ha sobrescrito.": "The local profile registry needs checking. It has not been overwritten.",
		"Los ajustes han cambiado en otra pestaña.": "The settings changed in another tab.",
		"Los ajustes cambian sin parar.": "The settings keep changing.",
		"Los ajustes locales no están disponibles.": "Local settings are not available.",
		"No se han podido guardar los ajustes locales.": "The local settings could not be saved.",
		"La apariencia nativa no está disponible en esta instalación.": "Native appearance is not available in this installation."
	});
	//#endregion
	//#region start/idioma.mjs
	const STORAGE = "kitsune-idioma";
	const ATTRIBUTES = [
		"placeholder",
		"aria-label",
		"title",
		"alt"
	];
	const spanish = (locale) => /^es\b/i.test(locale ?? "es");
	let saved = null;
	try {
		saved = localStorage.getItem(STORAGE);
	} catch {}
	let english = !spanish(saved);
	const tr = (es, en) => english ? en : es;
	const normalize = (text) => text.replace(/\s+/g, " ").trim();
	function translateText(node) {
		const key = normalize(node.nodeValue);
		const value = key && en_default[key];
		if (value) node.nodeValue = node.nodeValue.replace(/\S[\s\S]*\S|\S/, value);
	}
	function translateElement(element) {
		for (const name of ATTRIBUTES) {
			const value = element.getAttribute?.(name);
			if (value && en_default[normalize(value)]) element.setAttribute(name, en_default[normalize(value)]);
		}
	}
	/** Traduce lo que haya en `root` (texto y atributos) que esté en el diccionario. */
	function translate(root) {
		if (!english || !root) return;
		if (root.nodeType === Node.TEXT_NODE) {
			translateText(root);
			return;
		}
		if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
		if (root.nodeType === Node.ELEMENT_NODE) translateElement(root);
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.nodeType === Node.TEXT_NODE) {
			if (!["SCRIPT", "STYLE"].includes(node.parentElement?.tagName)) translateText(node);
		} else translateElement(node);
	}
	async function initializeLanguage({ fetcher = (...args) => globalThis.fetch(...args) } = {}) {
		if (english) {
			document.documentElement.lang = "en";
			if (en_default[normalize(document.title)]) document.title = en_default[normalize(document.title)];
			translate(document.body);
			new MutationObserver((records) => {
				for (const record of records) if (record.type === "characterData") translateText(record.target);
				else if (record.type === "attributes") translateElement(record.target);
				else for (const node of record.addedNodes) translate(node);
			}).observe(document.body, {
				subtree: true,
				childList: true,
				characterData: true,
				attributes: true,
				attributeFilter: ATTRIBUTES
			});
		}
		if (location.protocol === "file:") return;
		try {
			const { locale } = await (await fetcher("/api/idioma", {
				credentials: "omit",
				cache: "no-store",
				signal: AbortSignal.timeout(4e3)
			})).json();
			if (typeof locale !== "string") return;
			let stored = false;
			try {
				localStorage.setItem(STORAGE, locale);
				stored = localStorage.getItem(STORAGE) === locale;
			} catch {}
			if (stored && spanish(locale) === english) location.reload();
		} catch {}
	}
	//#endregion
	//#region start/navigation.mjs
	const MODES = /* @__PURE__ */ new Set([
		"all",
		"images",
		"videos",
		"maps"
	]);
	function googleSearch(query, mode = "all") {
		const url = new URL(mode === "maps" ? "https://www.google.com/maps/search/" : "https://www.google.com/search");
		url.searchParams.set(mode === "maps" ? "query" : "q", query);
		if (mode === "maps") url.searchParams.set("api", "1");
		if (mode === "images") url.searchParams.set("udm", "2");
		if (mode === "videos") url.searchParams.set("tbm", "vid");
		return url.href;
	}
	function safeLink(input) {
		const value = String(input || "").trim();
		if (!value || value.length > 4096) throw new Error("Escribe una dirección válida.");
		const withScheme = /^(https?):\/\//i.test(value) ? value : `https://${value}`;
		let url;
		try {
			url = new URL(withScheme);
		} catch {
			throw new Error("Revisa la dirección. Por ejemplo: https://example.com");
		}
		if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname || /\s/.test(value)) throw new Error("Usa una dirección web http o https, sin contraseñas.");
		if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^https?:\/\//i.test(value) && !/^[^/:]+:\d+(?:\/|$)/.test(value)) throw new Error("Solo se admiten direcciones web http o https.");
		return url.href;
	}
	function resolveNavigation(input, mode = "all") {
		const value = String(input || "").trim();
		if (!value) return null;
		if (value.length > 4096) throw new Error("La búsqueda es demasiado larga.");
		if (/^(?:javascript|data|file|vbscript|about|chrome|resource|blob):/i.test(value)) throw new Error("Escribe una dirección web o una búsqueda, no código ni rutas internas.");
		if (/^https?:/i.test(value)) return {
			url: safeLink(value),
			kind: "address"
		};
		if (!/\s/.test(value) && (/^(?:localhost|127\.\d+\.\d+\.\d+|\[[:a-f\d]+\])(?::\d+)?(?:[/?#]|$)/i.test(value) || /^(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}(?::\d+)?(?:[/?#]|$)/u.test(value) || /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#]|$)/.test(value))) return {
			url: safeLink(`${/^(?:localhost|127\.\d+\.\d+\.\d+|\[::1\])(?::|\/|\?|#|$)/i.test(value) ? "http" : "https"}://${value}`),
			kind: "address"
		};
		return {
			url: googleSearch(value, MODES.has(mode) ? mode : "all"),
			kind: "search"
		};
	}
	const DEFAULT_LINKS = [
		{
			id: "youtube",
			name: "YouTube",
			url: "https://www.youtube.com/",
			color: "red",
			icon: "play"
		},
		{
			id: "gmail",
			name: "Gmail",
			url: "https://mail.google.com/",
			color: "blue",
			icon: "mail"
		},
		{
			id: "github",
			name: "GitHub",
			url: "https://github.com/",
			color: "white",
			icon: "code"
		},
		{
			id: "anime",
			name: "MyAnimeList",
			url: "https://myanimelist.net/",
			color: "violet",
			icon: "sparkles"
		},
		{
			id: "wiki",
			name: "Wikipedia",
			url: "https://es.wikipedia.org/",
			color: "teal",
			icon: "book"
		}
	];
	function cleanLinks(value) {
		if (!Array.isArray(value)) return DEFAULT_LINKS.map((item) => ({ ...item }));
		const ids = /* @__PURE__ */ new Set();
		return value.slice(0, 12).flatMap((item) => {
			try {
				if (!item || typeof item.name !== "string" || !item.name.trim() || typeof item.id !== "string" || ids.has(item.id)) return [];
				ids.add(item.id);
				return [{
					id: item.id.slice(0, 80),
					name: item.name.trim().slice(0, 36),
					url: safeLink(item.url),
					color: [
						"red",
						"blue",
						"white",
						"violet",
						"teal"
					].includes(item.color) ? item.color : "blue",
					icon: [
						"play",
						"mail",
						"code",
						"sparkles",
						"book"
					].includes(item.icon) ? item.icon : ""
				}];
			} catch {
				return [];
			}
		});
	}
	const TYPES = /* @__PURE__ */ new Set([
		"image/png",
		"image/jpeg",
		"image/webp"
	]);
	function safeAvatarURL(value, profileId) {
		if (typeof value !== "string" || typeof profileId !== "string") return null;
		const match = /^\/api\/profile-avatars\/(default|p-[0-9a-f]{16})\/([0-9a-f]{64})\.png$/u.exec(value);
		return match && match[1] === profileId ? value : null;
	}
	function validPhotoSize(width, height) {
		return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 16e6;
	}
	function inspectRaster(bytes) {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const word = (offset) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
		let type, width, height;
		if (bytes.length >= 24 && [
			137,
			80,
			78,
			71,
			13,
			10,
			26,
			10
		].every((byte, index) => bytes[index] === byte) && word(12) === "IHDR") {
			type = "image/png";
			width = view.getUint32(16);
			height = view.getUint32(20);
		} else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
			type = "image/jpeg";
			let offset = 2;
			while (offset + 8 < bytes.length) {
				if (bytes[offset++] !== 255) break;
				while (bytes[offset] === 255) offset++;
				const marker = bytes[offset++];
				if (marker === 217 || marker === 218) break;
				if (marker === 1 || marker >= 208 && marker <= 215) continue;
				if (offset + 2 > bytes.length) break;
				const length = view.getUint16(offset);
				if (length < 2 || offset + length > bytes.length) break;
				if ([
					192,
					193,
					194,
					195,
					197,
					198,
					199,
					201,
					202,
					203,
					205,
					206,
					207
				].includes(marker) && length >= 8) {
					height = view.getUint16(offset + 3);
					width = view.getUint16(offset + 5);
					break;
				}
				offset += length;
			}
		} else if (bytes.length >= 30 && word(0) === "RIFF" && word(8) === "WEBP") {
			type = "image/webp";
			for (let offset = 12; offset + 8 <= bytes.length;) {
				const chunk = word(offset), length = view.getUint32(offset + 4, true), payload = offset + 8;
				if (payload + length > bytes.length) break;
				if (chunk === "VP8X" && length >= 10) {
					width = 1 + bytes[payload + 4] + (bytes[payload + 5] << 8) + (bytes[payload + 6] << 16);
					height = 1 + bytes[payload + 7] + (bytes[payload + 8] << 8) + (bytes[payload + 9] << 16);
					break;
				}
				if (chunk === "VP8 " && length >= 10 && bytes[payload + 3] === 157 && bytes[payload + 4] === 1 && bytes[payload + 5] === 42) {
					width = view.getUint16(payload + 6, true) & 16383;
					height = view.getUint16(payload + 8, true) & 16383;
					break;
				}
				if (chunk === "VP8L" && length >= 5 && bytes[payload] === 47) {
					const bits = view.getUint32(payload + 1, true);
					width = 1 + (bits & 16383);
					height = 1 + (bits >>> 14 & 16383);
					break;
				}
				offset = payload + length + (length & 1);
			}
		}
		if (!type || !width || !height) throw new Error("No se puede leer la imagen. Elige un PNG, JPG o WebP válido.");
		if (!validPhotoSize(width, height)) throw new Error("La foto debe tener como máximo 16 megapíxeles y 8192 px por lado.");
		return {
			type,
			width,
			height
		};
	}
	async function prepareAvatar(file) {
		if (!file || !Number.isFinite(file.size) || file.size < 1 || file.size > 8388608) throw new Error("Elige una foto de hasta 8 MB.");
		if (!TYPES.has(file.type)) throw new Error("Usa PNG, JPG o WebP. No se admiten SVG ni otros formatos.");
		const bytes = new Uint8Array(await file.arrayBuffer());
		const metadata = inspectRaster(bytes);
		if (metadata.type !== file.type) throw new Error("El formato de la foto no coincide con su contenido.");
		let bitmap;
		try {
			bitmap = await createImageBitmap(new Blob([bytes], { type: metadata.type }), { imageOrientation: "from-image" });
		} catch {
			throw new Error("No se ha podido abrir esa foto. Prueba con otra imagen.");
		}
		try {
			if (!validPhotoSize(bitmap.width, bitmap.height)) throw new Error("La foto es demasiado grande para procesarla.");
			const canvas = document.createElement("canvas");
			canvas.width = canvas.height = 256;
			const context = canvas.getContext("2d", {
				alpha: true,
				willReadFrequently: true
			});
			if (!context) throw new Error("No se ha podido preparar la foto.");
			const side = Math.min(bitmap.width, bitmap.height);
			context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
			const pixels = context.getImageData(0, 0, 256, 256).data;
			let transparent = false;
			for (let index = 3; index < pixels.length; index += 4) if (pixels[index] !== 255) {
				transparent = true;
				break;
			}
			let data = canvas.toDataURL(transparent ? "image/png" : "image/jpeg", .88);
			if (!transparent) for (const quality of [
				.75,
				.6,
				.45,
				.3
			]) {
				if (data.length <= 131072) break;
				data = canvas.toDataURL("image/jpeg", quality);
			}
			if (data.length > 131072) throw new Error("La foto tiene demasiado detalle. Prueba una imagen más sencilla o sin transparencia.");
			return data;
		} finally {
			bitmap.close();
		}
	}
	function paintAvatar(node, profile, initials, previewData) {
		node.dataset.profileColor = profile.color;
		node.textContent = initials;
		const source = previewData === void 0 ? safeAvatarURL(profile.avatar, profile.id) : previewData;
		if (!source) return;
		if (previewData !== void 0 && (typeof source !== "string" || source.length > 131072 || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/u.test(source))) return;
		const image = document.createElement("img");
		image.alt = "";
		image.hidden = true;
		image.decoding = "async";
		image.referrerPolicy = "no-referrer";
		image.addEventListener("load", () => {
			if (node.contains(image)) {
				image.hidden = false;
				node.replaceChildren(image);
			}
		}, { once: true });
		image.addEventListener("error", () => {
			if (node.contains(image)) node.textContent = initials;
		}, { once: true });
		node.append(image);
		if (source.startsWith("/api/")) imageUrl(source).then((url) => {
			image.src = url;
		}).catch(() => {
			if (node.contains(image)) node.textContent = initials;
		});
		else image.src = source;
	}
	//#endregion
	//#region start/profiles.mjs
	/** Usuarios de Kitsune en la misma ventana (no son cuentas en línea): cada uno tiene sus
	* sesiones y cookies en su contenedor; el base (baseId) es el del perfil y el dueño de la
	* privacidad de todo Kitsune. Cada cambio lo confirma el servicio local antes de verse aquí. */
	const PROFILE_COLORS = Object.freeze([
		"blue",
		"pink",
		"violet",
		"teal",
		"amber",
		"red"
	]);
	const BAD_TEXT = /[\p{Cc}\p{Cs}]/u;
	function profileInitials(name) {
		const words = String(name || "").trim().split(/\s+/u).filter(Boolean);
		if (!words.length) return "K";
		return (([...words[0]][0] || "") + (words.length > 1 ? [...words.at(-1)][0] : "")).toLocaleUpperCase("es").slice(0, 6);
	}
	function validateProfileDraft(value) {
		const name = typeof value?.name === "string" ? value.name.trim() : "";
		const email = typeof value?.email === "string" ? value.email.trim() : "";
		if (!name || [...name].length > 48 || BAD_TEXT.test(name)) throw new Error("Ponle un nombre de entre 1 y 48 caracteres, sin caracteres de control.");
		if ([...email].length > 254 || /\s/u.test(email) || BAD_TEXT.test(email) || email && !/^[^@]+@[^@]+\.[^@]+$/u.test(email)) throw new Error("Escribe un correo válido, sin espacios, o deja la etiqueta vacía.");
		if (!PROFILE_COLORS.includes(value?.color)) throw new Error("Elige uno de los seis colores del perfil.");
		return {
			name,
			email,
			color: value.color
		};
	}
	function parseProfilesSnapshot(value) {
		if (!value || value.version !== 1 || typeof value.currentId !== "string" || typeof value.defaultId !== "string" || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.token !== "string" || !value.token || !Array.isArray(value.profiles) || value.profiles.length < 1 || value.profiles.length > 24) throw new Error("Invalid profiles response");
		const ids = /* @__PURE__ */ new Set();
		for (const item of value.profiles) {
			if (!item || typeof item.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/u.test(item.id) || ids.has(item.id) || typeof item.name !== "string" || !item.name.trim() || [...item.name].length > 48 || BAD_TEXT.test(item.name) || typeof item.email !== "string" || [...item.email].length > 254 || BAD_TEXT.test(item.email) || !PROFILE_COLORS.includes(item.color) || item.privacyMode !== void 0 && !Object.hasOwn(PRIVACY_MODES, item.privacyMode)) throw new Error("Invalid profile in response");
			ids.add(item.id);
		}
		if (!ids.has(value.currentId) || !ids.has(value.defaultId)) throw new Error("Invalid current/default profile");
		return value;
	}
	const PRIVACY_MODES = Object.freeze({
		estricto: "Estricto",
		comodo: "Cómodo"
	});
	const modeName = (mode) => tr(PRIVACY_MODES[mode], {
		estricto: "Strict",
		comodo: "Comfortable"
	}[mode]);
	const PRIVACY_EFFECTS = Object.freeze({
		comodo: "Seguirás con tus cuentas abiertas al volver, pero las webs podrán reconocerte entre visitas.",
		estricto: "Al cerrar Kitsune se cerrarán tus sesiones: tendrás que volver a entrar en tus cuentas. Alguna web puede fallar."
	});
	function privacyMode(profile) {
		return Object.hasOwn(PRIVACY_MODES, profile?.privacyMode) ? profile.privacyMode : "estricto";
	}
	function privacyModeStatus(profile, isCurrent, appearance) {
		const mode = privacyMode(profile);
		const label = tr(`Privacidad: ${modeName(mode)}`, `Privacy: ${modeName(mode)}`);
		if (!isCurrent) return tr(`${label} · se aplica al abrir este perfil`, `${label} · applies when this profile opens`);
		const active = appearance?.native?.status === "applied" ? appearance.native.privacyMode : void 0;
		if (!Object.hasOwn(PRIVACY_MODES, active ?? "")) return label;
		return active === mode ? tr(`${label} · activo`, `${label} · active`) : tr(`${label} · se aplicará al reiniciar Kitsune`, `${label} · applies when Kitsune restarts`);
	}
	function googleRetentionStatus(appearance, desired) {
		if (typeof desired !== "boolean" || appearance?.googleRemember !== desired || appearance.native?.status !== "applied") return null;
		const native = appearance.native;
		if (desired) return native.googleRemember === true ? "Se conservará la sesión de Google en este perfil." : null;
		if (native.googlePolicyManaged !== false) return null;
		return native.googleRemember === true ? "Kitsune no gestiona esta excepción; Google se conserva por tus ajustes de privacidad." : "Sin una excepción de Google gestionada por Kitsune.";
	}
	async function initializeProfiles({ announce = () => {}, onSnapshot = () => {}, switchTo = async () => false } = {}) {
		const $ = (selector) => document.querySelector(selector);
		const dialog = $("#profiles-dialog");
		if (!dialog) return;
		const trigger = $("#profiles-open");
		let snapshot = null;
		let selectedId = null;
		let ready = false;
		let busy = false;
		let formMode = null;
		let formId = null;
		let color = "blue";
		let returnFocus = trigger;
		let operationId = 0;
		let photoData;
		let originalPhoto = null;
		let photoBusy = false;
		let photoRequest = 0;
		let googleRequest = 0;
		let googleTimer;
		const selectedProfile = () => snapshot?.profiles.find((item) => item.id === selectedId);
		const baseId = () => snapshot?.baseId ?? snapshot?.currentId;
		const isBase = (profile) => Boolean(profile) && profile.id === baseId();
		const avatar = (node, profile, draft) => paintAvatar(node, profile, profileInitials(profile.name), draft);
		let formPrivacy = "estricto";
		/** Ventana breve con lo que hace cada modo y lo que supone el cambio. */
		function confirmPrivacy(to) {
			const popup = $("#privacy-dialog");
			if (!popup) return Promise.resolve(true);
			$("#privacy-dialog-title").textContent = tr(`¿Pasar a ${modeName(to)}?`, `Switch to ${modeName(to)}?`);
			$("#privacy-dialog-effect").textContent = PRIVACY_EFFECTS[to];
			popup.querySelectorAll(".privacy-card").forEach((card) => {
				card.dataset.target = String(card.dataset.mode === to);
			});
			popup.returnValue = "";
			return new Promise((resolve) => {
				popup.addEventListener("close", () => resolve(popup.returnValue === "accept"), { once: true });
				popup.showModal();
				$("#privacy-cancel").focus();
			});
		}
		function photoMessage(message = "PNG, JPG o WebP · hasta 8 MB", error = false) {
			const status = $("#profile-photo-status"), problem = $("#profile-photo-error");
			if (status) status.textContent = error ? "" : message;
			if (problem) {
				problem.textContent = error ? message : "";
				problem.hidden = !error;
			}
		}
		function cancelPhoto() {
			photoRequest++;
			if (photoBusy) photoMessage("Selección cancelada. Puedes volver a elegir una foto.");
			photoBusy = false;
			if ($("#profile-photo")) $("#profile-photo").value = "";
			renderControls();
		}
		function updateGoogleStatus() {
			clearTimeout(googleTimer);
			const request = ++googleRequest;
			const status = $("#profile-google-status");
			const profile = selectedProfile();
			if (!status || !profile || !dialog.open || formMode) return;
			const privacy = $("#profile-privacy-status");
			const relogin = $("#profile-google-relogin");
			status.hidden = !isBase(profile);
			if (privacy) privacy.hidden = !isBase(profile);
			if (!isBase(profile)) {
				if (relogin) relogin.hidden = true;
				return;
			}
			if (privacy) privacy.textContent = privacyModeStatus(profile, true);
			const desired = profile.rememberGoogle === true;
			const comfortable = privacyMode(profile) === "comodo";
			if (relogin) relogin.hidden = comfortable;
			if (comfortable) status.textContent = "En modo Cómodo las sesiones ya se conservan al cerrar.";
			else if (!isBase(profile)) {
				status.textContent = desired ? "Abre este perfil para aplicar la conservación de Google." : "Sin conservación de Google activada en Kitsune.";
				return;
			} else status.textContent = "Aplicando…";
			const started = performance.now();
			const check = async () => {
				try {
					const response = await fetch("/api/appearance", {
						credentials: "omit",
						cache: "no-store",
						signal: AbortSignal.timeout(4e3)
					});
					if (!response.ok) throw new Error("Native state unavailable");
					const appearance = await response.json();
					if (request !== googleRequest || !dialog.open || formMode) return;
					if (privacy) privacy.textContent = privacyModeStatus(profile, true, appearance);
					if (privacyMode(profile) === "comodo") return;
					const confirmed = googleRetentionStatus(appearance, desired);
					if (confirmed) {
						status.textContent = confirmed;
						return;
					}
				} catch {}
				if (request !== googleRequest || !dialog.open || formMode || comfortable) return;
				if (performance.now() - started >= 1e4) {
					status.textContent = "Pendiente de aplicar. Abre o reinicia este perfil para completarlo.";
					return;
				}
				googleTimer = setTimeout(check, 1e3);
			};
			check();
		}
		function notice(message = "", reload = false) {
			$("#profiles-message").textContent = message;
			$("#profiles-notice").hidden = !message;
			$("#profiles-reload").hidden = !reload;
		}
		function setBusy(value, message = "") {
			busy = value;
			dialog.setAttribute("aria-busy", String(value || photoBusy));
			$("#profiles-operation").textContent = message;
			renderControls();
		}
		function renderControls() {
			const blocked = busy || !ready;
			dialog.querySelectorAll("[data-privacy-switch]").forEach((button) => {
				button.disabled = blocked;
			});
			dialog.setAttribute("aria-busy", String(busy || photoBusy));
			$("#profile-create").disabled = blocked || Boolean(formMode) || snapshot?.profiles.length >= 24;
			$("#profile-create").title = snapshot?.profiles.length >= 24 ? "Has llegado al límite de 24 usuarios." : "";
			$("#profile-save").disabled = blocked || photoBusy;
			$("#profile-cancel").disabled = busy;
			$("#profile-name").disabled = busy;
			$("#profile-email").disabled = busy;
			$("#profiles-reload").disabled = busy;
			$("#profile-edit").disabled = blocked;
			$("#profile-open").disabled = blocked;
			dialog.querySelectorAll("[data-profile-id]").forEach((button) => {
				button.disabled = blocked || Boolean(formMode);
			});
			dialog.querySelectorAll("[data-profile-action]").forEach((button) => {
				button.disabled = blocked;
			});
			dialog.querySelectorAll("[data-profile-swatch]").forEach((button) => {
				button.disabled = busy;
			});
			if ($("#profile-photo")) $("#profile-photo").disabled = busy;
			if ($("#profile-photo-remove")) $("#profile-photo-remove").disabled = busy || !(photoData === void 0 ? originalPhoto : photoData);
			dialog.querySelectorAll("input[name=\"profile-privacy\"]").forEach((input) => {
				input.disabled = busy;
			});
			updatePrivacyForm();
		}
		function selectedPrivacy() {
			return dialog.querySelector("input[name=\"profile-privacy\"]:checked")?.value === "comodo" ? "comodo" : "estricto";
		}
		function updatePrivacyForm() {
			const remember = $("#profile-remember-google");
			if (!remember) return;
			const comfortable = selectedPrivacy() === "comodo";
			remember.disabled = busy || comfortable;
			const help = $("#profile-remember-google-help");
			if (help) help.textContent = comfortable ? "En modo Cómodo las sesiones ya se conservan." : "Conservar Google al cerrar; no inicia sesión.";
		}
		function renderList() {
			const list = $("#profiles-list");
			const focusedId = document.activeElement?.dataset.profileId;
			list.replaceChildren();
			for (const profile of snapshot?.profiles || []) {
				const button = document.createElement("button");
				button.type = "button";
				button.className = "profile-list-item";
				button.dataset.profileId = profile.id;
				button.setAttribute("aria-pressed", String(profile.id === selectedId));
				const glyph = document.createElement("span");
				glyph.className = "profile-avatar";
				glyph.setAttribute("aria-hidden", "true");
				avatar(glyph, profile);
				const copy = document.createElement("span");
				copy.className = "profile-list-copy";
				const name = document.createElement("b");
				name.textContent = profile.name;
				const hint = document.createElement("small");
				hint.textContent = profile.id === snapshot.currentId ? "Esta pestaña" : isBase(profile) ? "Principal" : "Usuario";
				copy.append(name, hint);
				button.append(glyph, copy);
				button.addEventListener("click", () => {
					if (busy || formMode || !ready) return;
					selectedId = profile.id;
					notice();
					$("#profiles-operation").textContent = "";
					render();
				});
				list.append(button);
			}
			$("#profiles-count").textContent = snapshot ? `${snapshot.profiles.length} / 24` : "—";
			if (focusedId && !formMode) [...list.children].find((button) => button.dataset.profileId === focusedId)?.focus({ preventScroll: true });
		}
		function render() {
			dialog.dataset.view = formMode ? "form" : "detail";
			const current = snapshot?.profiles.find((profile) => profile.id === snapshot.currentId);
			if (current) {
				avatar($("#current-profile-avatar"), current);
				$("#current-profile-name").textContent = current.name;
				$("#welcome-line").textContent = tr(`Bienvenido, ${current.name}`, `Welcome, ${current.name}`);
				trigger.setAttribute("aria-label", tr(`Usuarios. Esta pestaña es de ${current.name}`, `Users. This tab belongs to ${current.name}`));
				trigger.title = tr(`Esta pestaña es de ${current.name}`, `This tab belongs to ${current.name}`);
			}
			renderList();
			const profile = selectedProfile();
			$("#profiles-empty").hidden = Boolean(profile || formMode);
			$("#profile-detail").hidden = !profile || Boolean(formMode);
			$("#profile-form").hidden = !formMode;
			if (profile && !formMode) {
				avatar($("#profile-detail-avatar"), profile);
				$("#profile-detail-name").textContent = profile.name;
				$("#profile-detail-email").textContent = profile.email;
				$("#profile-detail-email").hidden = !profile.email;
				$("#profile-current-badge").hidden = profile.id !== snapshot.currentId;
				$("#profile-default-badge").hidden = !isBase(profile);
				$("#profile-open").hidden = profile.id === snapshot.currentId;
				$("#profile-open span").textContent = "Cambiar a este usuario";
				dialog.querySelector(".privacy-switch").hidden = !isBase(profile);
				dialog.querySelector("[data-profile-action=\"google\"]").hidden = profile.id !== snapshot.currentId;
				dialog.querySelectorAll("[data-privacy-switch]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.privacySwitch === privacyMode(profile))));
			}
			renderControls();
			updateGoogleStatus();
		}
		function accept(value) {
			snapshot = parseProfilesSnapshot(value);
			if (!snapshot.profiles.some((profile) => profile.id === selectedId)) selectedId = snapshot.currentId;
			ready = true;
			onSnapshot(snapshot);
		}
		async function load({ quiet = false } = {}) {
			if (busy) return;
			if (location.protocol === "file:") {
				ready = false;
				notice("Abre el inicio completo de Kitsune para gestionar los usuarios de este equipo.");
				$("#profiles-empty-copy").textContent = "Los usuarios no están disponibles en la copia de emergencia del inicio.";
				return;
			}
			setBusy(true, quiet ? "" : "Actualizando tus usuarios…");
			try {
				const response = await fetch("/api/profiles", {
					credentials: "omit",
					cache: "no-store",
					signal: AbortSignal.timeout(5e3)
				});
				if (!response.ok) throw new Error("Profiles unavailable");
				accept(await response.json());
				notice();
				render();
			} catch {
				ready = false;
				if (!quiet || dialog.open) notice("No se ha podido conectar con los usuarios. Tu navegación sigue funcionando.", true);
				$("#profiles-empty-copy").textContent = "No hemos podido cargar tus usuarios.";
			} finally {
				setBusy(false);
				document.documentElement.dataset.profilesReady = ready ? "true" : "false";
			}
		}
		async function mutate(path, method, data, pending) {
			if (busy || !ready) return null;
			setBusy(true, pending);
			notice();
			const requestId = ++operationId;
			try {
				const response = await fetch(path, {
					method,
					credentials: "omit",
					cache: "no-store",
					signal: AbortSignal.timeout(8e3),
					headers: {
						"Content-Type": "application/json",
						"X-Kitsune-Token": snapshot.token
					},
					body: JSON.stringify({
						...data,
						revision: snapshot.revision
					})
				});
				if (response.status === 409) {
					accept(await response.json());
					render();
					notice(formMode ? "Otra pestaña ha cambiado los usuarios. Tu borrador se conserva; revísalo y guarda de nuevo." : "La lista ha cambiado. Revisa el usuario y vuelve a intentarlo.");
					return null;
				}
				if (!response.ok) {
					if ([
						400,
						413,
						422
					].includes(response.status)) {
						notice("No se han guardado los cambios. Revisa los datos o elige otra foto.", true);
						return null;
					}
					throw new Error("Profile mutation not confirmed");
				}
				const result = await response.json();
				accept(result);
				render();
				return result;
			} catch {
				ready = false;
				notice("No se ha confirmado el guardado. Actualiza la lista; tu borrador se conserva.", true);
				return null;
			} finally {
				if (requestId === operationId) setBusy(false);
			}
		}
		function preview() {
			avatar($("#profile-preview-avatar"), {
				id: formId,
				name: $("#profile-name").value || "Nuevo usuario",
				color,
				avatar: originalPhoto
			}, photoData);
			dialog.querySelectorAll("[data-profile-swatch]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.profileSwatch === color)));
		}
		function showForm(profile = null) {
			if (busy || !ready) return;
			cancelPhoto();
			formMode = profile ? "edit" : "create";
			formId = profile?.id || null;
			color = profile?.color || PROFILE_COLORS[(snapshot?.profiles.length || 0) % PROFILE_COLORS.length];
			photoData = void 0;
			originalPhoto = profile?.avatar || null;
			photoMessage();
			if ($("#profile-remember-google")) $("#profile-remember-google").checked = profile?.rememberGoogle === true;
			dialog.querySelector(".profile-privacy").hidden = !isBase(profile);
			if ($("#profile-remember-google")) $("#profile-remember-google").closest("label").hidden = !isBase(profile);
			const mode = privacyMode(profile);
			formPrivacy = mode;
			dialog.querySelectorAll("input[name=\"profile-privacy\"]").forEach((input) => {
				input.checked = input.value === mode;
			});
			updatePrivacyForm();
			$("#profile-name").value = profile?.name || "";
			$("#profile-email").value = profile?.email || "";
			$("#profile-form-title").textContent = profile ? "Editar usuario" : "Nuevo usuario";
			$("#profile-save span").textContent = profile ? "Guardar cambios" : "Crear usuario";
			$("#profile-form-note").textContent = profile ? "Sus sesiones no cambian." : "Con sus propias sesiones y cookies. Historial, marcadores y contraseñas son comunes.";
			$("#profile-form-error").hidden = true;
			notice();
			$("#profiles-operation").textContent = "";
			preview();
			render();
			$("#profile-name").focus();
		}
		/** Abre la gestión de usuarios (con el formulario de uno nuevo, si se pide). */
		function show({ create = false } = {}) {
			returnFocus = trigger;
			if (!dialog.open) dialog.showModal();
			$("#profiles-title").focus({ preventScroll: true });
			requestAnimationFrame(() => {
				if (dialog.open && !dialog.contains(document.activeElement)) $("#profiles-title").focus({ preventScroll: true });
			});
			load().then(() => {
				if (create && ready) showForm();
			});
		}
		dialog.addEventListener("close", () => {
			cancelPhoto();
			clearTimeout(googleTimer);
			googleRequest++;
			if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
			else trigger.focus({ preventScroll: true });
		});
		$("#profiles-reload").addEventListener("click", () => void load());
		$("#profile-create").addEventListener("click", () => showForm());
		$("#profile-edit").addEventListener("click", () => showForm(selectedProfile()));
		$("#profile-cancel").addEventListener("click", () => {
			if (busy) return;
			cancelPhoto();
			formMode = null;
			formId = null;
			photoData = void 0;
			originalPhoto = null;
			$("#profile-form-error").hidden = true;
			render();
			$("#profile-edit").focus();
		});
		$("#profile-name").addEventListener("input", preview);
		dialog.querySelectorAll("input[name=\"profile-privacy\"]").forEach((input) => input.addEventListener("change", async () => {
			const to = selectedPrivacy();
			if (formMode === "edit" && to !== formPrivacy && !await confirmPrivacy(to)) dialog.querySelectorAll("input[name=\"profile-privacy\"]").forEach((other) => {
				other.checked = other.value === formPrivacy;
			});
			else formPrivacy = to;
			updatePrivacyForm();
		}));
		dialog.querySelectorAll("[data-privacy-switch]").forEach((button) => button.addEventListener("click", async () => {
			const profile = selectedProfile();
			const to = button.dataset.privacySwitch;
			if (!profile || busy || !ready || to === privacyMode(profile) || !await confirmPrivacy(to)) return;
			if (!await mutate(`/api/profiles/${encodeURIComponent(profile.id)}`, "PATCH", {
				name: profile.name,
				email: profile.email || "",
				color: profile.color,
				privacyMode: to
			}, tr(`Pasando a ${modeName(to)}…`, `Switching to ${modeName(to)}…`))) return;
			$("#profiles-operation").textContent = profile.id === snapshot.currentId ? tr(`${profile.name}: modo ${modeName(to)}. Se aplica al volver a abrir Kitsune.`, `${profile.name}: ${modeName(to)} mode. It applies when Kitsune opens again.`) : tr(`${profile.name}: modo ${modeName(to)}. Se aplica al abrir este perfil.`, `${profile.name}: ${modeName(to)} mode. It applies when this profile opens.`);
			dialog.querySelector(`[data-privacy-switch="${to}"]`)?.focus({ preventScroll: true });
		}));
		$("#profile-photo")?.addEventListener("change", async (event) => {
			const file = event.target.files?.[0];
			if (!file || busy || !formMode || !dialog.open) return;
			const request = ++photoRequest;
			photoBusy = true;
			photoMessage("Preparando foto…");
			renderControls();
			try {
				const data = await prepareAvatar(file);
				if (request !== photoRequest || !dialog.open || !formMode) return;
				photoData = data;
				preview();
				photoMessage("Lista para guardar.");
			} catch (error) {
				if (request === photoRequest && dialog.open && formMode) photoMessage(error.message, true);
			} finally {
				if (request === photoRequest) {
					photoBusy = false;
					event.target.value = "";
					renderControls();
				}
			}
		});
		$("#profile-photo-remove")?.addEventListener("click", () => {
			if (busy || !formMode) return;
			cancelPhoto();
			photoData = null;
			preview();
			photoMessage("La foto se quitará al guardar.");
			renderControls();
		});
		for (const input of ["#profile-name", "#profile-email"]) $(input).addEventListener("input", () => {
			$("#profile-form-error").hidden = true;
		});
		dialog.querySelectorAll("[data-profile-swatch]").forEach((button) => button.addEventListener("click", () => {
			if (busy) return;
			color = button.dataset.profileSwatch;
			preview();
		}));
		$("#profile-form").addEventListener("submit", async (event) => {
			event.preventDefault();
			if (busy || photoBusy || !ready || !formMode) return;
			$("#profile-form-error").hidden = true;
			let draft;
			try {
				draft = validateProfileDraft({
					name: $("#profile-name").value,
					email: $("#profile-email").value,
					color
				});
			} catch (error) {
				$("#profile-form-error").textContent = error.message;
				$("#profile-form-error").hidden = false;
				return;
			}
			const creating = formMode === "create";
			if (photoData !== void 0) draft.avatarData = photoData;
			if (!creating && formId === baseId()) {
				if ($("#profile-remember-google")) draft.rememberGoogle = $("#profile-remember-google").checked;
				if (dialog.querySelector("input[name=\"profile-privacy\"]")) draft.privacyMode = selectedPrivacy();
			}
			const result = await mutate(creating ? "/api/profiles" : `/api/profiles/${encodeURIComponent(formId)}`, creating ? "POST" : "PATCH", draft, creating ? "Creando tu nuevo espacio…" : "Guardando los detalles…");
			if (!result) return;
			selectedId = creating ? result.createdId : formId;
			if (!snapshot.profiles.some((profile) => profile.id === selectedId)) selectedId = snapshot.currentId;
			formMode = null;
			formId = null;
			photoData = void 0;
			originalPhoto = null;
			cancelPhoto();
			render();
			$("#profiles-operation").textContent = creating ? "Usuario creado. Cámbiate a él cuando quieras." : "Detalles guardados en este equipo.";
			if (dialog.open) $("#profile-detail-name").focus({ preventScroll: true });
			else announce(creating ? "Usuario creado." : "Usuario actualizado.");
		});
		$("#profile-open").addEventListener("click", async () => {
			const profile = selectedProfile();
			if (!profile || busy || !ready || profile.id === snapshot.currentId) return;
			setBusy(true, tr(`Cambiando a ${profile.name}…`, `Switching to ${profile.name}…`));
			const sent = await switchTo(profile.id).catch(() => false);
			setTimeout(() => {
				if (busy) {
					setBusy(false);
					notice("No se ha podido cambiar de usuario. Vuelve a intentarlo.");
				}
			}, sent ? 6e3 : 0);
		});
		async function openAction(action) {
			if (action === "google") {
				window.open("https://accounts.google.com/ServiceLogin", "_blank", "noopener");
				return;
			}
			if (await mutate(`/api/profiles/${encodeURIComponent(baseId())}/open`, "POST", { action }, "Abriendo…")) $("#profiles-operation").textContent = "Abierto en una pestaña nueva.";
		}
		dialog.querySelectorAll("[data-profile-action]").forEach((button) => button.addEventListener("click", () => void openAction(button.dataset.profileAction)));
		render();
		await load({ quiet: true });
		return {
			show,
			reload: () => load({ quiet: true })
		};
	}
	//#endregion
	//#region start/switcher.mjs
	/** Tarjeta de usuarios del inicio, como la de las cuentas de Google: el usuario de esta
	* pestaña arriba y los demás debajo. Elegir otro cambia esta misma pestaña a su inicio;
	* las demás pestañas no se tocan. */
	const USER_ID = /^(default|p-[0-9a-f]{16})$/u;
	/** Cómo se pide el cambio: al inicio integrado, por su API; al servidor de Linux, cargando
	* «/?cambiar=<id>», que el motor intercepta y convierte en el cambio de esta pestaña. */
	function switchRequest(id, { integrated }) {
		if (!USER_ID.test(id ?? "")) throw new Error("Usuario no válido");
		return integrated ? {
			kind: "api",
			path: `/api/profiles/${id}/open`,
			body: { action: "switch" }
		} : {
			kind: "navigate",
			url: `/?cambiar=${id}`
		};
	}
	/** Pide el cambio. true si se ha enviado (si funciona, esta pestaña se sustituye y no vuelve). */
	async function switchTo(id, { integrated, token, fetcher = (...args) => globalThis.fetch(...args), navigate = (url) => location.assign(url) }) {
		const request = switchRequest(id, { integrated });
		if (request.kind === "navigate") {
			navigate(request.url);
			return true;
		}
		return (await fetcher(request.path, {
			method: "POST",
			credentials: "omit",
			cache: "no-store",
			signal: AbortSignal.timeout(8e3),
			headers: {
				"Content-Type": "application/json",
				"X-Kitsune-Token": token
			},
			body: JSON.stringify(request.body)
		})).ok;
	}
	/** Los usuarios que salen debajo: todos menos el de esta pestaña, en el orden del registro. */
	function otherUsers(snapshot) {
		return (snapshot?.profiles ?? []).filter((profile) => profile.id !== snapshot.currentId);
	}
	function initializeSwitcher({ integrated, onManage = () => {}, onAdd = () => {} } = {}) {
		const $ = (selector) => document.querySelector(selector);
		const card = $("#users-card");
		const trigger = $("#profiles-open");
		if (!card || !trigger) return {
			render() {},
			switchTo: async () => false
		};
		let snapshot = null;
		let switching = false;
		const status = (message) => {
			$("#users-card-status").textContent = message;
		};
		async function change(profile) {
			if (switching || !snapshot) return false;
			switching = true;
			status(tr(`Cambiando a ${profile.name}…`, `Switching to ${profile.name}…`));
			card.querySelectorAll("[data-user-id]").forEach((button) => {
				button.disabled = true;
			});
			let sent = false;
			try {
				sent = await switchTo(profile.id, {
					integrated,
					token: snapshot.token
				});
			} catch {
				sent = false;
			}
			setTimeout(() => {
				if (!switching) return;
				switching = false;
				status("No se ha podido cambiar de usuario. Vuelve a intentarlo.");
				render(snapshot);
			}, sent ? 6e3 : 0);
			return sent;
		}
		function render(value) {
			snapshot = value;
			const me = snapshot?.profiles.find((profile) => profile.id === snapshot.currentId);
			if (!me) return;
			paintAvatar($("#users-card-avatar"), me, profileInitials(me.name));
			$("#users-card-hello").textContent = tr(`Hola, ${me.name}`, `Hi, ${me.name}`);
			$("#users-card-email").textContent = me.email;
			$("#users-card-email").hidden = !me.email;
			const list = $("#users-card-list");
			list.replaceChildren();
			for (const profile of otherUsers(snapshot)) {
				const button = document.createElement("button");
				button.type = "button";
				button.className = "users-card-item";
				button.dataset.userId = profile.id;
				button.disabled = switching;
				const glyph = document.createElement("span");
				glyph.className = "profile-avatar";
				glyph.setAttribute("aria-hidden", "true");
				paintAvatar(glyph, profile, profileInitials(profile.name));
				const copy = document.createElement("span");
				copy.className = "users-card-copy";
				const name = document.createElement("b");
				name.textContent = profile.name;
				const detail = document.createElement("small");
				detail.textContent = profile.email || "Cambiar en esta pestaña";
				copy.append(name, detail);
				button.append(glyph, copy);
				button.setAttribute("aria-label", tr(`Cambiar esta pestaña a ${profile.name}`, `Switch this tab to ${profile.name}`));
				button.addEventListener("click", () => void change(profile));
				list.append(button);
			}
			list.hidden = !list.children.length;
			$("#users-add").disabled = snapshot.profiles.length >= 24;
		}
		card.addEventListener("toggle", (event) => {
			trigger.setAttribute("aria-expanded", String(event.newState === "open"));
			if (event.newState === "open" && !switching) status("");
		});
		const leave = (next) => {
			trigger.focus({ preventScroll: true });
			card.hidePopover();
			next();
		};
		$("#users-manage").addEventListener("click", () => leave(onManage));
		$("#users-add").addEventListener("click", () => leave(onAdd));
		return {
			render,
			switchTo: (id) => {
				const profile = snapshot?.profiles.find((item) => item.id === id);
				return profile ? change(profile) : Promise.resolve(false);
			}
		};
	}
	//#endregion
	//#region start/settings-store.mjs
	const WALLPAPERS = Object.freeze([
		"night",
		"veil",
		"dusk",
		"ember"
	]);
	const ACCENTS = Object.freeze([
		"blue",
		"pink",
		"system"
	]);
	const THEMES = Object.freeze(["claro", "oscuro"]);
	const TABS = Object.freeze([
		"arriba",
		"lado",
		"iconos"
	]);
	const copy = (value) => JSON.parse(JSON.stringify(value));
	function normalizeSettings(value = {}) {
		return {
			links: cleanLinks(value?.links),
			art: value?.art !== false,
			motion: value?.motion !== false,
			newTab: value?.newTab === true,
			accent: ACCENTS.includes(value?.accent) ? value.accent : "blue",
			focus: value?.focus === true,
			wallpaper: WALLPAPERS.includes(value?.wallpaper) ? value.wallpaper : "night",
			themeSync: value?.themeSync === true,
			modules: {
				clock: value?.modules?.clock !== false,
				shortcuts: value?.modules?.shortcuts !== false
			},
			theme: THEMES.includes(value?.theme) ? value.theme : "claro",
			background: typeof value?.background === "string" && /^[a-f\d]{64}$/u.test(value.background) ? value.background : null,
			windowControls: value?.windowControls === "derecha" ? "derecha" : "izquierda",
			brand: value?.brand !== false,
			performance: value?.performance === "ahorro" ? "ahorro" : "normal",
			ramLimit: [
				1024,
				2048,
				4096
			].includes(value?.ramLimit) ? value.ramLimit : 2048,
			minimize: value?.minimize !== false,
			windowButtons: ["kitsune", "sistema"].includes(value?.windowButtons) ? value.windowButtons : "auto",
			tabs: TABS.includes(value?.tabs) ? value.tabs : "arriba",
			tinta: typeof value?.tinta === "string" && /^[a-z][a-z0-9-]{1,23}$/u.test(value.tinta) ? value.tinta : "papel"
		};
	}
	function mergeSettings(current, patch) {
		return normalizeSettings({
			...current,
			...patch,
			modules: {
				...current.modules,
				...patch.modules
			}
		});
	}
	function parseSettingsSnapshot(value) {
		if (!value || typeof value.token !== "string" || !value.token || !Number.isSafeInteger(value.revision) || value.revision < 0 || !value.data || typeof value.data !== "object" || Array.isArray(value.data)) throw new Error("Respuesta de ajustes no válida.");
		return {
			data: normalizeSettings(value.data),
			revision: value.revision,
			token: value.token
		};
	}
	/** One serial mutation queue. Each intent is rebased on the latest confirmed
	* snapshot, so unrelated changes in another tab are retained. A failed/timeout
	* write is uncertain, never success: fetch authoritative state before retry. */
	function createSettingsStore({ fetcher = (...args) => globalThis.fetch(...args), onChange = () => {}, onStatus = () => {} } = {}) {
		let snapshot = {
			data: normalizeSettings(),
			revision: 0,
			token: ""
		};
		let ready = false;
		let pending = 0;
		let queue = Promise.resolve();
		let alive = true;
		let generation = 0;
		let loading = null;
		const controllers = /* @__PURE__ */ new Set();
		const notify = () => {
			if (alive) onChange(copy(snapshot.data), {
				ready,
				pending,
				revision: snapshot.revision
			});
		};
		async function request(method = "GET", payload) {
			const controller = new AbortController();
			controllers.add(controller);
			const timeout = setTimeout(() => controller.abort(), 5e3);
			try {
				const response = await fetcher("/api/settings", {
					method,
					credentials: "omit",
					cache: "no-store",
					signal: controller.signal,
					...payload ? {
						headers: {
							"Content-Type": "application/json",
							"X-Kitsune-Token": snapshot.token
						},
						body: JSON.stringify(payload)
					} : {}
				});
				let body;
				try {
					body = await response.json();
				} catch {
					throw new Error("No se ha podido leer el guardado.");
				}
				if (!response.ok && response.status !== 409) throw new Error("No se ha podido conectar con los ajustes.");
				return {
					conflict: response.status === 409,
					snapshot: parseSettingsSnapshot(body)
				};
			} finally {
				clearTimeout(timeout);
				controllers.delete(controller);
			}
		}
		function accept(next) {
			snapshot = next;
			ready = true;
			generation++;
			notify();
		}
		async function refresh({ quiet = false } = {}) {
			if (!alive || pending) return false;
			if (loading) return loading;
			const started = generation;
			loading = (async () => {
				try {
					const result = await request();
					if (!alive || started !== generation || pending) return false;
					const changed = result.snapshot.revision !== snapshot.revision || !ready || JSON.stringify(result.snapshot.data) !== JSON.stringify(snapshot.data);
					if (changed) accept(result.snapshot);
					else snapshot = result.snapshot;
					if (changed || !quiet) onStatus("", false);
					return true;
				} catch {
					if (alive && started === generation && !pending) {
						ready = false;
						notify();
						if (!quiet) onStatus("Sin conexión con los ajustes. Puedes seguir navegando.", true);
					}
					return false;
				} finally {
					loading = null;
				}
			})();
			return loading;
		}
		function save(intent) {
			if (!alive) return Promise.resolve(false);
			pending++;
			generation++;
			const operation = queue.then(async () => {
				if (!alive) return false;
				try {
					if (!ready) accept((await request()).snapshot);
					for (let attempt = 0; attempt < 3; attempt++) {
						const data = typeof intent === "function" ? normalizeSettings(intent(copy(snapshot.data))) : mergeSettings(snapshot.data, intent);
						if (JSON.stringify(data) === JSON.stringify(snapshot.data)) return true;
						const result = await request("PUT", {
							data,
							revision: snapshot.revision
						});
						if (!alive) return false;
						accept(result.snapshot);
						if (!result.conflict) {
							onStatus("", false);
							return true;
						}
					}
					onStatus("Otra ventana sigue cambiando estos ajustes. Revisa el estado y vuelve a guardar.", false);
					return false;
				} catch (error) {
					if (alive) {
						ready = false;
						notify();
						onStatus(error?.name === "SettingsConflict" ? error.message : "No se ha confirmado el guardado. Tus últimos ajustes confirmados siguen aquí.", true);
					}
					return false;
				}
			}).finally(() => {
				pending--;
				notify();
			});
			queue = operation.catch(() => false);
			return operation;
		}
		/** Sets the home background: { imageData } uploads an image, { preset } picks
		* one of the preset backgrounds. The server normalizes or re-checks the image
		* and answers with the new settings snapshot; its error text is shown as is. */
		function setBackground(choice) {
			if (!alive) return Promise.resolve({ ok: false });
			pending++;
			generation++;
			const operation = queue.then(async () => {
				if (!alive) return { ok: false };
				const controller = new AbortController();
				controllers.add(controller);
				const timeout = setTimeout(() => controller.abort(), 3e4);
				try {
					if (!ready) accept((await request()).snapshot);
					const response = await fetcher("/api/background", {
						method: "POST",
						credentials: "omit",
						cache: "no-store",
						signal: controller.signal,
						headers: {
							"Content-Type": "application/json",
							"X-Kitsune-Token": snapshot.token
						},
						body: JSON.stringify(choice)
					});
					let body;
					try {
						body = await response.json();
					} catch {
						body = null;
					}
					if (!response.ok) return {
						ok: false,
						error: typeof body?.error === "string" ? body.error : "No se ha podido guardar el fondo."
					};
					if (!alive) return { ok: false };
					accept(parseSettingsSnapshot(body));
					return { ok: true };
				} catch {
					return {
						ok: false,
						error: "No se ha confirmado el fondo. Vuelve a intentarlo."
					};
				} finally {
					clearTimeout(timeout);
					controllers.delete(controller);
				}
			}).finally(() => {
				pending--;
				notify();
			});
			queue = operation.catch(() => ({ ok: false }));
			return operation;
		}
		return {
			refresh,
			save,
			setBackground,
			get data() {
				return copy(snapshot.data);
			},
			get ready() {
				return ready;
			},
			destroy() {
				alive = false;
				generation++;
				for (const controller of controllers) controller.abort();
			}
		};
	}
	//#endregion
	//#region start/appearance.mjs
	const PALETTE_KEYS = [
		"bg",
		"surface",
		"surfaceHigh",
		"text",
		"muted",
		"outline",
		"primary",
		"primaryContainer",
		"secondary",
		"tertiary"
	];
	const THEME_COLORS = Object.freeze({
		claro: "#f6f5f1",
		oscuro: "#161a19"
	});
	function parseAppearance(value) {
		if (![
			2,
			3,
			4,
			5,
			6,
			7,
			8
		].includes(value?.version) || typeof value.fingerprint !== "string" || !/^[a-f\d]{64}$/iu.test(value.fingerprint) || typeof value.motion !== "boolean" || !value.palette || PALETTE_KEYS.some((key) => typeof value.palette[key] !== "string" || !/^#[a-f\d]{6}$/iu.test(value.palette[key]))) throw new Error("Paleta no válida.");
		if (value.version >= 3 && (!Object.hasOwn(THEME_COLORS, value.theme) || value.background !== null && (typeof value.background !== "string" || !/^[a-f\d]{64}$/u.test(value.background)))) throw new Error("Tema no válido.");
		return value;
	}
	const CSS_NAMES = Object.freeze({
		bg: "bg",
		surface: "surface",
		surfaceHigh: "surface-high",
		text: "text",
		muted: "muted",
		outline: "outline",
		primary: "primary",
		primaryContainer: "primary-container",
		secondary: "secondary",
		tertiary: "tertiary"
	});
	/** La paleta de la tinta en las variables del inicio (y guardada para pintarla antes la próxima vez). */
	function paintPalette(root, theme, palette) {
		for (const [key, name] of Object.entries(CSS_NAMES)) root.style.setProperty(`--kb-${name}`, palette[key]);
		try {
			localStorage.setItem("kitsune-paleta", JSON.stringify({
				theme,
				palette
			}));
		} catch {}
	}
	function appearanceStatus(value) {
		if (value?.native?.available && value.native.status === "applied") return "Tema aplicado al navegador.";
		if (value?.native?.available && value.native.status === "queued") return "Aplicando el tema al navegador…";
		return "Color aplicado al inicio. El tema del navegador no está disponible.";
	}
	function createAppearance({ getSettings, refreshSettings = async () => {}, onStatus = () => {}, fetcher = (...args) => globalThis.fetch(...args) } = {}) {
		let controller = null;
		let timer = null;
		let alive = true;
		let generation = 0;
		let polling = false;
		function applySettings(settings = getSettings()) {
			for (const [key, value] of Object.entries({
				motion: settings.motion ? "on" : "off",
				focus: settings.focus ? "on" : "off",
				clock: settings.modules.clock ? "on" : "off",
				shortcuts: settings.modules.shortcuts ? "on" : "off"
			})) document.body.dataset[key] = value;
			const root = document.documentElement;
			root.dataset.theme = settings.theme;
			try {
				localStorage.setItem("kitsune-tema", settings.theme);
			} catch {}
			document.querySelector("meta[name=\"theme-color\"]")?.setAttribute("content", THEME_COLORS[settings.theme] ?? THEME_COLORS.claro);
			const icon = document.querySelector("link[rel=\"icon\"]");
			const href = settings.theme === "oscuro" ? "favicon-dark.svg" : "favicon.svg";
			if (icon && icon.getAttribute("href") !== href) icon.setAttribute("href", href);
			if (settings.background && location.protocol !== "file:") {
				const path = `/api/background/${settings.background}.jpg`;
				if (integrated) {
					imageUrl(path).then((url) => {
						if (root.dataset.backgroundPath !== path) return;
						root.style.setProperty("--home-background", `url("${url}")`);
						root.dataset.background = "on";
					}).catch(() => {});
					root.dataset.backgroundPath = path;
				} else {
					root.style.setProperty("--home-background", `url("${path}")`);
					root.dataset.background = "on";
				}
			} else {
				delete root.dataset.backgroundPath;
				root.style.removeProperty("--home-background");
				root.dataset.background = "off";
			}
		}
		async function refresh() {
			if (!alive || document.hidden || location.protocol === "file:") return false;
			const run = ++generation;
			controller?.abort();
			const requestController = new AbortController();
			controller = requestController;
			const relevant = (settings) => JSON.stringify([
				settings.motion,
				settings.theme,
				settings.background,
				settings.tinta
			]);
			const startedWith = relevant(getSettings());
			const timeout = setTimeout(() => requestController.abort(), 4e3);
			try {
				const response = await fetcher("/api/appearance", {
					credentials: "omit",
					cache: "no-store",
					signal: requestController.signal
				});
				if (!response.ok) throw new Error("Appearance unavailable");
				const result = parseAppearance(await response.json());
				if (!alive || run !== generation) return false;
				const settings = getSettings();
				if (startedWith !== relevant(settings) || result.motion !== settings.motion) return false;
				if (result.theme === settings.theme) paintPalette(document.documentElement, result.theme, result.palette);
				onStatus(appearanceStatus(result));
				return true;
			} catch (error) {
				if (alive && run === generation && error?.name !== "AbortError") onStatus("No se ha podido actualizar el tema. Reintentando…");
				return false;
			} finally {
				clearTimeout(timeout);
			}
		}
		async function tick() {
			if (!alive || document.hidden || polling) return;
			polling = true;
			try {
				await refreshSettings();
				await refresh();
			} finally {
				polling = false;
			}
		}
		function visibility() {
			clearInterval(timer);
			if (document.hidden) {
				controller?.abort();
				return;
			}
			tick();
			timer = setInterval(() => void tick(), 2e3);
		}
		document.addEventListener("visibilitychange", visibility);
		return {
			applySettings,
			refresh,
			start() {
				visibility();
			},
			destroy() {
				alive = false;
				generation++;
				clearInterval(timer);
				controller?.abort();
				document.removeEventListener("visibilitychange", visibility);
			}
		};
	}
	//#endregion
	//#region start/dialogs.mjs
	const $ = (selector) => document.querySelector(selector);
	function icon(name) {
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
		use.setAttribute("href", `#i-${name}`);
		svg.setAttribute("aria-hidden", "true");
		svg.append(use);
		return svg;
	}
	function initializeDialogs() {
		const returns = /* @__PURE__ */ new WeakMap();
		for (const name of ["settings", "help"]) $(`#${name}-open`)?.addEventListener("click", () => {
			const dialog = $(`#${name}-dialog`);
			returns.set(dialog, document.activeElement);
			if (!dialog.open) dialog.showModal();
		});
		document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => $(`#${button.dataset.close}`)?.close()));
		document.querySelectorAll("dialog").forEach((dialog) => {
			dialog.addEventListener("close", () => returns.get(dialog)?.focus({ preventScroll: true }));
			dialog.addEventListener("click", (event) => {
				if (event.target !== dialog) return;
				const box = dialog.getBoundingClientRect();
				if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
			});
		});
		const tabs = [...document.querySelectorAll("[data-settings-tab]")];
		const select = (button) => {
			tabs.forEach((tab) => {
				tab.setAttribute("aria-selected", String(tab === button));
				tab.tabIndex = tab === button ? 0 : -1;
			});
			document.querySelectorAll("[data-settings-panel]").forEach((panel) => {
				panel.hidden = panel.dataset.settingsPanel !== button.dataset.settingsTab;
			});
		};
		tabs.forEach((button, index) => {
			button.addEventListener("click", () => select(button));
			button.addEventListener("keydown", (event) => {
				let target;
				if (event.key === "ArrowRight") target = tabs[(index + 1) % tabs.length];
				if (event.key === "ArrowLeft") target = tabs[(index + tabs.length - 1) % tabs.length];
				if (event.key === "Home") target = tabs[0];
				if (event.key === "End") target = tabs.at(-1);
				if (target) {
					event.preventDefault();
					select(target);
					target.focus();
				}
			});
		});
		document.addEventListener("keydown", (event) => {
			if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || document.querySelector("dialog[open]") || event.target.closest("input, textarea, [contenteditable=\"true\"]")) return;
			if (event.key === "/") {
				event.preventDefault();
				$("#query").focus();
			}
			if (event.key === "?") {
				event.preventDefault();
				$("#help-open").click();
			}
		});
	}
	//#endregion
	//#region start/shortcuts.mjs
	function editLinks(current, { item, id = item?.id, expected, remove = false }) {
		const existing = current.links.find((link) => link.id === id);
		const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
		if (remove && !existing) return current;
		if (!remove && equal(existing, item)) return current;
		if (existing && !equal(existing, expected)) {
			const error = /* @__PURE__ */ new Error("Este acceso cambió en otra ventana. Revisa el borrador y vuelve a guardar para confirmarlo.");
			error.name = "SettingsConflict";
			throw error;
		}
		if (expected && !existing) {
			const error = /* @__PURE__ */ new Error("Este acceso se eliminó en otra ventana. Créalo de nuevo si quieres recuperarlo.");
			error.name = "SettingsConflict";
			throw error;
		}
		if (!existing && !remove && current.links.length >= 12) throw new Error("Puedes guardar hasta 12 accesos.");
		return {
			...current,
			links: remove ? current.links.filter((link) => link.id !== id) : existing ? current.links.map((link) => link.id === id ? item : link) : [...current.links, item]
		};
	}
	function initializeShortcuts({ store, announce }) {
		let editing = false;
		let editingId = null;
		let expected = null;
		let busy = false;
		let currentSettings = store.data;
		let renderSignature = "";
		function render(settings = store.data) {
			currentSettings = settings;
			const signature = JSON.stringify([
				settings.links,
				settings.newTab,
				editing,
				busy,
				store.ready
			]);
			if (renderSignature === signature) return;
			renderSignature = signature;
			const grid = $("#quick-links");
			grid.replaceChildren();
			for (const item of settings.links) {
				const wrapper = document.createElement("div");
				wrapper.className = "quick-link";
				const anchor = document.createElement("a");
				anchor.href = item.url;
				anchor.title = item.url;
				if (settings.newTab) {
					anchor.target = "_blank";
					anchor.rel = "noopener noreferrer";
				}
				const glyph = document.createElement("span");
				glyph.className = `link-icon ${item.color}`;
				if (item.icon) glyph.append(icon(item.icon));
				else glyph.textContent = [...item.name][0]?.toLocaleUpperCase("es") || "·";
				const name = document.createElement("span");
				name.className = "link-name";
				name.textContent = item.name;
				anchor.append(glyph, name);
				wrapper.append(anchor);
				if (editing) {
					const button = document.createElement("button");
					button.className = "link-edit";
					button.type = "button";
					button.setAttribute("aria-label", tr(`Editar ${item.name}`, `Edit ${item.name}`));
					button.append(icon("edit"));
					button.disabled = busy || !store.ready;
					button.addEventListener("click", () => open(item));
					wrapper.append(button);
				}
				grid.append(wrapper);
			}
			if (settings.links.length < 12) {
				const button = document.createElement("button");
				button.type = "button";
				button.className = "add-link";
				button.append(icon("plus"), document.createTextNode("Añadir"));
				button.disabled = busy || !store.ready;
				button.addEventListener("click", () => open());
				grid.append(button);
			}
			$("#edit-links span").textContent = editing ? "Listo" : "Editar";
			$("#edit-links").setAttribute("aria-pressed", String(editing));
			$("#edit-links").disabled = !store.ready || busy;
		}
		function error(message) {
			$("#link-error").textContent = message;
			$("#link-error").hidden = !message;
		}
		function open(item = null) {
			if (busy || !store.ready) return;
			editingId = item?.id || crypto.randomUUID();
			expected = item ? { ...item } : null;
			$("#link-title").textContent = item ? "Editar acceso" : "Nuevo acceso";
			$("#link-name").value = item?.name || "";
			$("#link-url").value = item?.url || "";
			$("#delete-link").hidden = !item;
			error("");
			$("#link-dialog").showModal();
			$("#link-name").focus();
		}
		function controls(value) {
			busy = value;
			$("#link-form").setAttribute("aria-busy", String(value));
			$("#link-form button[type=\"submit\"]").disabled = value;
			$("#delete-link").disabled = value;
			render();
		}
		async function save(remove = false) {
			if (busy) return;
			error("");
			controls(true);
			try {
				const name = $("#link-name").value.trim();
				if (!remove && !name) throw new Error("Escribe un nombre para este acceso.");
				const item = remove ? null : {
					id: editingId,
					name: name.slice(0, 36),
					url: safeLink($("#link-url").value),
					color: expected?.color || "blue",
					icon: expected?.icon || ""
				};
				if (!await store.save((current) => editLinks(current, {
					item,
					id: editingId,
					expected,
					remove
				}))) {
					expected = store.data.links.find((link) => link.id === editingId) || null;
					error("No se ha confirmado. El borrador sigue aquí; puedes volver a guardar.");
					return;
				}
				$("#link-dialog").close();
				announce(remove ? "Acceso eliminado." : "Acceso guardado.");
			} catch (failure) {
				error(failure.message);
			} finally {
				controls(false);
			}
		}
		$("#link-form").addEventListener("submit", (event) => {
			event.preventDefault();
			save();
		});
		$("#delete-link").addEventListener("click", () => void save(true));
		$("#edit-links").addEventListener("click", () => {
			editing = !editing;
			render(currentSettings);
		});
		return { render };
	}
	//#endregion
	//#region start/native-actions.mjs
	/** Opens native settings; success confirms dispatch, never an external login. */
	function initializeNativeActions({ announce }) {
		let busy = false;
		const buttons = [...document.querySelectorAll("[data-native-action]")];
		for (const button of buttons) button.addEventListener("click", async () => {
			if (busy || location.protocol === "file:") return;
			busy = true;
			buttons.forEach((item) => {
				item.disabled = true;
			});
			try {
				const get = await fetch("/api/profiles", {
					credentials: "omit",
					cache: "no-store",
					signal: AbortSignal.timeout(5e3)
				});
				if (!get.ok) throw new Error("No se ha podido leer el perfil actual.");
				const profile = await get.json();
				if (typeof profile.currentId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/u.test(profile.currentId) || typeof profile.token !== "string" || !Number.isSafeInteger(profile.revision)) throw new Error("Perfil no disponible.");
				const response = await fetch(`/api/profiles/${encodeURIComponent(profile.currentId)}/open`, {
					method: "POST",
					credentials: "omit",
					cache: "no-store",
					signal: AbortSignal.timeout(8e3),
					headers: {
						"Content-Type": "application/json",
						"X-Kitsune-Token": profile.token
					},
					body: JSON.stringify({
						action: button.dataset.nativeAction,
						revision: profile.revision
					})
				});
				if (!response.ok) throw new Error(response.status === 409 ? "El perfil cambió. Vuelve a pulsar para abrir el ajuste." : "No se ha podido confirmar la apertura. Puedes volver a intentarlo.");
				announce("Apertura solicitada en este perfil.");
			} catch (error) {
				announce(error.message || "No se ha podido abrir el ajuste.");
			} finally {
				busy = false;
				buttons.forEach((item) => {
					item.disabled = false;
				});
			}
		});
	}
	//#endregion
	//#region start/presets.mjs
	const IDENTIFIER = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u;
	const DIGEST = /^[\da-f]{64}$/u;
	/** Only well-formed presets from the local home server become buttons. */
	function parsePresets(value) {
		if (!Array.isArray(value?.categories)) return [];
		return value.categories.filter((category) => typeof category?.name === "string" && Array.isArray(category.items)).map((category) => ({
			name: category.name.slice(0, 40),
			items: category.items.filter((item) => IDENTIFIER.test(item?.id) && DIGEST.test(item?.sha256)).map((item) => ({
				id: item.id,
				sha256: item.sha256,
				label: typeof item.credit === "string" ? item.credit.slice(0, 100) : typeof item.color === "string" ? `Color ${item.color.slice(0, 7)}` : ""
			}))
		})).filter((category) => category.items.length);
	}
	/** Fondos de serie: «Original» (sin imagen) y los de la librería local. */
	function initializePresets({ choose, fetcher = (...args) => globalThis.fetch(...args) }) {
		const gallery = $("#preset-gallery");
		let busy = false;
		let ready = false;
		async function pick(button) {
			if (busy) return;
			busy = true;
			for (const tile of gallery.querySelectorAll(".preset-tile")) tile.disabled = true;
			try {
				await choose(button.dataset.preset);
			} finally {
				busy = false;
				for (const tile of gallery.querySelectorAll(".preset-tile")) tile.disabled = !ready;
			}
		}
		gallery.querySelector(".preset-original").addEventListener("click", (event) => void pick(event.currentTarget));
		let last = null;
		let retries = 0;
		async function load() {
			if (location.protocol === "file:" || gallery.dataset.loaded) return;
			try {
				const response = await fetcher("/api/wallpapers", {
					credentials: "omit",
					cache: "no-store"
				});
				if (!response.ok) return;
				const body = await response.json();
				for (const node of gallery.querySelectorAll(".preset-heading, .preset-grid")) node.remove();
				for (const category of parsePresets(body)) {
					const heading = document.createElement("h4");
					heading.className = "preset-heading";
					heading.textContent = category.name;
					const grid = document.createElement("div");
					grid.className = "preset-grid";
					category.items.forEach((item, index) => {
						const button = document.createElement("button");
						button.type = "button";
						button.className = "preset-tile";
						button.dataset.preset = item.id;
						button.dataset.sha = item.sha256;
						button.disabled = true;
						button.setAttribute("aria-pressed", "false");
						button.setAttribute("aria-label", `${category.name} ${index + 1}${item.label ? ` · ${item.label}` : ""}`);
						if (item.label) button.title = item.label;
						const image = document.createElement("img");
						imageUrl(`/api/wallpapers/${item.id}.jpg`).then((url) => {
							image.src = url;
						}).catch(() => {});
						image.alt = "";
						image.loading = "lazy";
						image.decoding = "async";
						button.append(image);
						button.addEventListener("click", () => void pick(button));
						grid.append(button);
					});
					gallery.append(heading, grid);
				}
				if (last) sync(...last);
				if (body?.pending === true && retries++ < 60) setTimeout(() => void load(), 3e3);
				else gallery.dataset.loaded = "true";
			} catch {}
		}
		function sync(settings, isReady) {
			last = [settings, isReady];
			ready = isReady;
			for (const tile of gallery.querySelectorAll(".preset-tile")) {
				tile.setAttribute("aria-pressed", String(tile.dataset.preset ? tile.dataset.sha === settings.background : !settings.background));
				if (!busy) tile.disabled = !isReady;
			}
		}
		return {
			load,
			sync
		};
	}
	//#endregion
	//#region start/privacy-line.mjs
	function privacyText(value) {
		if (!value?.available || !value.week?.total) return "";
		const total = value.week.total.toLocaleString(tr("es-ES", "en-US"));
		const today = value.today?.total ? tr(` (${value.today.total.toLocaleString("es-ES")} hoy)`, ` (${value.today.total.toLocaleString("en-US")} today)`) : "";
		return tr(`Esta semana Kitsune ha bloqueado ${total} ${value.week.total === 1 ? "rastreador" : "rastreadores"}${today}`, `This week Kitsune blocked ${total} ${value.week.total === 1 ? "tracker" : "trackers"}${today}`);
	}
	async function initializePrivacyLine($) {
		if (location.protocol === "file:") return;
		try {
			const response = await fetch("/api/privacidad", {
				credentials: "omit",
				cache: "no-store",
				signal: AbortSignal.timeout(5e3)
			});
			const text = privacyText(response.ok ? await response.json() : null);
			$("#privacy-count").textContent = text;
			$("#privacy-line").hidden = !text;
		} catch {
			$("#privacy-line").hidden = true;
		}
	}
	//#endregion
	//#region start/tintas.mjs
	async function initializeTintas({ $, save, getSettings }) {
		const grid = $("#tinta-grid");
		let catalog = [];
		try {
			const response = await fetch("/api/tintas", {
				credentials: "omit",
				cache: "no-store",
				signal: AbortSignal.timeout(5e3)
			});
			if (response.ok) catalog = (await response.json()).tintas ?? [];
		} catch {}
		const render = (settings = getSettings(), ready = true) => {
			grid.replaceChildren(...catalog.map((tinta) => {
				const palette = tinta[settings.theme] ?? tinta.claro;
				const button = document.createElement("button");
				button.type = "button";
				button.className = "tinta";
				button.setAttribute("role", "radio");
				button.setAttribute("aria-checked", String(tinta.id === settings.tinta));
				button.dataset.tinta = tinta.id;
				button.disabled = !ready;
				button.title = tinta.author && tinta.author !== "Kitsune" ? tr(`${tinta.name} · de ${tinta.author}`, `${tinta.name} · by ${tinta.author}`) : tinta.name;
				const swatch = document.createElement("span");
				swatch.className = "tinta-swatch";
				swatch.setAttribute("aria-hidden", "true");
				swatch.style.setProperty("--swatch-bg", palette.bg);
				swatch.style.setProperty("--swatch-primary", palette.primary);
				swatch.style.setProperty("--swatch-secondary", palette.secondary);
				swatch.style.setProperty("--swatch-text", palette.text);
				const name = document.createElement("span");
				name.className = "tinta-name";
				name.textContent = tinta.name;
				button.append(swatch, name);
				button.addEventListener("click", () => void save({ tinta: tinta.id }));
				return button;
			}));
		};
		render();
		return { render };
	}
	//#endregion
	//#region start/app.js
	let toastTimer;
	let mode = "all";
	let shortcuts;
	let appearance;
	let presets;
	let tintas;
	const announce = (message) => {
		clearTimeout(toastTimer);
		$("#status").textContent = message;
		$("#status").hidden = !message;
		toastTimer = setTimeout(() => {
			$("#status").hidden = true;
		}, 4e3);
	};
	initializeLanguage();
	const toggles = {
		"motion-toggle": "motion",
		"newtab-toggle": "newTab",
		"brand-toggle": "brand",
		"minimize-toggle": "minimize"
	};
	const store = createSettingsStore({
		onChange(settings, state) {
			appearance?.applySettings(settings);
			shortcuts?.render(settings);
			for (const [id, key] of Object.entries(toggles)) {
				$(`#${id}`).checked = settings[key];
				$(`#${id}`).disabled = !state.ready;
			}
			for (const key of ["clock", "shortcuts"]) {
				$(`#module-${key}`).checked = settings.modules[key];
				$(`#module-${key}`).disabled = !state.ready;
			}
			for (const radio of document.querySelectorAll("input[name=\"theme\"]")) {
				radio.checked = radio.value === settings.theme;
				radio.disabled = !state.ready;
			}
			$("#background-file").disabled = !state.ready;
			const buttons = settings.windowButtons === "auto" ? navigator.userAgent.includes("Macintosh") ? "sistema" : "kitsune" : settings.windowButtons;
			for (const button of document.querySelectorAll("[data-tabs]")) {
				button.setAttribute("aria-pressed", String(button.dataset.tabs === settings.tabs));
				button.disabled = !state.ready;
			}
			for (const button of document.querySelectorAll("[data-window-buttons]")) {
				button.setAttribute("aria-pressed", String(button.dataset.windowButtons === buttons));
				button.disabled = !state.ready;
			}
			for (const button of document.querySelectorAll("[data-window-controls]")) {
				button.setAttribute("aria-pressed", String(button.dataset.windowControls === settings.windowControls));
				button.disabled = !state.ready || buttons === "sistema";
			}
			$("#minimize-toggle").disabled = !state.ready || buttons === "sistema";
			for (const button of document.querySelectorAll("[data-performance]")) {
				button.setAttribute("aria-pressed", String(button.dataset.performance === settings.performance));
				button.disabled = !state.ready;
			}
			for (const button of document.querySelectorAll("[data-ram-limit]")) {
				button.setAttribute("aria-pressed", String(Number(button.dataset.ramLimit) === settings.ramLimit));
				button.disabled = !state.ready;
			}
			$("#ram-row").hidden = settings.performance !== "ahorro";
			$("#background-remove").hidden = !settings.background;
			$("#background-remove").disabled = !state.ready;
			presets?.sync(settings, state.ready);
			tintas?.render(settings, state.ready);
			$("#focus-toggle").setAttribute("aria-pressed", String(settings.focus));
			$("#focus-toggle").disabled = !state.ready;
			$("#focus-toggle").textContent = settings.focus ? "Salir de enfoque" : "Enfoque";
			$("#save-state").textContent = state.pending ? "Guardando…" : state.ready ? "Guardado en este perfil" : "Sin conexión";
			document.documentElement.dataset.storageReady = String(state.ready);
		},
		onStatus(message, retry) {
			$("#settings-notice").hidden = !message;
			$("#settings-message").textContent = message;
			$("#settings-retry").hidden = !retry;
			if (message) announce(message);
		}
	});
	for (const button of document.querySelectorAll("[data-window-controls]")) button.addEventListener("click", () => void save({ windowControls: button.dataset.windowControls }));
	for (const button of document.querySelectorAll("[data-tabs]")) button.addEventListener("click", () => void save({ tabs: button.dataset.tabs }));
	for (const button of document.querySelectorAll("[data-window-buttons]")) button.addEventListener("click", () => void save({ windowButtons: button.dataset.windowButtons }));
	for (const button of document.querySelectorAll("[data-performance]")) button.addEventListener("click", () => void save({ performance: button.dataset.performance }));
	for (const button of document.querySelectorAll("[data-ram-limit]")) button.addEventListener("click", () => void save({ ramLimit: Number(button.dataset.ramLimit) }));
	async function updateMemory() {
		if (!$("#settings-dialog").open || location.protocol === "file:") return;
		try {
			const value = await (await fetch("/api/rendimiento", {
				credentials: "omit",
				cache: "no-store"
			})).json();
			$("#memory-status").textContent = Number.isFinite(value?.memoryMB) ? ((size) => tr(`Ahora Kitsune usa ${size} de RAM en este perfil (${value.processes} procesos).`, `Kitsune is using ${size} of RAM in this profile (${value.processes} processes).`))(value.memoryMB >= 1024 ? `${(value.memoryMB / 1024).toLocaleString(tr("es-ES", "en-US"), { maximumFractionDigits: 1 })} GB` : `${value.memoryMB} MB`) : "";
		} catch {
			$("#memory-status").textContent = "";
		}
	}
	setInterval(() => void updateMemory(), 5e3);
	$("#settings-open").addEventListener("click", () => setTimeout(() => void updateMemory(), 50));
	appearance = createAppearance({
		getSettings: () => store.data,
		refreshSettings: () => store.refresh({ quiet: true }),
		onStatus: (message) => {
			$("#theme-status").textContent = message;
		}
	});
	shortcuts = initializeShortcuts({
		store,
		announce
	});
	initializeDialogs();
	initializeNativeActions({ announce });
	initializePrivacyLine($);
	initializeTintas({
		$,
		save,
		getSettings: () => store.data
	}).then((value) => {
		tintas = value;
	});
	presets = initializePresets({ async choose(preset) {
		const result = preset ? await store.setBackground({ preset }) : { ok: await store.save({ background: null }) };
		$("#background-status").textContent = result.ok ? BACKGROUND_HINT : result.error ?? "No se ha podido cambiar el fondo.";
		if (result.ok) {
			announce(preset ? "Fondo puesto." : "Fondo original.");
			await appearance.refresh();
		}
	} });
	async function save(patch) {
		if (await store.save(patch)) await appearance.refresh();
	}
	for (const [id, key] of Object.entries(toggles)) $(`#${id}`).addEventListener("change", (event) => void save({ [key]: event.target.checked }));
	for (const key of ["clock", "shortcuts"]) $(`#module-${key}`).addEventListener("change", (event) => void save({ modules: { [key]: event.target.checked } }));
	$("#focus-toggle").addEventListener("click", () => void save({ focus: !store.data.focus }));
	const INK_MS = 1200;
	const INK_EASING = "cubic-bezier(.65, 0, .35, 1)";
	function playInk(theme, apply) {
		if (document.body.dataset.motion === "off" || matchMedia("(prefers-reduced-motion: reduce)").matches || typeof document.startViewTransition !== "function" || document.documentElement.dataset.theme === theme) {
			apply();
			return;
		}
		const dir = theme === "oscuro" ? "ltr" : "rtl";
		const vein = document.createElement("div");
		vein.className = "ink-vein";
		vein.dataset.dir = dir;
		document.documentElement.dataset.inkDir = dir;
		const transition = document.startViewTransition(() => {
			apply();
			document.body.append(vein);
		});
		transition.ready.then(() => vein.animate({ backgroundPosition: dir === "ltr" ? ["100% 0", "0% 0"] : ["0% 0", "100% 0"] }, {
			duration: INK_MS,
			easing: INK_EASING,
			fill: "both"
		})).catch(() => {});
		transition.finished.finally(() => {
			vein.remove();
			delete document.documentElement.dataset.inkDir;
		});
	}
	for (const radio of document.querySelectorAll("input[name=\"theme\"]")) radio.addEventListener("change", (event) => {
		if (!event.target.checked) return;
		const theme = event.target.value;
		playInk(theme, () => {
			document.documentElement.dataset.theme = theme;
		});
		save({ theme });
	});
	const BACKGROUND_HINT = "PNG, JPG o WebP · hasta 12 MB. Se ve en el inicio y en las pestañas nuevas.";
	const readImage = (file) => new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.addEventListener("load", () => resolve(reader.result));
		reader.addEventListener("error", () => reject(reader.error));
		reader.readAsDataURL(file);
	});
	$("#background-file").addEventListener("change", async (event) => {
		const input = event.target;
		const [file] = input.files;
		input.value = "";
		if (!file) return;
		const status = $("#background-status");
		if (![
			"image/png",
			"image/jpeg",
			"image/webp"
		].includes(file.type)) {
			status.textContent = "Elige una imagen PNG, JPEG o WebP.";
			return;
		}
		if (file.size > 12582912) {
			status.textContent = "La imagen es demasiado grande. Elige una de hasta 12 MB.";
			return;
		}
		status.textContent = "Preparando el fondo…";
		try {
			const result = await store.setBackground({ imageData: await readImage(file) });
			status.textContent = result.ok ? BACKGROUND_HINT : result.error ?? BACKGROUND_HINT;
			if (result.ok) {
				announce("Fondo puesto.");
				await appearance.refresh();
			}
		} catch {
			status.textContent = "No se ha podido leer la imagen.";
		}
	});
	$("#background-remove").addEventListener("click", async () => {
		if (await store.save({ background: null })) {
			$("#background-status").textContent = BACKGROUND_HINT;
			announce("Fondo quitado.");
			await appearance.refresh();
		}
	});
	$("#settings-retry").addEventListener("click", async () => {
		$("#settings-retry").disabled = true;
		try {
			if (await store.refresh()) {
				await appearance.refresh();
				announce("Conectado. Puedes volver a guardar.");
			}
		} finally {
			$("#settings-retry").disabled = false;
		}
	});
	$("#search-form").addEventListener("submit", (event) => {
		event.preventDefault();
		try {
			const result = resolveNavigation($("#query").value, mode);
			if (!result) {
				$("#query").focus();
				return;
			}
			$("#search-error").hidden = true;
			window.location.assign(result.url);
		} catch (error) {
			$("#search-error").textContent = error.message;
			$("#search-error").hidden = false;
		}
	});
	$("#query").addEventListener("input", () => {
		$("#search-error").hidden = true;
	});
	document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
		mode = button.dataset.mode;
		document.querySelectorAll("[data-mode]").forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
		$("#query").focus();
	}));
	function updateClock() {
		const now = /* @__PURE__ */ new Date();
		$("#clock-time").dateTime = now.toISOString();
		$("#clock-time").textContent = new Intl.DateTimeFormat(tr("es-ES", "en-US"), {
			hour: "2-digit",
			minute: "2-digit"
		}).format(now);
		$("#date").dateTime = now.toISOString();
		$("#date").textContent = new Intl.DateTimeFormat(tr("es-ES", "en-US"), {
			weekday: "long",
			day: "numeric",
			month: "long"
		}).format(now);
	}
	updateClock();
	const clockTimer = setInterval(() => {
		if (!document.hidden) updateClock();
	}, 1e3);
	document.addEventListener("visibilitychange", () => {
		if (!document.hidden) updateClock();
	});
	appearance.applySettings();
	shortcuts.render();
	if (location.protocol === "file:") {
		$("#offline-home").hidden = false;
		document.querySelectorAll("[data-native-action]").forEach((button) => {
			button.disabled = true;
		});
		document.documentElement.dataset.ready = "true";
	} else store.refresh().finally(() => {
		document.documentElement.dataset.ready = "true";
		appearance.start();
		presets.load().then(() => presets.sync(store.data, store.ready));
	});
	let profiles = null;
	const switcher = initializeSwitcher({
		integrated,
		onManage: () => profiles?.show(),
		onAdd: () => profiles?.show({ create: true })
	});
	initializeProfiles({
		announce,
		onSnapshot: (snapshot) => switcher.render(snapshot),
		switchTo: (id) => switcher.switchTo(id)
	}).then((controller) => {
		profiles = controller ?? null;
	});
	window.addEventListener("pagehide", () => {
		clearInterval(clockTimer);
		clearTimeout(toastTimer);
		appearance.destroy();
		store.destroy();
	}, { once: true });
	window.addEventListener("pageshow", (event) => {
		if (event.persisted) location.reload();
	});
	//#endregion
})();

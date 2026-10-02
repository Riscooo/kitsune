(function() {
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
		image.src = source;
	}
	//#endregion
	//#region start/profiles.mjs
	/** Local browser profiles are not online accounts. All mutations are confirmed
	* by the loopback service before this view reflects a saved change. */
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
			if (!item || typeof item.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/u.test(item.id) || ids.has(item.id) || typeof item.name !== "string" || !item.name.trim() || [...item.name].length > 48 || BAD_TEXT.test(item.name) || typeof item.email !== "string" || [...item.email].length > 254 || BAD_TEXT.test(item.email) || !PROFILE_COLORS.includes(item.color)) throw new Error("Invalid profile in response");
			ids.add(item.id);
		}
		if (!ids.has(value.currentId) || !ids.has(value.defaultId)) throw new Error("Invalid current/default profile");
		return value;
	}
	function googleRetentionStatus(appearance, desired) {
		if (typeof desired !== "boolean" || appearance?.googleRemember !== desired || appearance.native?.status !== "applied") return null;
		const native = appearance.native;
		if (desired) return native.googleRemember === true ? "Se conservará la sesión de Google en este perfil." : null;
		if (native.googlePolicyManaged !== false) return null;
		return native.googleRemember === true ? "Kitsune no gestiona esta excepción; Google se conserva por tus ajustes de privacidad." : "Sin una excepción de Google gestionada por Kitsune.";
	}
	async function initializeProfiles({ announce = () => {} } = {}) {
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
		const icon = (name) => {
			const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
			use.setAttribute("href", `#i-${name}`);
			svg.setAttribute("aria-hidden", "true");
			svg.append(use);
			return svg;
		};
		const avatar = (node, profile, draft) => paintAvatar(node, profile, profileInitials(profile.name), draft);
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
			const desired = profile.rememberGoogle === true;
			if (profile.id !== snapshot.currentId) {
				status.textContent = desired ? "Abre este perfil para aplicar la conservación de Google." : "Sin conservación de Google activada en Kitsune.";
				return;
			}
			status.textContent = "Aplicando…";
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
					const confirmed = googleRetentionStatus(appearance, desired);
					if (confirmed) {
						status.textContent = confirmed;
						return;
					}
				} catch {}
				if (request !== googleRequest || !dialog.open || formMode) return;
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
			dialog.setAttribute("aria-busy", String(busy || photoBusy));
			$("#profile-create").disabled = blocked || Boolean(formMode) || snapshot?.profiles.length >= 24;
			$("#profile-create").title = snapshot?.profiles.length >= 24 ? "Has llegado al límite de 24 perfiles." : "";
			$("#profile-save").disabled = blocked || photoBusy;
			$("#profile-cancel").disabled = busy;
			$("#profile-name").disabled = busy;
			$("#profile-email").disabled = busy;
			$("#profiles-reload").disabled = busy;
			$("#profile-edit").disabled = blocked;
			$("#profile-open").disabled = blocked;
			$("#profile-make-default").disabled = blocked;
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
			if ($("#profile-remember-google")) $("#profile-remember-google").disabled = busy;
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
				hint.textContent = profile.id === snapshot.currentId ? "En esta ventana" : profile.id === snapshot.defaultId ? "Predeterminado" : "Perfil local";
				copy.append(name, hint);
				button.append(glyph, copy);
				if (profile.id === snapshot.defaultId) {
					const mark = icon("check");
					mark.classList.add("profile-default-mark");
					button.append(mark);
				}
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
				trigger.setAttribute("aria-label", `Gestionar perfiles. Perfil de esta ventana: ${current.name}`);
				trigger.title = `Perfil de esta ventana: ${current.name}`;
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
				$("#profile-default-badge").hidden = profile.id !== snapshot.defaultId;
				$("#profile-open span").textContent = profile.id === snapshot.currentId ? "Abrir este perfil" : "Cambiar a este perfil";
				$("#profile-make-default").hidden = profile.id === snapshot.defaultId;
				$("#profile-default-copy").textContent = profile.id === snapshot.defaultId ? "Kitsune usa este perfil cuando lo abres sin elegir otro." : "Puedes usar este perfil al abrir Kitsune sin elegir otro.";
			}
			renderControls();
			updateGoogleStatus();
		}
		function accept(value) {
			snapshot = parseProfilesSnapshot(value);
			if (!snapshot.profiles.some((profile) => profile.id === selectedId)) selectedId = snapshot.currentId;
			ready = true;
		}
		async function load({ quiet = false } = {}) {
			if (busy) return;
			if (location.protocol === "file:") {
				ready = false;
				notice("Abre el inicio completo de Kitsune para gestionar los perfiles reales de este equipo.");
				$("#profiles-empty-copy").textContent = "Los perfiles no están disponibles en la copia de emergencia del inicio.";
				return;
			}
			setBusy(true, quiet ? "" : "Actualizando tus perfiles…");
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
				if (!quiet || dialog.open) notice("No se ha podido conectar con los perfiles. Tu navegación sigue funcionando.", true);
				$("#profiles-empty-copy").textContent = "No hemos podido cargar tus perfiles.";
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
					notice(formMode ? "Otra ventana ha cambiado los perfiles. Tu borrador se conserva; revísalo y guarda de nuevo." : "La lista ha cambiado. Revisa el perfil y vuelve a intentarlo.");
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
				name: $("#profile-name").value || "Nuevo espacio",
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
			$("#profile-name").value = profile?.name || "";
			$("#profile-email").value = profile?.email || "";
			$("#profile-form-title").textContent = profile ? "Editar perfil" : "Nuevo perfil";
			$("#profile-save span").textContent = profile ? "Guardar cambios" : "Crear perfil";
			$("#profile-form-note").textContent = profile ? "Tus marcadores y contraseñas no cambian." : "Un perfil independiente, guardado en este equipo.";
			$("#profile-form-error").hidden = true;
			notice();
			$("#profiles-operation").textContent = "";
			preview();
			render();
			$("#profile-name").focus();
		}
		trigger.addEventListener("click", () => {
			returnFocus = document.activeElement;
			if (!dialog.open) dialog.showModal();
			$("#profiles-title").focus({ preventScroll: true });
			load();
		});
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
			if ($("#profile-remember-google")) draft.rememberGoogle = $("#profile-remember-google").checked;
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
			$("#profiles-operation").textContent = creating ? "Perfil creado. Ábrelo cuando quieras empezar a usarlo." : "Detalles guardados en este equipo.";
			if (dialog.open) $("#profile-detail-name").focus({ preventScroll: true });
			else announce(creating ? "Perfil creado." : "Perfil actualizado.");
		});
		$("#profile-make-default").addEventListener("click", async () => {
			const profile = selectedProfile();
			if (!profile) return;
			if (await mutate(`/api/profiles/${encodeURIComponent(profile.id)}/default`, "POST", {}, "Cambiando el perfil predeterminado…")) {
				$("#profiles-operation").textContent = `${profile.name}: perfil predeterminado.`;
				if (dialog.open) $("#profile-open").focus({ preventScroll: true });
			}
		});
		async function openProfile(action) {
			const profile = selectedProfile();
			if (!profile) return;
			if (await mutate(`/api/profiles/${encodeURIComponent(profile.id)}/open`, "POST", { action }, "Abriendo…")) $("#profiles-operation").textContent = `Apertura solicitada en ${profile.name}.`;
		}
		$("#profile-open").addEventListener("click", () => void openProfile("home"));
		dialog.querySelectorAll("[data-profile-action]").forEach((button) => button.addEventListener("click", () => void openProfile(button.dataset.profileAction)));
		render();
		await load({ quiet: true });
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
			}
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
		return {
			refresh,
			save,
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
	const CSS_KEYS = {
		bg: "--bg",
		surface: "--surface",
		surfaceHigh: "--surface-high",
		text: "--text",
		muted: "--muted",
		outline: "--outline",
		primary: "--accent",
		primaryContainer: "--accent-dark",
		secondary: "--secondary",
		tertiary: "--tertiary"
	};
	function parseAppearance(value) {
		if (value?.version !== 1 || !WALLPAPERS.includes(value.wallpaper) || ![
			"wallpaper",
			"desktop",
			"manual"
		].includes(value.source) || typeof value.fingerprint !== "string" || !/^[a-f\d]{64}$/iu.test(value.fingerprint) || [
			"art",
			"motion",
			"themeSync"
		].some((key) => typeof value[key] !== "boolean") || !value.palette || PALETTE_KEYS.some((key) => typeof value.palette[key] !== "string" || !/^#[a-f\d]{6}$/iu.test(value.palette[key]))) throw new Error("Paleta no válida.");
		return value;
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
				art: settings.art ? "on" : "off",
				motion: settings.motion ? "on" : "off",
				focus: settings.focus ? "on" : "off",
				accent: settings.accent,
				wallpaper: settings.wallpaper,
				clock: settings.modules.clock ? "on" : "off",
				shortcuts: settings.modules.shortcuts ? "on" : "off"
			})) document.body.dataset[key] = value;
		}
		async function refresh() {
			if (!alive || document.hidden || location.protocol === "file:") return false;
			const run = ++generation;
			controller?.abort();
			const requestController = new AbortController();
			controller = requestController;
			const relevant = (settings) => JSON.stringify([
				settings.wallpaper,
				settings.accent,
				settings.themeSync,
				settings.art,
				settings.motion
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
				if (startedWith !== relevant(settings) || result.wallpaper !== settings.wallpaper || result.themeSync !== settings.themeSync || result.art !== settings.art || result.motion !== settings.motion) return false;
				for (const key of PALETTE_KEYS) {
					document.documentElement.style.setProperty(CSS_KEYS[key], result.palette[key]);
					document.documentElement.style.setProperty(`--kb-${key.replace(/[A-Z]/gu, (char) => `-${char.toLowerCase()}`)}`, result.palette[key]);
				}
				document.querySelector("meta[name=\"theme-color\"]")?.setAttribute("content", result.palette.bg);
				document.body.dataset.paletteSource = result.source;
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
					button.setAttribute("aria-label", `Editar ${item.name}`);
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
	//#region start/app.js
	let toastTimer;
	let mode = "all";
	let shortcuts;
	let appearance;
	const announce = (message) => {
		clearTimeout(toastTimer);
		$("#status").textContent = message;
		$("#status").hidden = !message;
		toastTimer = setTimeout(() => {
			$("#status").hidden = true;
		}, 4e3);
	};
	const toggles = {
		"art-toggle": "art",
		"motion-toggle": "motion",
		"newtab-toggle": "newTab",
		"theme-sync-toggle": "themeSync"
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
			document.querySelectorAll("button[data-accent]").forEach((button) => {
				button.setAttribute("aria-pressed", String(button.dataset.accent === settings.accent));
				button.disabled = !state.ready || settings.themeSync;
			});
			document.querySelectorAll("button[data-wallpaper]").forEach((button) => {
				button.setAttribute("aria-pressed", String(button.dataset.wallpaper === settings.wallpaper));
				button.disabled = !state.ready;
			});
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
	async function save(patch) {
		if (await store.save(patch)) await appearance.refresh();
	}
	for (const [id, key] of Object.entries(toggles)) $(`#${id}`).addEventListener("change", (event) => void save({ [key]: event.target.checked }));
	for (const key of ["clock", "shortcuts"]) $(`#module-${key}`).addEventListener("change", (event) => void save({ modules: { [key]: event.target.checked } }));
	document.querySelectorAll("button[data-accent]").forEach((button) => button.addEventListener("click", () => void save({ accent: button.dataset.accent })));
	document.querySelectorAll("button[data-wallpaper]").forEach((button) => button.addEventListener("click", () => void save({ wallpaper: button.dataset.wallpaper })));
	$("#focus-toggle").addEventListener("click", () => void save({ focus: !store.data.focus }));
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
		$("#clock-time").textContent = new Intl.DateTimeFormat("es-ES", {
			hour: "2-digit",
			minute: "2-digit"
		}).format(now);
		$("#date").dateTime = now.toISOString();
		$("#date").textContent = new Intl.DateTimeFormat("es-ES", {
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
	});
	initializeProfiles({ announce });
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

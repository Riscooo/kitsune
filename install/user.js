// KITSUNE // perfil aislado del motor propio
// Solo apariencia, inicio, búsqueda y usabilidad. La privacidad (bloqueo,
// cookies, anti-huella, telemetría…) la aplica el motor con su kitsune.cfg
// según el modo del perfil, Estricto o Cómodo: no se repite aquí.

// Native chrome and wallpaper-derived palette.
user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);
// Browser-owned close/maximize controls live inside the tab strip.
user_pref("browser.tabs.inTitlebar", 1);
user_pref("ui.systemUsesDarkTheme", 0);
user_pref("browser.theme.content-theme", 1);
user_pref("browser.theme.toolbar-theme", 1);
user_pref("browser.compactmode.show", true);
user_pref("svg.context-properties.content.enabled", true);

// Search and start behaviour.
// Google is configured once with the native SearchService during installation.
// Legacy defaultenginename prefs are ignored by modern Firefox; do not use them.
// Future changes made in Settings > Search remain the user's choice.
user_pref("keyword.enabled", true);
user_pref("browser.startup.homepage", "http://127.0.0.1:49721/");
user_pref("browser.startup.page", 3);
user_pref("browser.sessionstore.resume_from_crash", true);
user_pref("browser.sessionstore.restore_on_demand", true);
user_pref("browser.sessionstore.restore_pinned_tabs_on_demand", true);
user_pref("browser.sessionstore.interval", 30000);
user_pref("browser.sessionstore.max_tabs_undo", 25);
user_pref("browser.newtabpage.enabled", true);
user_pref("browser.newtabpage.activity-stream.showSearch", true);
user_pref("browser.newtabpage.activity-stream.feeds.topsites", false);
user_pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);
user_pref("browser.newtabpage.activity-stream.showSponsored", false);
user_pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false);
user_pref("browser.toolbars.bookmarks.visibility", "never");

// Keep local history/bookmark results, but do not send keystrokes for remote or
// sponsored address-bar suggestions.
user_pref("browser.search.suggest.enabled", false);
user_pref("browser.urlbar.suggest.searches", false);
user_pref("browser.urlbar.suggest.quicksuggest.nonsponsored", false);
user_pref("browser.urlbar.suggest.quicksuggest.sponsored", false);
user_pref("browser.urlbar.quicksuggest.enabled", false);
user_pref("browser.urlbar.trimHttps", false);
user_pref("security.insecure_connection_text.enabled", true);
user_pref("security.insecure_connection_text.pbmode.enabled", true);

// Signed extension policy and small usability improvements.
user_pref("xpinstall.signatures.required", true);
user_pref("extensions.autoDisableScopes", 15);
user_pref("extensions.update.enabled", true);
user_pref("middlemouse.paste", false);
user_pref("general.autoScroll", true);
user_pref("general.smoothScroll", true);
user_pref("browser.tabs.unloadOnLowMemory", true);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.aboutwelcome.enabled", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");

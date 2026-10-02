/**
 * A one-off, user-requested search migration, executed in the browser's chrome
 * context during installation. This module is NOT loaded by the launcher.
 *
 * The browser writes and verifies its own search settings. Never synthesize
 * search.json.mozlz4 hashes, edit prefs.js externally, install an unsigned
 * extension, or replace machine-wide enterprise policies to select an engine.
 *
 * Native API checked against LibreWolf 154's bundled SearchService and
 * UserSearchEngine modules, and Mozilla's SearchService source:
 * https://searchfox.org/firefox-main/source/toolkit/components/search/SearchService.sys.mjs
 */

export function searchSnapshot(search) {
  const query = 'Kitsune café & anime';
  const describe = engine => ({
    id: engine?.id ?? null,
    name: engine?.name ?? null,
    submission: engine?.getSubmission(query, 'text/html', 'searchbar')?.uri?.spec ?? null,
  });
  return {
    query,
    normal: describe(search.defaultEngine),
    private: describe(search.defaultPrivateEngine),
  };
}

export async function configureGoogle(search, prefs) {
  const marker = 'kitsune.migrations.googleSearch.v2';
  await search.init();
  const before = searchSnapshot(search);
  if (prefs.getBoolPref(marker, false)) {
    return { ok: true, alreadyApplied: true, before, after: before };
  }

  const template = 'https://www.google.com/search?q={searchTerms}';
  let engine = search.getEngineByName('Google');
  let created = false;
  let repaired = false;
  const isCorrect = candidate => {
    try {
      const submission = candidate.getSubmission(before.query, 'text/html', 'searchbar');
      const url = new URL(submission.uri.spec);
      return url.protocol === 'https:' && url.hostname === 'www.google.com' &&
        url.pathname === '/search' && url.searchParams.get('q') === before.query &&
        !submission.postData;
    } catch {
      return false;
    }
  };

  if (!engine) {
    engine = await search.addUserEngine({ name: 'Google', url: template, alias: '@google' });
    created = true;
  } else if (!isCorrect(engine)) {
    // The old Kitsune profile registered ?{searchTerms}, without the q= key.
    // Repair that user engine in place, preserving its identity and metadata.
    if (typeof engine.changeUrl !== 'function') {
      throw new Error('El motor Google existente no se puede corregir con la API de usuario.');
    }
    engine.changeUrl('text/html', template, null);
    repaired = true;
  }
  if (!isCorrect(engine)) {
    throw new Error('La URL nativa de búsqueda de Google no ha superado la comprobación.');
  }

  engine.hidden = false;
  await search.setDefault(engine, search.CHANGE_REASON.USER);
  await search.setDefaultPrivate(engine, search.CHANGE_REASON.USER);
  const after = searchSnapshot(search);
  if (after.normal.id !== engine.id || after.private.id !== engine.id) {
    throw new Error('Google no se ha activado en ambos modos del navegador.');
  }

  // Flush Firefox's normal delayed writer before marking the migration done.
  // This writes the browser-generated integrity metadata, not a hand-made file.
  await search._settings._ensurePendingWritesCompleted();
  for (const name of ['browser.search.defaultenginename', 'browser.search.defaultenginename.private']) {
    if (prefs.prefHasUserValue(name)) prefs.clearUserPref(name);
  }
  prefs.setBoolPref(marker, true);
  prefs.savePrefFile(null);
  return { ok: true, alreadyApplied: false, created, repaired, before, after };
}

// Pass this body to WebDriver /execute/async in its explicit chrome context.
// The WebDriver connection is temporary and must be closed after installation.
export const configureGoogleScript = `
const done = arguments[arguments.length - 1];
${searchSnapshot.toString()}
${configureGoogle.toString()}
(async () => {
  const { SearchService } = ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs');
  return configureGoogle(SearchService, Services.prefs);
})().then(done, error => done({ ok: false, error: String(error) }));
`;

export const inspectGoogleScript = `
const done = arguments[arguments.length - 1];
${searchSnapshot.toString()}
(async () => {
  const { SearchService } = ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs');
  await SearchService.init();
  return { ok: true, ...searchSnapshot(SearchService),
    migrationApplied: Services.prefs.getBoolPref('kitsune.migrations.googleSearch.v2', false),
    signedExtensionsRequired: Services.prefs.getBoolPref('xpinstall.signatures.required', true)
  };
})().then(done, error => done({ ok: false, error: String(error) }));
`;

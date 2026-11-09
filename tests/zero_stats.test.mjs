import assert from 'node:assert/strict';
import test from 'node:test';
import { dayKey, lastDays, emptyData, sanitize, addTime, addSearch, addPage, prune, categoryOf, summarize, formatDuration } from '../zero/modules/zero-stats.mjs';

// Las estadísticas de Zero (Risco, 9-11): dónde se pasa el tiempo, cuántas búsquedas y en qué se gasta.

test('days are local keys and the last N days end today, across month ends', () => {
  assert.equal(dayKey(new Date(2026, 10, 9, 23, 59)), '2026-11-09');
  assert.deepEqual(lastDays('2026-11-02', 4), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual(lastDays('2026-11-09', 1), ['2026-11-09']);
});

test('time adds up per site and day; bad sites, negative time and absurd totals are refused', () => {
  const data = emptyData();
  assert.ok(addTime(data, '2026-11-09', 'youtube.com', 5));
  addTime(data, '2026-11-09', 'YouTube.com', 10);
  assert.equal(data.days['2026-11-09'].sites['youtube.com'], 15);
  assert.equal(addTime(data, '2026-11-09', 'javascript:alert(1)', 5), false);
  assert.equal(addTime(data, '2026-11-09', 'github.com', -3), false);
  addTime(data, '2026-11-09', 'github.com', 90000);
  assert.equal(data.days['2026-11-09'].sites['github.com'], 86400);
  addSearch(data, '2026-11-09'); addSearch(data, '2026-11-09'); addPage(data, '2026-11-09');
  assert.equal(data.days['2026-11-09'].searches, 2);
  assert.equal(data.days['2026-11-09'].pages, 1);
});

test('what is read from disk is checked: anything with the wrong shape is dropped, nothing throws', () => {
  for (const value of [null, 3, 'x', { days: 5 }, { days: { 'no-es-un-dia': {} } }]) assert.deepEqual(sanitize(value), emptyData());
  const clean = sanitize({ days: { '2026-11-09': { sites: { 'a.com': 30, 'b c': 5, 'd.com': -1, 'e.com': 'x' }, searches: 3.4, pages: -2 } } });
  assert.deepEqual(clean.days['2026-11-09'], { sites: { 'a.com': 30 }, searches: 3, pages: 0 });
});

test('old days are pruned', () => {
  const data = sanitize({ days: { '2026-01-01': { sites: { 'a.com': 1 } }, '2026-11-09': { sites: { 'b.com': 1 } } } });
  prune(data, '2026-11-09', 90);
  assert.deepEqual(Object.keys(data.days), ['2026-11-09']);
});

test('sites fall into categories by their domain or a parent of it', () => {
  assert.equal(categoryOf('youtube.com'), 'video');
  assert.equal(categoryOf('m.youtube.com'), 'video');
  assert.equal(categoryOf('docs.google.com'), 'study');
  assert.equal(categoryOf('www.instagram.com'), 'social');
  assert.equal(categoryOf('claude.ai'), 'ai');
  assert.equal(categoryOf('ejemplo.org'), 'other');
});

test('the summary of a span sorts sites and categories by time and gives every day, even empty ones', () => {
  const data = emptyData();
  addTime(data, '2026-11-08', 'youtube.com', 600);
  addTime(data, '2026-11-09', 'youtube.com', 300);
  addTime(data, '2026-11-09', 'docs.google.com', 1200);
  addTime(data, '2026-11-09', 'twitch.tv', 100);
  addSearch(data, '2026-11-09'); addSearch(data, '2026-11-08');
  addPage(data, '2026-11-09');
  const today = summarize(data, '2026-11-09', 1);
  assert.equal(today.total, 1600);
  assert.equal(today.searches, 1);
  assert.deepEqual(today.sites.map(s => s.site), ['docs.google.com', 'youtube.com', 'twitch.tv']);
  assert.deepEqual(today.categories.map(c => [c.id, c.seconds]), [['study', 1200], ['video', 400]]);
  const week = summarize(data, '2026-11-09', 7);
  assert.equal(week.days.length, 7);
  assert.deepEqual(week.days.slice(-2).map(d => d.seconds), [600, 1600]);
  assert.equal(week.searches, 2);
  assert.equal(week.sites[0].site, 'docs.google.com');
  assert.equal(week.categories[0].id, 'study');
  assert.equal(week.categories[1].seconds, 1000);
});

test('durations read like people say them', () => {
  assert.equal(formatDuration(20), 'menos de 1 min');
  assert.equal(formatDuration(35 * 60), '35 min');
  assert.equal(formatDuration(2 * 3600 + 5 * 60), '2 h 05 min');
  assert.equal(formatDuration(3 * 3600), '3 h');
  assert.equal(formatDuration(10, (es, en) => en), 'under 1 min');
});

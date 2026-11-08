import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

/**
 * US-28 (#67) SEC-4: render every feature page on the server, signed out and
 * signed in. Signed out, a page must ask the person to sign in and must not
 * offer any user-id entry. Signed in, it must render its content without that
 * prompt. (Effects do not run in a server render, so no API call is made; the
 * network behaviour is covered by session-auth.test.js and the server suites.)
 */
const src = path.resolve(import.meta.dirname, '../src');
// These two load their data after mounting, so a server render shows only "Loading…".
const LOADS_AFTER_MOUNT = new Set(['AdminPage.jsx', 'PrivacyPage.jsx']);
const PAGES = fs.readdirSync(src).filter((f) => /Page\.jsx$/.test(f)).sort();

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.sessionStorage = globalThis.localStorage;

let vite;
before(async () => {
  vite = await createServer({ root: path.resolve(import.meta.dirname, '..'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
});
after(async () => {
  await vite.close();
});

async function render(file) {
  const mod = await vite.ssrLoadModule(`/src/${file}`);
  return renderToString(createElement(mod.default));
}

test('SEC-4 there is a page for every feature screen', () => {
  assert.ok(PAGES.length >= 14, PAGES.join(', '));
  for (const expected of ['AccountsPage', 'BudgetsPage', 'CategoriesPage', 'ChartsPage', 'DashboardPage', 'ImportExportPage', 'ReportsPage', 'TotalsPage', 'TransactionsPage', 'BillRemindersPage', 'RecurringPage', 'SavingsGoalsPage', 'AdminPage', 'PrivacyPage']) {
    assert.ok(PAGES.includes(`${expected}.jsx`), expected);
  }
});

for (const file of PAGES) {
  test(`SEC-4 ${file}: signed out it asks the person to sign in and offers no user-id box`, async () => {
    store.clear();
    const html = await render(file);

    assert.match(html, /Sign in/i, 'a sign-in prompt is shown');
    assert.match(html, /href="#\/"/, 'with a link to the sign-in screen');
    assert.doesNotMatch(html, /demo user|development user|seed:dev|X-User-Id|paste the id/i);
    assert.doesNotMatch(html, /<input[^>]*placeholder="[^"]*user id/i);
  });

  test(`SEC-4 ${file}: signed in it renders its content without the sign-in prompt`, async (t) => {
    store.clear();
    store.set('pfem_token', 'header.payload.signature');
    store.set('pfem_user', JSON.stringify({ name: 'Test Person' }));
    const html = await render(file);

    if (LOADS_AFTER_MOUNT.has(file)) assert.match(html, /Loading/, 'shows its loading state');
    else assert.ok(html.length > 300, 'the page rendered its content');
    assert.doesNotMatch(html, /Sign in to continue/i);
    assert.doesNotMatch(html, /demo user|development user|seed:dev|X-User-Id/i);
    t.diagnostic(`${file}: ${html.length} bytes`);
  });
}

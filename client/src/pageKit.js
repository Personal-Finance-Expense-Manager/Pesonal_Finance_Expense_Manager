import { authHeaders } from './auth.js';

/**
 * Shared look and API helper for the US-16 / US-17 pages. The palette and
 * component styles are the ones BudgetsPage and DashboardPage already use, so
 * the new pages match; they are collected here only so the two new pages do
 * not each carry a copy.
 */

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export const colors = {
  page: '#0b1120', card: '#172033', cardBorder: '#283449', input: '#101827',
  inputBorder: '#344054', text: '#f8fafc', muted: '#94a3b8', green: '#16a34a',
  amber: '#f59e0b', red: '#ef4444', redText: '#f87171',
};

export const inputStyle = {
  width: '100%', boxSizing: 'border-box', marginTop: 6, padding: '10px 12px',
  border: `1px solid ${colors.inputBorder}`, borderRadius: 9, background: colors.input,
  color: colors.text, fontSize: 15, colorScheme: 'dark',
};

export const labelStyle = { display: 'block', marginBottom: 14, fontSize: 14, fontWeight: 600, color: '#e2e8f0' };

export const cardStyle = {
  padding: 22, marginBottom: 18, background: colors.card,
  border: `1px solid ${colors.cardBorder}`, borderRadius: 16,
};

export const primaryButton = (busy) => ({
  padding: '10px 16px', border: 'none', borderRadius: 9, background: colors.green, color: '#fff',
  fontSize: 14, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
});

export const secondaryButton = {
  padding: '9px 14px', border: `1px solid ${colors.inputBorder}`, borderRadius: 9,
  background: 'transparent', color: '#e2e8f0', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};

export const dangerButton = { ...secondaryButton, borderColor: '#7f1d1d', color: '#fca5a5' };

export const mutedLink = { color: colors.muted, textDecoration: 'none' };


export function money(value, currency = 'INR') {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(Number(value));
  } catch {
    return `${currency} ${Number(value).toFixed(2)}`;
  }
}

export function niceDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

/** A small JSON client for the signed-in user (Bearer token only). */
export function makeApi() {
  return async function api(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.message || 'Something went wrong. Please try again.');
      err.errors = data.errors || {};
      err.status = response.status;
      throw err;
    }
    return data;
  };
}

/** Accounts and a flat category list for the form dropdowns. */
export async function loadChoices(api) {
  const [accounts, categories] = await Promise.all([api('/api/accounts'), api('/api/categories')]);
  const flat = [];
  for (const parent of categories.categories || []) {
    flat.push({ id: parent.id, name: parent.name, type: parent.type });
    for (const child of parent.children || []) {
      flat.push({ id: child.id, name: `${parent.name} › ${child.name}`, type: child.type || parent.type });
    }
  }
  return { accounts: accounts.accounts || [], categories: flat };
}

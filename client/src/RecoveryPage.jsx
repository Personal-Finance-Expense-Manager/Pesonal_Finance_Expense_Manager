import { useEffect, useState } from 'react';
import { authHeaders, isSignedIn } from './auth.js';
import SignInRequired from './SignInRequired.jsx';

async function fetchRecoveryItems(signal) {
  const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/recovery`, { headers: authHeaders(), signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || 'Recovery is unavailable.');
  return body.items;
}

export default function RecoveryPage() {
  const [items, setItems] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  async function load() {
    setLoading(true);
    setItems([]);
    try {
      setItems(await fetchRecoveryItems());
    } finally { setLoading(false); }
  }
  useEffect(() => {
    if (!isSignedIn()) return;
    // Initial loading state is already set. Only the asynchronous result changes it.
    const controller = new AbortController();
    fetchRecoveryItems(controller.signal)
      .then((result) => { if (!controller.signal.aborted) setItems(result); })
      .catch((error) => { if (!controller.signal.aborted) setMessage(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  async function restore(item) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/recovery/${item.resource}/${item.id}/restore`, { method: 'POST', headers: authHeaders() });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Could not restore this item.');
      await load();
      setMessage(`Restored ${item.name}.${item.resource === 'recurring-rules' ? ' It is paused for your review.' : ''}`);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  if (!isSignedIn()) return <SignInRequired />;
  return <main style={{ padding: 24, background: '#0f172a', color: '#f8fafc', minHeight: '80vh' }}>
    <a href="#/" style={{ color: '#86efac' }}>Home</a>
    <h1>Recovery</h1>
    <p>Accounts, budgets, categories, savings goals, receipts, bill reminders and recurring rules can be restored within 30 days of deletion. Financial history is retained. Transactions and transfers have their own <a href="#/transactions" style={{ color: '#86efac' }}>recycle bin</a>.</p>
    <p>Restore deleted dependencies such as accounts and categories before restoring a receipt or automation rule. Privacy account erasure is permanent and is excluded from Recovery.</p>
    {message && <p role="status">{message}</p>}
    {loading ? <p>Loading…</p> : !message && items.length === 0 ? <p>No recoverable items.</p> : null}
    <ul>{items.map((item) => <li key={`${item.resource}/${item.id}`} style={{ marginBottom: 16 }}>
      {item.name} ({item.resource}) — restore until {new Date(item.restorable_until).toLocaleString()}{' '}
      <button disabled={busy} onClick={() => restore(item)}>Restore</button>
    </li>)}</ul>
  </main>;
}

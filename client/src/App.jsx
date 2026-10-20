import { useEffect, useState } from 'react';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function App() {
  const [health, setHealth] = useState({ state: 'checking' });

  useEffect(() => {
    fetch(`${API_URL}/api/health`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => setHealth({ state: 'up', data }))
      .catch((error) => setHealth({ state: 'down', message: error.message }));
  }, []);

  return (
    <main className="shell">
      <header>
        <h1>Personal Finance &amp; Expense Manager</h1>
        <p className="tagline">Team 9 &middot; PES University &middot; Release 1.0</p>
      </header>

      <section className="status">
        <h2>API connection</h2>
        {health.state === 'checking' && <p>Checking {API_URL} &hellip;</p>}
        {health.state === 'up' && (
          <ul>
            <li>API: <strong className="ok">{health.data.status}</strong></li>
            <li>Database: <strong>{health.data.database}</strong></li>
            <li>Uptime: {health.data.uptimeSeconds}s</li>
          </ul>
        )}
        {health.state === 'down' && (
          <p className="bad">
            Cannot reach the API at {API_URL} ({health.message}).
            Start it with <code>npm run dev</code> in <code>server/</code>.
          </p>
        )}
      </section>

      <section className="next">
        <h2>Coming in Sprint 1</h2>
        <ol>
          <li>Register and sign in (US-03, US-04)</li>
          <li>Create accounts and see balances (US-06, US-07)</li>
          <li>Record expenses, income and transfers (US-08)</li>
          <li>Categories and tags (US-12, US-13)</li>
          <li>Dashboard and budgets (US-20, US-14)</li>
        </ol>
      </section>
    </main>
  );
}

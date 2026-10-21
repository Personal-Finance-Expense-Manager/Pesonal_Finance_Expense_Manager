
import { useEffect, useState } from 'react';

const API = 'http://localhost:5000/api';

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function TransactionsPage() {
  const [userId, setUserId] = useState(
    () => localStorage.getItem('pfem_dev_user_id') || '',
  );
  const [accounts, setAccounts] = useState([]);
  const [type, setType] = useState('expense');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [accountId, setAccountId] = useState('');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [paymentMode, setPaymentMode] = useState('upi');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadAccounts() {
    if (!userId.trim()) return;

    try {
      const response = await fetch(`${API}/accounts`, {
        headers: { 'X-User-Id': userId.trim() },
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Could not load accounts.');
      }

      const list = result.accounts || [];
      setAccounts(list);
      setAccountId((old) =>
        list.some((a) => a.id === old) ? old : list[0]?.id || '',
      );
      setFromId((old) =>
        list.some((a) => a.id === old) ? old : list[0]?.id || '',
      );
      setToId((old) =>
        list.some((a) => a.id === old)
          ? old
          : list.find((a) => a.id !== (list[0]?.id || ''))?.id || '',
      );
    } catch (error) {
      setMessage(error.message);
    }
  }

  useEffect(() => {
    loadAccounts();
  }, [userId]);

  async function submit(event) {
    event.preventDefault();
    setMessage('');

    if (!userId.trim()) {
      setMessage('Enter your development user ID.');
      return;
    }

    if (!accounts.length) {
      setMessage('Create an account first on the Accounts page.');
      return;
    }

    if (type === 'transfer' && (!fromId || !toId || fromId === toId)) {
      setMessage('Choose two different accounts for the transfer.');
      return;
    }

    const payload = {
      type,
      amount,
      transaction_date: date,
      note,
    };

    if (type === 'transfer') {
      payload.from_account_id = fromId;
      payload.to_account_id = toId;
    } else {
      payload.account_id = accountId;
      payload.payment_mode = paymentMode;
      payload.tags = tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
    }

    setBusy(true);

    try {
      localStorage.setItem('pfem_dev_user_id', userId.trim());

      const response = await fetch(`${API}/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId.trim(),
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok) {
        const details = result.errors
          ? Object.values(result.errors).join(' ')
          : result.message;
        throw new Error(details || 'Could not save transaction.');
      }

      setMessage(result.message || 'Transaction saved.');
      setAmount('');
      setNote('');
      setTags('');
      await loadAccounts();
    } catch (error) {
      setMessage(error.message || 'Request failed. Check that the server is running.');
    } finally {
      setBusy(false);
    }
  }

  const fieldStyle = {
    width: '100%',
    boxSizing: 'border-box',
    padding: 10,
    marginTop: 5,
    marginBottom: 14,
    borderRadius: 6,
    border: '1px solid #475569',
    background: '#111827',
    color: '#f8fafc',
  };

  const labelStyle = {
    display: 'block',
    color: '#cbd5e1',
    fontSize: 14,
  };

  return (
    <main style={{
      maxWidth: 620,
      margin: '32px auto',
      padding: 20,
      color: '#f8fafc',
      fontFamily: 'system-ui',
      background: '#0f172a',
      borderRadius: 12,
    }}>
      <h1>Record a transaction</h1>
      <p style={{ color: '#94a3b8' }}>
        Add income, expenses, or transfers between your accounts.
      </p>

      <nav style={{ display: 'flex', gap: 16, marginBottom: 22 }}>
        <a href="#/accounts" style={{ color: '#86efac' }}>Accounts</a>
        <a href="#/budgets" style={{ color: '#86efac' }}>Budgets</a>
      </nav>

      <form onSubmit={submit}>
        <label style={labelStyle}>
          Development user ID
          <input
            style={fieldStyle}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            required
          />
        </label>

        <label style={labelStyle}>
          Transaction type
          <select
            style={fieldStyle}
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="transfer">Transfer</option>
          </select>
        </label>

        <label style={labelStyle}>
          Amount
          <input
            style={fieldStyle}
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            placeholder="0.00"
          />
        </label>

        <label style={labelStyle}>
          Date
          <input
            style={fieldStyle}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </label>

        {type === 'transfer' ? (
          <>
            <label style={labelStyle}>
              From account
              <select
                style={fieldStyle}
                value={fromId}
                onChange={(e) => setFromId(e.target.value)}
                required
              >
                <option value="">Select source account</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency || 'INR'})
                  </option>
                ))}
              </select>
            </label>

            <label style={labelStyle}>
              To account
              <select
                style={fieldStyle}
                value={toId}
                onChange={(e) => setToId(e.target.value)}
                required
              >
                <option value="">Select destination account</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency || 'INR'})
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <>
            <label style={labelStyle}>
              Account
              <select
                style={fieldStyle}
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                required
              >
                <option value="">Select account</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency || 'INR'})
                  </option>
                ))}
              </select>
            </label>

            <label style={labelStyle}>
              Payment mode
              <select
                style={fieldStyle}
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value)}
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="upi">UPI</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="wallet">Wallet</option>
                <option value="other">Other</option>
              </select>
            </label>

            <label style={labelStyle}>
              Tags (comma-separated, up to 5)
              <input
                style={fieldStyle}
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="food, travel"
              />
            </label>
          </>
        )}

        <label style={labelStyle}>
          Note ({note.length}/200)
          <textarea
            style={{ ...fieldStyle, minHeight: 80 }}
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        {message && (
          <p
            role="status"
            style={{
              padding: 12,
              background: '#1e293b',
              borderRadius: 6,
              overflowWrap: 'anywhere',
            }}
          >
            {message}
          </p>
        )}

        <button
          disabled={busy}
          type="submit"
          style={{
            padding: '11px 20px',
            border: 0,
            borderRadius: 6,
            background: '#22c55e',
            color: '#052e16',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {busy ? 'Saving…' : 'Save transaction'}
        </button>
      </form>
    </main>
  );
}

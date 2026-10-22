import { useEffect, useState } from 'react';

const API = 'http://localhost:5000/api';
const PAGE_SIZE = 25;

const emptyFilters = {
  startDate: '',
  endDate: '',
  accountId: '',
  categoryId: '',
  type: '',
  tag: '',
  minAmount: '',
  maxAmount: '',
  search: '',
};

const emptyPagination = {
  page: 1,
  limit: PAGE_SIZE,
  totalItems: 0,
  totalPages: 0,
};

function today() {
  const date = new Date();

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function listFrom(result, key) {
  if (Array.isArray(result?.[key])) return result[key];
  if (Array.isArray(result?.data?.[key])) return result.data[key];
  if (Array.isArray(result?.data)) return result.data;

  return [];
}

function optionId(item) {
  return String(item?.id ?? item?._id ?? '');
}

async function apiRequest(path, userId, options = {}) {
  const response = await fetch(`${API}/${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      'X-User-Id': userId.trim(),
      ...options.headers,
    },
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.message || 'Request failed.');
  }

  return result;
}

const fieldStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: 10,
  marginTop: 5,
  borderRadius: 6,
  border: '1px solid #475569',
  background: '#111827',
  color: '#f8fafc',
};

const labelStyle = {
  display: 'block',
  color: '#cbd5e1',
  fontSize: 13,
  marginBottom: 12,
};

const buttonStyle = {
  border: 0,
  borderRadius: 6,
  padding: '10px 14px',
  background: '#22c55e',
  color: '#052e16',
  fontWeight: 700,
  cursor: 'pointer',
};

export default function TransactionsPage() {
  const [userId, setUserId] = useState(
    () => localStorage.getItem('pfem_dev_user_id') || '',
  );

  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [pagination, setPagination] = useState({ ...emptyPagination });
  const [totalAmount, setTotalAmount] = useState('0.00');

  const [filters, setFilters] = useState({ ...emptyFilters });
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);

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
  const [listMessage, setListMessage] = useState('');
  const [busy, setBusy] = useState(false);

  // Load the account and category options for the current development user.
  useEffect(() => {
    const id = userId.trim();

    if (!id) return;

    let cancelled = false;
    localStorage.setItem('pfem_dev_user_id', id);

    async function loadOptions() {
      try {
        const [accountResult, categoryResult] = await Promise.all([
          apiRequest('accounts', id),
          apiRequest('categories', id),
        ]);

        if (cancelled) return;

        const accountList = listFrom(accountResult, 'accounts');
        const categoryList = listFrom(categoryResult, 'categories');

        setAccounts(accountList);
        setCategories(categoryList);

        setAccountId((old) =>
          accountList.some((item) => optionId(item) === old)
            ? old
            : optionId(accountList[0]),
        );

        setFromId((old) =>
          accountList.some((item) => optionId(item) === old)
            ? old
            : optionId(accountList[0]),
        );

        // Keep the default destination distinct from the first account.
        setToId((old) => {
          const firstId = optionId(accountList[0]);
          const secondId = optionId(
            accountList.find((item) => optionId(item) !== firstId),
          );

          return accountList.some(
            (item) => optionId(item) === old && old !== firstId,
          )
            ? old
            : secondId;
        });
      } catch (error) {
        if (!cancelled) {
          setMessage(error.message);
        }
      }
    }

    loadOptions();

    return () => {
      cancelled = true;
    };
  }, [userId, refresh]);

  // Load the requested page of filtered transactions.
  useEffect(() => {
    const id = userId.trim();

    if (!id) return;

    const controller = new AbortController();

    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
    });

    Object.entries(filters).forEach(([key, value]) => {
      if (value.trim()) {
        params.set(key, value.trim());
      }
    });

    async function loadTransactions() {
      try {
        const result = await apiRequest(
          `transactions?${params.toString()}`,
          id,
          { signal: controller.signal },
        );

        setTransactions(
          Array.isArray(result.data) ? result.data : [],
        );

        setPagination(
          result.pagination || {
            ...emptyPagination,
            page,
          },
        );

        setTotalAmount(result.totalAmount ?? '0.00');
        setListMessage('');
      } catch (error) {
        if (error.name === 'AbortError') return;

        setTransactions([]);
        setPagination({ ...emptyPagination, page });
        setTotalAmount('0.00');
        setListMessage(error.message);
      }
    }

    loadTransactions();

    return () => controller.abort();
  }, [userId, filters, page, refresh]);

  function handleUserIdChange(event) {
    const value = event.target.value;

    setUserId(value);
    setPage(1);

    if (!value.trim()) {
      setAccounts([]);
      setCategories([]);
      setTransactions([]);
      setPagination({ ...emptyPagination });
      setTotalAmount('0.00');
      setListMessage('');
      setMessage('');
    }
  }

  function updateFilter(event) {
    const { name, value } = event.target;

    setFilters((old) => ({
      ...old,
      [name]: value,
    }));

    setPage(1);
  }

  function clearFilters() {
    setFilters({ ...emptyFilters });
    setPage(1);
  }

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

    if (
      type === 'transfer' &&
      (!fromId || !toId || fromId === toId)
    ) {
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
      await apiRequest('transactions', userId, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setMessage('Transaction created successfully.');
      setAmount('');
      setNote('');
      setTags('');
      setPage(1);
      setRefresh((value) => value + 1);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  const hasUserId = Boolean(userId.trim());

  return (
    <main
      style={{
        maxWidth: 1200,
        margin: '24px auto',
        padding: 20,
        color: '#f8fafc',
        fontFamily: 'system-ui',
        background: '#0f172a',
        borderRadius: 12,
      }}
    >
      <h1>Transactions</h1>

      <nav style={{ display: 'flex', gap: 16, marginBottom: 22 }}>
        <a href="#/accounts" style={{ color: '#86efac' }}>
          Accounts
        </a>
        <a href="#/budgets" style={{ color: '#86efac' }}>
          Budgets
        </a>
      </nav>

      <label style={labelStyle}>
        Development user ID
        <input
          style={fieldStyle}
          value={userId}
          onChange={handleUserIdChange}
          placeholder="Enter development user ID"
          required
        />
      </label>

      <h2>Browse transactions</h2>

      <p style={{ color: '#94a3b8' }}>
        Filter transactions and search within their notes.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <label style={labelStyle}>
          Start date
          <input
            style={fieldStyle}
            type="date"
            name="startDate"
            value={filters.startDate}
            onChange={updateFilter}
          />
        </label>

        <label style={labelStyle}>
          End date
          <input
            style={fieldStyle}
            type="date"
            name="endDate"
            value={filters.endDate}
            onChange={updateFilter}
          />
        </label>

        <label style={labelStyle}>
          Account
          <select
            style={fieldStyle}
            name="accountId"
            value={filters.accountId}
            onChange={updateFilter}
          >
            <option value="">All accounts</option>
            {accounts.map((account) => (
              <option
                key={optionId(account)}
                value={optionId(account)}
              >
                {account.name}
              </option>
            ))}
          </select>
        </label>

        <label style={labelStyle}>
          Category
          <select
            style={fieldStyle}
            name="categoryId"
            value={filters.categoryId}
            onChange={updateFilter}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option
                key={optionId(category)}
                value={optionId(category)}
              >
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <label style={labelStyle}>
          Transaction type
          <select
            style={fieldStyle}
            name="type"
            value={filters.type}
            onChange={updateFilter}
          >
            <option value="">All types</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>
        </label>

        <label style={labelStyle}>
          Tag
          <input
            style={fieldStyle}
            name="tag"
            value={filters.tag}
            onChange={updateFilter}
            placeholder="e.g. food"
          />
        </label>

        <label style={labelStyle}>
          Minimum amount
          <input
            style={fieldStyle}
            type="number"
            min="0"
            step="0.01"
            name="minAmount"
            value={filters.minAmount}
            onChange={updateFilter}
          />
        </label>

        <label style={labelStyle}>
          Maximum amount
          <input
            style={fieldStyle}
            type="number"
            min="0"
            step="0.01"
            name="maxAmount"
            value={filters.maxAmount}
            onChange={updateFilter}
          />
        </label>

        <label style={labelStyle}>
          Search note
          <input
            style={fieldStyle}
            name="search"
            value={filters.search}
            onChange={updateFilter}
            maxLength={200}
            placeholder="Search transaction notes"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={clearFilters}
        style={buttonStyle}
      >
        Clear filters
      </button>

      <p style={{ color: '#cbd5e1' }} role="status">
        {!hasUserId
          ? 'Enter your development user ID to browse transactions.'
          : listMessage ||
            `Matching transactions: ${pagination.totalItems}`}
      </p>

      <p style={{ color: '#cbd5e1' }}>
        Filtered amount total: {totalAmount}
      </p>

      <div style={{ overflowX: 'auto', marginBottom: 12 }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            minWidth: 800,
            textAlign: 'left',
          }}
        >
          <thead>
            <tr
              style={{
                color: '#86efac',
                borderBottom: '1px solid #475569',
              }}
            >
              {[
                'Date',
                'Category',
                'Account',
                'Note',
                'Type',
                'Amount',
                'Tags',
              ].map((heading) => (
                <th key={heading} style={{ padding: 10 }}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {transactions.map((item) => (
              <tr
                key={item.id}
                style={{ borderBottom: '1px solid #334155' }}
              >
                <td style={{ padding: 10 }}>
                  {item.transaction_date
                    ? new Date(
                        item.transaction_date,
                      ).toLocaleDateString()
                    : '—'}
                </td>

                <td style={{ padding: 10 }}>
                  {item.category_name || 'Uncategorized'}
                </td>

                <td style={{ padding: 10 }}>
                  {item.account_name || '—'}
                </td>

                <td
                  style={{
                    padding: 10,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {item.note || '—'}
                </td>

                <td style={{ padding: 10 }}>
                  {item.type}
                </td>

                <td style={{ padding: 10 }}>
                  {item.currency || 'INR'} {item.amount}
                </td>

                <td style={{ padding: 10 }}>
                  {(item.tags || []).join(', ') || '—'}
                </td>
              </tr>
            ))}

            {hasUserId &&
              !transactions.length &&
              !listMessage && (
                <tr>
                  <td
                    colSpan={7}
                    style={{
                      padding: 16,
                      color: '#94a3b8',
                    }}
                  >
                    No matching transactions found.
                  </td>
                </tr>
              )}
          </tbody>
        </table>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          marginBottom: 36,
        }}
      >
        <button
          type="button"
          style={buttonStyle}
          disabled={!hasUserId || page <= 1}
          onClick={() =>
            setPage((value) => Math.max(1, value - 1))
          }
        >
          Previous
        </button>

        <span>
          Page {page} of {Math.max(1, pagination.totalPages)}
        </span>

        <button
          type="button"
          style={buttonStyle}
          disabled={
            !hasUserId ||
            page >= pagination.totalPages ||
            pagination.totalPages === 0
          }
          onClick={() => setPage((value) => value + 1)}
        >
          Next
        </button>
      </div>

      <hr style={{ borderColor: '#334155' }} />

      <h2>Record a transaction</h2>

      <p style={{ color: '#94a3b8' }}>
        Add an income or expense and refresh the list automatically.
      </p>

      <form onSubmit={submit}>
        <label style={labelStyle}>
          Transaction type
          <select
            style={fieldStyle}
            value={type}
            onChange={(event) => setType(event.target.value)}
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
            onChange={(event) => setAmount(event.target.value)}
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
            onChange={(event) => setDate(event.target.value)}
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
                onChange={(event) => setFromId(event.target.value)}
                required
              >
                <option value="">Select source account</option>
                {accounts.map((account) => (
                  <option
                    key={optionId(account)}
                    value={optionId(account)}
                  >
                    {account.name} ({account.currency || 'INR'})
                  </option>
                ))}
              </select>
            </label>

            <label style={labelStyle}>
              To account
              <select
                style={fieldStyle}
                value={toId}
                onChange={(event) => setToId(event.target.value)}
                required
              >
                <option value="">Select destination account</option>
                {accounts.map((account) => (
                  <option
                    key={optionId(account)}
                    value={optionId(account)}
                  >
                    {account.name} ({account.currency || 'INR'})
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <label style={labelStyle}>
            Account
            <select
              style={fieldStyle}
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              required
            >
              <option value="">Select account</option>
              {accounts.map((account) => (
                <option
                  key={optionId(account)}
                  value={optionId(account)}
                >
                  {account.name} ({account.currency || 'INR'})
                </option>
              ))}
            </select>
          </label>
        )}

        {type !== 'transfer' && (
          <>
            <label style={labelStyle}>
              Payment mode
              <select
                style={fieldStyle}
                value={paymentMode}
                onChange={(event) => setPaymentMode(event.target.value)}
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
                onChange={(event) => setTags(event.target.value)}
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
            onChange={(event) => setNote(event.target.value)}
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
          style={buttonStyle}
        >
          {busy ? 'Saving…' : 'Save transaction'}
        </button>
      </form>
    </main>
  );
}
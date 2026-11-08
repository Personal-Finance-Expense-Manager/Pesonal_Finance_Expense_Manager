import { Fragment, useCallback, useEffect, useState } from 'react';
import { authHeaders, isSignedIn } from './auth.js';
import {
  enqueue, flush, pendingCount, failedCount, pending, retry, clearFailed,
  FLUSH_INTERVAL_MS,
} from './offlineQueue.js';
import ReceiptAttachments from './ReceiptAttachments.jsx';
import SignInRequired from './SignInRequired.jsx';
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_RULES,
  MAX_ATTACHMENTS,
  checkAttachment,
  uploadAttachment,
} from './receipts.js';

const API = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;
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

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API}/${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(),
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

  // US-11 (#27): a category on the form itself, a split bill (REQ-32), and
  // keeping a reimbursable item out of budgets (REQ-33).
  const [formCategoryId, setFormCategoryId] = useState('');
  const [splitting, setSplitting] = useState(false);
  const [splitRows, setSplitRows] = useState([
    { category_id: '', amount: '' },
    { category_id: '', amount: '' },
  ]);
  const [excludeFromBudget, setExcludeFromBudget] = useState(false);

  // REQ-34: transactions typed while offline, and whether we are offline now.
  const [offline, setOffline] = useState(() => !navigator.onLine);
  const [queued, setQueued] = useState(() => pendingCount());
  const [rejected, setRejected] = useState(() => failedCount());

  // US-23: receipts chosen in the form, and the row whose receipts are open.
  const [receiptFiles, setReceiptFiles] = useState([]);
  const [receiptInputKey, setReceiptInputKey] = useState(0);
  const [openReceipts, setOpenReceipts] = useState('');

  // REQ-41: tags this user has used before, for type-ahead suggestions (US-13).
  const [knownTags, setKnownTags] = useState([]);

  const [message, setMessage] = useState('');
  const [listMessage, setListMessage] = useState('');
  const [busy, setBusy] = useState(false);

  // Load the account and category options for the signed-in user.
  useEffect(() => {
    if (!isSignedIn()) return;

    let cancelled = false;

    async function loadOptions() {
      try {
        const [accountResult, categoryResult] = await Promise.all([
          apiRequest('accounts'),
          apiRequest('categories'),
        ]);

        // Previously used tags (REQ-41). A failure here must not stop the page
        // loading, so it is handled separately and ignored on error.
        apiRequest('tags')
          .then((tagResult) => {
            if (!cancelled) setKnownTags(listFrom(tagResult, 'tags'));
          })
          .catch(() => {});

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
  }, [refresh]);

  // Load the requested page of filtered transactions.
  useEffect(() => {
    if (!isSignedIn()) return;

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
  }, [filters, page, refresh]);

  /**
   * Append a suggested tag to the comma-separated list (REQ-41), unless it is
   * already there or the five-tag limit has been reached (REQ-27).
   */
  function addTag(name) {
    setTags((current) => {
      const existing = current
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);

      if (existing.some((tag) => tag.toLowerCase() === name.toLowerCase())) {
        return current;
      }

      if (existing.length >= 5) return current;

      return [...existing, name].join(', ');
    });
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

  // REQ-80: check receipts in the browser before anything is uploaded.
  function chooseReceipts(event) {
    const files = Array.from(event.target.files || []);
    const problem =
      files.length > MAX_ATTACHMENTS
        ? `A transaction can have at most ${MAX_ATTACHMENTS} attachments.`
        : files.map(checkAttachment).find(Boolean);

    if (problem) {
      setMessage(problem);
      setReceiptFiles([]);
      setReceiptInputKey((value) => value + 1);
      return;
    }

    setMessage('');
    setReceiptFiles(files);
  }

  /**
   * Post one transaction - REQ-34.
   *
   * Used both for a live save and for draining the offline queue, so a
   * transaction that was queued goes to the server exactly as it would have
   * done at the time it was typed.
   */
  const sendTransaction = useCallback(
    async (payload) => {
      const response = await fetch(`${API}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      });

      const body = await response.json().catch(() => ({}));

      return {
        ok: response.ok,
        status: response.status,
        message: body.message || '',
        data: body.data,
      };
    },
    []
  );

  /** Drain the queue and report what happened - REQ-34. */
  const drainQueue = useCallback(async () => {
    if (pendingCount() === 0) return;

    const result = await flush(sendTransaction);

    setQueued(pendingCount());
    setRejected(failedCount());

    if (result.sent > 0) {
      setMessage(
        `${result.sent} transaction${result.sent === 1 ? '' : 's'} recorded offline ${result.sent === 1 ? 'has' : 'have'} been sent.`
      );
      setRefresh((value) => value + 1);
    }
  }, [sendTransaction]);

  // REQ-34: send within sixty seconds of connectivity returning. The browser
  // event covers the usual case; the timer covers a connection that comes
  // back without one firing, which happens after sleep or a captive portal.
  useEffect(() => {
    function onOnline() {
      setOffline(false);
      drainQueue();
    }

    function onOffline() {
      setOffline(true);
    }

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    const timer = window.setInterval(() => {
      if (navigator.onLine) drainQueue();
    }, FLUSH_INTERVAL_MS);

    drainQueue();

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearInterval(timer);
    };
  }, [drainQueue]);

  /** Clear the entry fields after a save, online or queued. */
  function resetForm() {
    setAmount('');
    setNote('');
    setTags('');
    setReceiptFiles([]);
    setReceiptInputKey((value) => value + 1);
    setSplitting(false);
    setSplitRows([
      { category_id: '', amount: '' },
      { category_id: '', amount: '' },
    ]);
    setExcludeFromBudget(false);
  }

  async function submit(event) {
    event.preventDefault();
    setMessage('');

    // The caller is identified by the session token (US-25, REQ-93).
    if (!isSignedIn()) {
      setMessage('Sign in to add transactions.');
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

      // REQ-33: keep a reimbursable or one-off item out of budgets.
      payload.is_excluded_from_budget = excludeFromBudget;

      // REQ-32: a split bill carries its own category attribution, so the
      // single category is sent only when the bill is not split.
      if (type === 'expense' && splitting) {
        const rows = splitRows
          .map((row) => ({ category_id: row.category_id, amount: row.amount.trim() }))
          .filter((row) => row.category_id || row.amount);

        if (rows.length < 2) {
          setMessage('A split needs at least two categories.');
          return;
        }

        if (rows.some((row) => !row.category_id)) {
          setMessage('Choose a category for every split.');
          return;
        }

        // Checked here as well as on the server so the mistake is caught
        // before the request, and before it can be queued while offline.
        const sum = rows.reduce((total, row) => total + Number(row.amount || 0), 0);

        if (Math.abs(sum - Number(amount || 0)) > 0.004) {
          setMessage(
            `The split amounts add up to ${sum.toFixed(2)}, but the transaction is ${Number(amount || 0).toFixed(2)}.`
          );
          return;
        }

        payload.splits = rows;
      } else if (formCategoryId) {
        payload.category_id = formCategoryId;
      }
    }

    // REQ-34: with no network the transaction is held rather than lost, and
    // sent once connectivity returns. Receipts need the server, so a queued
    // transaction keeps none - the deviation is recorded in DEVIATIONS.md.
    if (!navigator.onLine) {
      enqueue(payload);
      setQueued(pendingCount());
      setMessage(
        'You are offline. This transaction has been saved on this device and will be sent when the connection returns.'
      );
      resetForm();
      return;
    }

    setBusy(true);

    try {
      const created = await apiRequest('transactions', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      // US-23: upload any receipts to the new transaction.
      let receiptNote = '';
      const newId = created?.data?.id;

      if (type !== 'transfer' && newId && receiptFiles.length) {
        const failed = [];

        for (const file of receiptFiles) {
          try {
            await uploadAttachment(newId, file);
          } catch (error) {
            failed.push(`${file.name}: ${error.message}`);
          }
        }

        receiptNote = failed.length
          ? ` Some receipts were not attached - ${failed.join(' ')}`
          : ` ${receiptFiles.length} receipt(s) attached.`;
      }

      setMessage(`Transaction created successfully.${receiptNote}`);
      resetForm();
      setPage(1);
      setRefresh((value) => value + 1);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  const signedIn = isSignedIn();

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

      {/* REQ-34: offline state and anything waiting to be sent. */}
      {(offline || queued > 0 || rejected > 0) && (
        <div
          style={{
            margin: '0 0 18px',
            padding: '12px 14px',
            borderRadius: 10,
            border: `1px solid ${offline ? '#7c5e10' : '#334155'}`,
            background: offline ? '#1f1703' : '#0f172a',
            fontSize: 14,
          }}
          role="status"
        >
          {offline && (
            <div style={{ fontWeight: 600, marginBottom: queued || rejected ? 6 : 0 }}>
              You are offline. Transactions are saved on this device and sent when the
              connection returns.
            </div>
          )}

          {queued > 0 && (
            <div style={{ color: '#cbd5e1' }}>
              {queued} transaction{queued === 1 ? '' : 's'} waiting to be sent.
            </div>
          )}

          {rejected > 0 && (
            <div style={{ color: '#fca5a5', marginTop: 6 }}>
              {rejected} offline transaction{rejected === 1 ? ' was' : 's were'} refused by
              the server and {rejected === 1 ? 'is' : 'are'} still saved here:
              <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                {pending()
                  .filter((entry) => entry.status === 'failed')
                  .map((entry) => (
                    <li key={entry.id} style={{ marginBottom: 4 }}>
                      {entry.body.amount} on{' '}
                      {new Date(entry.queued_at).toLocaleString('en-GB')} - {entry.message}{' '}
                      <button
                        type="button"
                        onClick={() => {
                          retry(entry.id);
                          setQueued(pendingCount());
                          setRejected(failedCount());
                        }}
                        style={{
                          marginLeft: 6, padding: '2px 8px', borderRadius: 6,
                          border: '1px solid #334155', background: 'transparent',
                          color: '#e2e8f0', cursor: 'pointer', fontSize: 12,
                        }}
                      >
                        Try again
                      </button>
                    </li>
                  ))}
              </ul>
              <button
                type="button"
                onClick={() => {
                  clearFailed();
                  setQueued(pendingCount());
                  setRejected(failedCount());
                }}
                style={{
                  marginTop: 8, padding: '4px 10px', borderRadius: 6,
                  border: '1px solid #334155', background: 'transparent',
                  color: '#94a3b8', cursor: 'pointer', fontSize: 12,
                }}
              >
                Discard them
              </button>
            </div>
          )}
        </div>
      )}

      <nav style={{ display: 'flex', gap: 16, marginBottom: 22 }}>
        <a href="#/accounts" style={{ color: '#86efac' }}>
          Accounts
        </a>
        <a href="#/budgets" style={{ color: '#86efac' }}>
          Budgets
        </a>
      </nav>

      {!isSignedIn() && <SignInRequired what="transactions" />}

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
            list="pfem-tag-suggestions"
          />
          <datalist id="pfem-tag-suggestions">
            {knownTags.map((tag) => (
              <option key={tag.id} value={tag.name} />
            ))}
          </datalist>
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
        {!signedIn
          ? 'Sign in to browse transactions.'
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
                'Receipts',
              ].map((heading) => (
                <th key={heading} style={{ padding: 10 }}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {transactions.map((item) => (
              <Fragment key={item.id}>
              <tr
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

                {/* US-23 (REQ-79): receipts are shown against the transaction. */}
                <td style={{ padding: 10 }}>
                  <button
                    type="button"
                    aria-expanded={openReceipts === item.id}
                    aria-label={`Receipts for this transaction: ${item.attachment_count || 0}`}
                    onClick={() =>
                      setOpenReceipts((current) =>
                        current === item.id ? '' : item.id,
                      )
                    }
                    style={{
                      padding: '4px 10px',
                      borderRadius: 999,
                      border: '1px solid #475569',
                      background: openReceipts === item.id ? '#14532d' : 'transparent',
                      color: '#e2e8f0',
                      cursor: 'pointer',
                    }}
                  >
                    📎 {item.attachment_count || 0}
                  </button>
                </td>
              </tr>

              {openReceipts === item.id && (
                <tr style={{ borderBottom: '1px solid #334155', background: '#0b1220' }}>
                  <td colSpan={8}>
                    <ReceiptAttachments
                      transactionId={item.id}
                      onChange={() => setRefresh((value) => value + 1)}
                    />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}

            {signedIn &&
              !transactions.length &&
              !listMessage && (
                <tr>
                  <td
                    colSpan={8}
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
          disabled={!signedIn || page <= 1}
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
            !signedIn ||
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
            {/* US-11 REQ-32: one category, or a split across up to five. */}
            {!splitting && (
              <label style={labelStyle}>
                Category
                <select
                  style={fieldStyle}
                  value={formCategoryId}
                  onChange={(event) => setFormCategoryId(event.target.value)}
                >
                  <option value="">Uncategorised</option>
                  {categories
                    .filter((category) => (category.type || 'expense') === type)
                    .map((category) => (
                      <option key={optionId(category)} value={optionId(category)}>
                        {category.name}
                      </option>
                    ))}
                </select>
              </label>
            )}

            {type === 'expense' && (
              <label
                style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14, cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={splitting}
                  onChange={(event) => setSplitting(event.target.checked)}
                  style={{ width: 16, height: 16 }}
                />
                Split this bill across categories
              </label>
            )}

            {type === 'expense' && splitting && (
              <div
                style={{
                  padding: 14,
                  border: '1px solid #334155',
                  borderRadius: 10,
                  background: '#0f172a',
                }}
              >
                <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 10 }}>
                  The parts must add up to the transaction amount, across at most 5
                  categories. REQ-32
                </div>

                {splitRows.map((row, index) => (
                  <div
                    key={index}
                    style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}
                  >
                    <select
                      style={{ ...fieldStyle, flex: 2, marginTop: 0 }}
                      value={row.category_id}
                      onChange={(event) => {
                        const next = [...splitRows];
                        next[index] = { ...next[index], category_id: event.target.value };
                        setSplitRows(next);
                      }}
                    >
                      <option value="">Choose a category</option>
                      {categories
                        .filter((category) => (category.type || 'expense') === 'expense')
                        .map((category) => (
                          <option key={optionId(category)} value={optionId(category)}>
                            {category.name}
                          </option>
                        ))}
                    </select>

                    <input
                      style={{ ...fieldStyle, flex: 1, marginTop: 0 }}
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={row.amount}
                      onChange={(event) => {
                        const next = [...splitRows];
                        next[index] = { ...next[index], amount: event.target.value };
                        setSplitRows(next);
                      }}
                    />

                    {splitRows.length > 2 && (
                      <button
                        type="button"
                        onClick={() => setSplitRows(splitRows.filter((_, i) => i !== index))}
                        style={{
                          padding: '6px 10px', borderRadius: 8, border: '1px solid #334155',
                          background: 'transparent', color: '#94a3b8', cursor: 'pointer',
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}

                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
                  {splitRows.length < 5 && (
                    <button
                      type="button"
                      onClick={() => setSplitRows([...splitRows, { category_id: '', amount: '' }])}
                      style={{
                        padding: '7px 12px', borderRadius: 8, border: '1px solid #334155',
                        background: 'transparent', color: '#e2e8f0', cursor: 'pointer', fontSize: 13,
                      }}
                    >
                      Add a category
                    </button>
                  )}

                  {(() => {
                    const sum = splitRows.reduce((total, row) => total + Number(row.amount || 0), 0);
                    const target = Number(amount || 0);
                    const matches = Math.abs(sum - target) <= 0.004;

                    return (
                      <span style={{ fontSize: 13, color: matches ? '#4ade80' : '#f87171' }}>
                        Split total {sum.toFixed(2)} of {target.toFixed(2)}
                        {matches ? '' : ` — ${(target - sum).toFixed(2)} left to allocate`}
                      </span>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* REQ-33: a reimbursable item still counts in balances and
                reports, but must not distort budget utilisation. */}
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14, cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={excludeFromBudget}
                onChange={(event) => setExcludeFromBudget(event.target.checked)}
                style={{ width: 16, height: 16 }}
              />
              Exclude from budgets (reimbursable or one-off)
            </label>

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
              {/* REQ-41: suggest tags this user has used before. */}
              {knownTags.length > 0 && (
                <span style={{ display: 'block', marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 400 }}>
                    Used before:
                  </span>
                  {knownTags.slice(0, 8).map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => addTag(tag.name)}
                      style={{
                        marginLeft: 6,
                        marginTop: 6,
                        padding: '3px 9px',
                        borderRadius: 999,
                        border: '1px solid #344054',
                        background: 'transparent',
                        color: '#cbd5e1',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      {tag.name}
                    </button>
                  ))}
                </span>
              )}
            </label>
          </>
        )}

        {type !== 'transfer' && (
          <label style={labelStyle}>
            Receipts (optional - {ATTACHMENT_RULES})
            <input
              key={receiptInputKey}
              style={fieldStyle}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              multiple
              onChange={chooseReceipts}
            />
          </label>
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
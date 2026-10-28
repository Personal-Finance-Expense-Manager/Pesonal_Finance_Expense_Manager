import { useState } from 'react';
import { authHeaders, isSignedIn } from './auth.js';

/**
 * Import and export - US-24 (#58), SRS 5.9, REQ-82 to REQ-87.
 *
 * Open it at http://localhost:5173/#/data
 *
 *   - Export transactions for a date range as CSV (REQ-82)
 *   - Import a CSV: preview and column mapping before anything is written
 *     (REQ-83), invalid rows listed by row number and reason (REQ-84),
 *     probable duplicates skipped unless ticked (REQ-85)
 *   - Export everything as one JSON file (REQ-87)
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const DEV_USER_KEY = 'pfem_dev_user_id';

// The CSV travels inside a JSON request, and the API accepts 1 MB of JSON.
const MAX_FILE_BYTES = 900 * 1024;
const PREVIEW_ROWS = 50;

const COLUMNS = [
  ['date', 'YYYY-MM-DD'],
  ['type', 'income, expense or transfer'],
  ['amount', 'plain decimal, e.g. 1234.50'],
  ['currency', 'e.g. INR'],
  ['account', 'account name'],
  ['to_account', 'transfers only'],
  ['category', 'category name, or blank'],
  ['payment_mode', 'cash, card, upi, bank_transfer, wallet, other'],
  ['note', 'free text'],
  ['tags', 'separated by ;'],
];

const colors = {
  page: '#0b1120',
  card: '#172033',
  cardBorder: '#283449',
  input: '#101827',
  inputBorder: '#344054',
  text: '#f8fafc',
  muted: '#94a3b8',
  green: '#16a34a',
  greenSoft: '#86efac',
  red: '#f87171',
  amber: '#fbbf24',
};

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  marginTop: 6,
  padding: '10px 12px',
  border: `1px solid ${colors.inputBorder}`,
  borderRadius: 9,
  background: colors.input,
  color: colors.text,
  fontSize: 15,
};

const labelStyle = { display: 'block', fontSize: 14, fontWeight: 600, color: '#e2e8f0' };

const cardStyle = {
  padding: 22,
  marginBottom: 18,
  background: colors.card,
  border: `1px solid ${colors.cardBorder}`,
  borderRadius: 16,
};

const primaryButton = {
  padding: '10px 16px',
  borderRadius: 9,
  border: 'none',
  background: colors.green,
  color: '#fff',
  fontWeight: 700,
  fontSize: 14,
  cursor: 'pointer',
};

const secondaryButton = {
  ...primaryButton,
  background: 'transparent',
  border: `1px solid ${colors.inputBorder}`,
  color: '#e2e8f0',
  fontWeight: 600,
};

const cell = { padding: '8px 10px', borderTop: `1px solid ${colors.cardBorder}`, verticalAlign: 'top' };

function readStoredUserId() {
  try {
    return localStorage.getItem(DEV_USER_KEY) || '';
  } catch {
    return '';
  }
}

async function request(path, userId, options = {}) {
  const response = await fetch(`${API_URL}/api/${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(userId),
      ...options.headers,
    },
  });
  return response;
}

async function json(path, userId, options) {
  const response = await request(path, userId, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || (response.status === 413 ? 'That file is too large.' : 'Request failed.'));
  }
  return body;
}

/** Download a file from an authenticated endpoint. */
async function download(path, userId, fallbackName) {
  const response = await request(path, userId);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || 'Download failed.');
  }
  const disposition = response.headers.get('Content-Disposition') || '';
  const name = disposition.match(/filename="([^"]+)"/)?.[1] || fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

export default function ImportExportPage() {
  const [userId, setUserId] = useState(readStoredUserId);
  const [userIdDraft, setUserIdDraft] = useState(readStoredUserId);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [exportMessage, setExportMessage] = useState('');

  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [includeDuplicates, setIncludeDuplicates] = useState([]);
  const [importMessage, setImportMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [fileKey, setFileKey] = useState(0);

  const ready = Boolean(userId) || isSignedIn();

  function saveUserId(event) {
    event.preventDefault();
    const value = userIdDraft.trim();
    try {
      localStorage.setItem(DEV_USER_KEY, value);
    } catch {
      // Storage can be unavailable; the value still works for this visit.
    }
    setUserId(value);
  }

  async function exportCsv(event) {
    event.preventDefault();
    setExportMessage('');
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    try {
      const name = await download(`data/transactions.csv?${params}`, userId, 'pfem-transactions.csv');
      setExportMessage(`Downloaded ${name}.`);
    } catch (error) {
      setExportMessage(error.message);
    }
  }

  async function exportJson() {
    setExportMessage('');
    try {
      const name = await download('data/export.json', userId, 'pfem-my-data.json');
      setExportMessage(`Downloaded ${name}.`);
    } catch (error) {
      setExportMessage(error.message);
    }
  }

  async function downloadTemplate() {
    try {
      await download('data/import/template', userId, 'pfem-import-template.csv');
    } catch (error) {
      setImportMessage(error.message);
    }
  }

  function resetImport() {
    setCsv('');
    setFileName('');
    setPreview(null);
    setMapping({});
    setIncludeDuplicates([]);
    setFileKey((n) => n + 1);
  }

  async function runPreview(text, map) {
    setBusy(true);
    try {
      const body = { csv: text };
      if (map) body.mapping = map;
      const result = await json('data/import/preview', userId, { method: 'POST', body: JSON.stringify(body) });
      setPreview(result.data);
      setMapping(result.data.mapping || {});
      setIncludeDuplicates([]);
    } catch (error) {
      setPreview(null);
      setImportMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function chooseFile(event) {
    const file = event.target.files?.[0];
    setImportMessage('');
    setPreview(null);
    if (!file) return;

    if (!/\.csv$/i.test(file.name)) {
      setImportMessage('Choose a .csv file.');
      setFileKey((n) => n + 1);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setImportMessage('That file is larger than 900 KB. Split it into smaller files and import each one.');
      setFileKey((n) => n + 1);
      return;
    }

    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    await runPreview(text, null);
  }

  function changeMapping(field, value) {
    setMapping((current) => {
      const next = { ...current };
      if (value === '') delete next[field];
      else next[field] = Number(value);
      return next;
    });
  }

  function toggleDuplicate(row) {
    setIncludeDuplicates((current) =>
      current.includes(row) ? current.filter((r) => r !== row) : [...current, row],
    );
  }

  async function commit() {
    setBusy(true);
    setImportMessage('');
    try {
      const result = await json('data/import/commit', userId, {
        method: 'POST',
        body: JSON.stringify({ csv, mapping, import_duplicates: includeDuplicates }),
      });
      const { imported, skipped_duplicates: skipped, invalid_rows: invalid } = result.data;
      const parts = [`Imported ${imported} transaction${imported === 1 ? '' : 's'} from ${fileName}.`];
      if (skipped.length) parts.push(`Skipped ${skipped.length} probable duplicate${skipped.length === 1 ? '' : 's'}.`);
      if (invalid.length) parts.push(`${invalid.length} invalid row${invalid.length === 1 ? ' was' : 's were'} not imported.`);
      parts.push('Balances, budgets and reports already include them.');
      resetImport();
      setImportMessage(parts.join(' '));
    } catch (error) {
      setImportMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  const toImport = preview
    ? preview.valid_count - preview.duplicate_count + includeDuplicates.length
    : 0;

  return (
    <div style={{ minHeight: '100vh', background: colors.page, color: colors.text, padding: '32px 18px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <header style={{ marginBottom: 22 }}>
          <h1 style={{ margin: 0, fontSize: 28 }}>Import and export</h1>
          <p style={{ margin: '6px 0 0', color: colors.muted }}>
            Move your transactions in and out as CSV, or take all of your data with you. US-24 &middot; SRS 5.9
          </p>
          <nav style={{ marginTop: 12, display: 'flex', gap: 14, fontSize: 14, flexWrap: 'wrap' }}>
            <a href="#/dashboard" style={{ color: colors.greenSoft }}>Dashboard</a>
            <a href="#/accounts" style={{ color: colors.greenSoft }}>Accounts</a>
            <a href="#/transactions" style={{ color: colors.greenSoft }}>Transactions</a>
            <a href="#/budgets" style={{ color: colors.greenSoft }}>Budgets</a>
          </nav>
        </header>

        {!isSignedIn() && (
          <form onSubmit={saveUserId} style={cardStyle}>
            <label style={labelStyle}>
              Demo user id
              <input
                style={inputStyle}
                value={userIdDraft}
                onChange={(e) => setUserIdDraft(e.target.value)}
                placeholder="Run npm run seed:dev in server/ and paste the id"
              />
            </label>
            <button type="submit" style={{ ...secondaryButton, marginTop: 12 }}>Use this user</button>
          </form>
        )}

        {ready && (
          <>
            {/* REQ-82 and REQ-87 */}
            <section style={cardStyle} aria-labelledby="export-heading">
              <h2 id="export-heading" style={{ marginTop: 0, fontSize: 20 }}>Export</h2>

              <form onSubmit={exportCsv}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
                  <label style={labelStyle}>
                    From
                    <input style={inputStyle} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </label>
                  <label style={labelStyle}>
                    To
                    <input style={inputStyle} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                  </label>
                </div>
                <p style={{ color: colors.muted, fontSize: 13, margin: '8px 0 12px' }}>
                  Leave the dates empty to export everything.
                </p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button type="submit" style={primaryButton}>Download transactions (CSV)</button>
                  <button type="button" style={secondaryButton} onClick={exportJson}>
                    Download all my data (JSON)
                  </button>
                </div>
              </form>

              {exportMessage && (
                <p role="status" style={{ color: colors.greenSoft, marginBottom: 0 }}>{exportMessage}</p>
              )}

              <details style={{ marginTop: 14, color: colors.muted, fontSize: 13 }}>
                <summary style={{ cursor: 'pointer' }}>CSV column order</summary>
                <ol style={{ paddingLeft: 20 }}>
                  {COLUMNS.map(([name, about]) => (
                    <li key={name}>
                      <code style={{ color: '#e2e8f0' }}>{name}</code> &ndash; {about}
                    </li>
                  ))}
                </ol>
                <p>
                  The JSON file holds your profile, accounts, categories, tags, transactions, transfers,
                  budgets, goals, recurring rules, reminders and the names of your receipt files.
                </p>
              </details>
            </section>

            {/* REQ-83 to REQ-86 */}
            <section style={cardStyle} aria-labelledby="import-heading">
              <h2 id="import-heading" style={{ marginTop: 0, fontSize: 20 }}>Import transactions</h2>
              <p style={{ color: colors.muted, fontSize: 14, marginTop: 0 }}>
                Nothing is saved until you confirm. Accounts and categories must already exist; they are matched
                by name. Dates can be YYYY-MM-DD or DD/MM/YYYY.{' '}
                <button
                  type="button"
                  onClick={downloadTemplate}
                  style={{ background: 'none', border: 'none', color: colors.greenSoft, padding: 0, cursor: 'pointer', textDecoration: 'underline', fontSize: 14 }}
                >
                  Download a sample file
                </button>
              </p>

              <label style={labelStyle}>
                CSV file (900 KB or less)
                <input
                  key={fileKey}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={chooseFile}
                  style={{ ...inputStyle, padding: 8 }}
                  disabled={busy}
                />
              </label>

              {busy && <p style={{ color: colors.muted }}>Working…</p>}

              {importMessage && (
                <p role="status" style={{ color: colors.amber, overflowWrap: 'anywhere' }}>{importMessage}</p>
              )}

              {preview && (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ fontSize: 16, marginBottom: 6 }}>Match your columns</h3>
                  <p style={{ color: colors.muted, fontSize: 13, marginTop: 0 }}>
                    {preview.needs_mapping
                      ? 'Some required fields could not be matched automatically. Choose the column for each one.'
                      : 'Columns were matched from the headings. Change any that are wrong.'}
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
                    {preview.fields.map((field) => (
                      <label key={field.key} style={{ ...labelStyle, fontWeight: 500 }}>
                        {field.label}{field.required ? ' *' : ''}
                        <select
                          style={inputStyle}
                          value={mapping[field.key] ?? ''}
                          onChange={(e) => changeMapping(field.key, e.target.value)}
                        >
                          <option value="">{field.required ? 'Choose a column' : 'Not in my file'}</option>
                          {preview.headers.map((header, index) => (
                            <option key={`${header}-${index}`} value={index}>
                              {header || `Column ${index + 1}`}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    style={{ ...secondaryButton, marginTop: 12 }}
                    onClick={() => runPreview(csv, mapping)}
                    disabled={busy}
                  >
                    Check again with these columns
                  </button>

                  {!preview.needs_mapping && (
                    <>
                      <p style={{ marginTop: 18 }} role="status">
                        <strong>{preview.total_rows}</strong> rows read:{' '}
                        <span style={{ color: colors.greenSoft }}>{preview.valid_count} valid</span>,{' '}
                        <span style={{ color: colors.red }}>{preview.invalid_count} invalid</span>,{' '}
                        <span style={{ color: colors.amber }}>{preview.duplicate_count} probable duplicates</span>.
                      </p>

                      {preview.invalid_rows.length > 0 && (
                        <>
                          <h3 style={{ fontSize: 16, color: colors.red }}>Rows that will not be imported</h3>
                          <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                              <thead>
                                <tr style={{ textAlign: 'left', color: colors.muted }}>
                                  <th style={cell}>Row</th>
                                  <th style={cell}>Reason</th>
                                </tr>
                              </thead>
                              <tbody>
                                {preview.invalid_rows.map((item) => (
                                  <tr key={item.row}>
                                    <td style={cell}>{item.row}</td>
                                    <td style={{ ...cell, overflowWrap: 'anywhere' }}>{item.reasons.join(' ')}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}

                      {preview.rows.length > 0 && (
                        <>
                          <h3 style={{ fontSize: 16 }}>Preview</h3>
                          <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 14 }}>
                              <thead>
                                <tr style={{ textAlign: 'left', color: colors.muted }}>
                                  {['Row', 'Date', 'Type', 'Amount', 'Account', 'Category', 'Note', ''].map((h) => (
                                    <th key={h} style={cell}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {preview.rows.slice(0, PREVIEW_ROWS).map((row) => (
                                  <tr key={row.row} style={row.duplicate ? { background: '#2a2113' } : undefined}>
                                    <td style={cell}>{row.row}</td>
                                    <td style={cell}>{row.date}</td>
                                    <td style={cell}>{row.type}</td>
                                    <td style={cell}>{row.amount}</td>
                                    <td style={cell}>
                                      {row.account}{row.to_account ? ` → ${row.to_account}` : ''}
                                    </td>
                                    <td style={cell}>{row.category || '—'}</td>
                                    <td style={{ ...cell, overflowWrap: 'anywhere' }}>{row.note || '—'}</td>
                                    <td style={cell}>
                                      {row.duplicate && (
                                        <label style={{ color: colors.amber, fontSize: 13, whiteSpace: 'nowrap' }}>
                                          <input
                                            type="checkbox"
                                            checked={includeDuplicates.includes(row.row)}
                                            onChange={() => toggleDuplicate(row.row)}
                                          />{' '}
                                          Probable duplicate &ndash; import anyway
                                        </label>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {preview.rows.length > PREVIEW_ROWS && (
                            <p style={{ color: colors.muted, fontSize: 13 }}>
                              Showing the first {PREVIEW_ROWS} of {preview.rows.length} valid rows.
                              {preview.rows.slice(PREVIEW_ROWS).some((r) => r.duplicate) &&
                                ' Further probable duplicates will be skipped.'}
                            </p>
                          )}
                        </>
                      )}

                      <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          style={{ ...primaryButton, opacity: toImport ? 1 : 0.5 }}
                          onClick={commit}
                          disabled={busy || !toImport}
                        >
                          Import {toImport} transaction{toImport === 1 ? '' : 's'}
                        </button>
                        <button type="button" style={secondaryButton} onClick={resetImport} disabled={busy}>
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

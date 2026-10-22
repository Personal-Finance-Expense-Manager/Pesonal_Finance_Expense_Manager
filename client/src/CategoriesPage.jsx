import { useCallback, useEffect, useState } from 'react';

/**
 * Categories and subcategories page - US-12 (#30), SRS 5.4, REQ-35 to REQ-40.
 *
 * Open it at http://localhost:5173/#/categories
 *
 * Until sign-in (US-04) is wired into the feature pages there is no logged-in
 * user here, so the page asks for a demo user id (from `npm run seed:dev` in
 * server/) and sends it in an X-User-Id header, exactly as the accounts and
 * budgets pages do. When that is replaced, drop the demo box and authHeaders.
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const DEV_USER_KEY = 'pfem_dev_user_id';

const emptyForm = {
  name: '',
  type: 'expense',
  parent_category_id: '',
  colour: '',
};

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

const labelStyle = {
  display: 'block',
  marginBottom: 14,
  fontSize: 14,
  fontWeight: 600,
  color: '#e2e8f0',
};

const cardStyle = {
  padding: 22,
  marginBottom: 18,
  background: colors.card,
  border: `1px solid ${colors.cardBorder}`,
  borderRadius: 16,
};

function button(kind = 'primary', disabled = false) {
  const base = {
    padding: '9px 14px',
    borderRadius: 9,
    fontSize: 14,
    fontWeight: 600,
    cursor: disabled ? 'wait' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };
  if (kind === 'primary') {
    return { ...base, border: 'none', background: colors.green, color: '#fff' };
  }
  if (kind === 'danger') {
    return { ...base, border: '1px solid #7f1d1d', background: '#451a1a', color: '#fecaca' };
  }
  return {
    ...base,
    border: `1px solid ${colors.inputBorder}`,
    background: 'transparent',
    color: '#e2e8f0',
  };
}

function FieldError({ text }) {
  if (!text) return null;
  return (
    <span style={{ display: 'block', marginTop: 5, color: colors.red, fontWeight: 400, fontSize: 13 }}>
      {text}
    </span>
  );
}

function Swatch({ colour }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: 12,
        height: 12,
        borderRadius: 4,
        marginRight: 9,
        background: colour || colors.inputBorder,
        verticalAlign: 'middle',
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// One row: a top-level category and its subcategories (REQ-38)
// ---------------------------------------------------------------------------

function CategoryRow({ category, depth, editingId, editForm, editErrors, busy,
  onEditStart, onEditChange, onEditCancel, onEditSave, onDelete, pendingDelete }) {
  const isEditing = editingId === category.id;

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '11px 0',
          paddingLeft: depth * 22,
          borderTop: `1px solid ${colors.cardBorder}`,
        }}
      >
        {isEditing ? (
          <div style={{ flex: 1 }}>
            <input
              style={{ ...inputStyle, marginTop: 0 }}
              value={editForm.name ?? ''}
              onChange={(e) => onEditChange('name', e.target.value)}
              maxLength={30}
              aria-label="Category name"
            />
            <FieldError text={editErrors.name} />
            <div style={{ marginTop: 9, display: 'flex', gap: 8 }}>
              <button style={button('primary', busy)} disabled={busy} onClick={() => onEditSave(category)}>
                Save
              </button>
              <button style={button('ghost', busy)} disabled={busy} onClick={onEditCancel}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <span style={{ flex: 1 }}>
              <Swatch colour={category.colour} />
              <span style={{ fontWeight: depth === 0 ? 600 : 400 }}>{category.name}</span>
              {category.is_system && (
                <span style={{ marginLeft: 9, fontSize: 12, color: colors.muted }}>built-in</span>
              )}
              {category.child_count > 0 && (
                <span style={{ marginLeft: 9, fontSize: 12, color: colors.muted }}>
                  {category.child_count} subcategor{category.child_count === 1 ? 'y' : 'ies'}
                </span>
              )}
            </span>

            {/* REQ-39: built-in categories cannot be renamed or deleted */}
            {!category.is_system && (
              <>
                <button style={button('ghost', busy)} disabled={busy} onClick={() => onEditStart(category)}>
                  Rename
                </button>
                <button style={button('danger', busy)} disabled={busy} onClick={() => onDelete(category)}>
                  Delete
                </button>
              </>
            )}
          </>
        )}
      </div>

      {/* REQ-40: say exactly what a delete will do before it happens */}
      {pendingDelete && pendingDelete.id === category.id && (
        <div
          style={{
            margin: '0 0 10px',
            marginLeft: depth * 22,
            padding: 14,
            background: '#1f1416',
            border: '1px solid #7f1d1d',
            borderRadius: 11,
          }}
        >
          <p style={{ margin: '0 0 10px', color: '#fecaca' }}>{pendingDelete.message}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={button('danger', busy)} disabled={busy} onClick={() => onDelete(category, true)}>
              Yes, delete it
            </button>
            <button style={button('ghost', busy)} disabled={busy} onClick={onEditCancel}>
              Keep it
            </button>
          </div>
        </div>
      )}

      {category.children?.map((child) => (
        <CategoryRow
          key={child.id}
          category={child}
          depth={depth + 1}
          editingId={editingId}
          editForm={editForm}
          editErrors={editErrors}
          busy={busy}
          onEditStart={onEditStart}
          onEditChange={onEditChange}
          onEditCancel={onEditCancel}
          onEditSave={onEditSave}
          onDelete={onDelete}
          pendingDelete={pendingDelete}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CategoriesPage() {
  const [userId, setUserId] = useState(() => {
    try {
      return localStorage.getItem(DEV_USER_KEY) || '';
    } catch {
      return '';
    }
  });
  const [userIdDraft, setUserIdDraft] = useState(userId);

  const [categories, setCategories] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState({});

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editErrors, setEditErrors] = useState({});
  const [pendingDelete, setPendingDelete] = useState(null);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const api = useCallback(async (path, options = {}) => {
    const response = await fetch(`${API_URL}/api/categories${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': userId,
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.message || 'Something went wrong. Please try again.');
      err.status = response.status;
      err.errors = data.errors || {};
      err.payload = data;
      throw err;
    }
    return data;
  }, [userId]);

  const loadCategories = useCallback(async () => {
    if (!userId) return;
    try {
      const data = await api('');
      setCategories(data.categories);
      setError('');
    } catch (err) {
      setCategories([]);
      setError(err.message);
    }
  }, [api, userId]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  function flash(text) {
    setMessage(text);
    setError('');
  }

  function saveUserId(event) {
    event.preventDefault();
    const value = userIdDraft.trim();
    try {
      localStorage.setItem(DEV_USER_KEY, value);
    } catch {
      // Storage can be unavailable (private window); the value still works for this visit.
    }
    setUserId(value);
  }

  // ---- defaults (REQ-35) --------------------------------------------------

  async function handleSeedDefaults() {
    setBusy(true);
    try {
      const data = await api('/defaults', { method: 'POST' });
      flash(data.message);
      await loadCategories();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // ---- create (REQ-36, REQ-37, REQ-38) ------------------------------------

  async function handleCreate(event) {
    event.preventDefault();
    setBusy(true);
    setFormErrors({});
    try {
      const payload = {
        name: form.name,
        type: form.type,
      };
      if (form.parent_category_id) payload.parent_category_id = form.parent_category_id;
      if (form.colour) payload.colour = form.colour;

      const data = await api('', { method: 'POST', body: JSON.stringify(payload) });
      setForm({ ...emptyForm, type: form.type });
      flash(`"${data.category.name}" added.`);
      await loadCategories();
    } catch (err) {
      setFormErrors(err.errors);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // ---- edit (REQ-39) ------------------------------------------------------

  function startEdit(category) {
    setPendingDelete(null);
    setEditErrors({});
    setEditingId(category.id);
    setEditForm({ name: category.name });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({});
    setEditErrors({});
    setPendingDelete(null);
  }

  async function saveEdit(category) {
    setBusy(true);
    setEditErrors({});
    try {
      await api(`/${category.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editForm.name }),
      });
      cancelEdit();
      flash('Category renamed.');
      await loadCategories();
    } catch (err) {
      setEditErrors(err.errors);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // ---- delete (REQ-39, REQ-40) -------------------------------------------

  async function handleDelete(category, confirmed = false) {
    setBusy(true);
    try {
      const query = confirmed ? '?confirm=true' : '';
      const data = await api(`/${category.id}${query}`, { method: 'DELETE' });
      setPendingDelete(null);
      flash(data.message);
      await loadCategories();
    } catch (err) {
      // 409 with confirmation_required is the "are you sure" step, not a failure.
      if (err.status === 409 && err.payload?.confirmation_required) {
        setEditingId(null);
        setPendingDelete({ id: category.id, message: err.message });
        setError('');
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const expense = (categories || []).filter((c) => c.type === 'expense');
  const income = (categories || []).filter((c) => c.type === 'income');
  const parentOptions = (categories || []).filter(
    (c) => c.type === form.type && !c.parent_category_id
  );

  const rowProps = {
    editingId, editForm, editErrors, busy, pendingDelete,
    onEditStart: startEdit,
    onEditChange: (field, value) => setEditForm((f) => ({ ...f, [field]: value })),
    onEditCancel: cancelEdit,
    onEditSave: saveEdit,
    onDelete: handleDelete,
  };

  return (
    <div style={{ minHeight: '100vh', background: colors.page, color: colors.text, padding: '32px 18px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <header style={{ marginBottom: 22 }}>
          <h1 style={{ margin: 0, fontSize: 28 }}>Categories</h1>
          <p style={{ margin: '6px 0 0', color: colors.muted }}>
            Organise your spending and income. US-12 &middot; SRS 5.4
          </p>
          <nav style={{ marginTop: 12, display: 'flex', gap: 14, fontSize: 14 }}>
            <a href="#/accounts" style={{ color: colors.greenSoft }}>Accounts</a>
            <a href="#/transactions" style={{ color: colors.greenSoft }}>Transactions</a>
            <a href="#/budgets" style={{ color: colors.greenSoft }}>Budgets</a>
          </nav>
        </header>

        {/* Demo user box - removed once sign-in is wired into feature pages */}
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
          <button type="submit" style={button('ghost', busy)} disabled={busy}>Use this user</button>
        </form>

        {message && (
          <p style={{ ...cardStyle, borderColor: colors.green, color: colors.greenSoft, padding: 14 }}>{message}</p>
        )}
        {error && (
          <p style={{ ...cardStyle, borderColor: '#7f1d1d', color: colors.red, padding: 14 }}>{error}</p>
        )}

        {!userId && (
          <p style={{ color: colors.muted }}>Enter a demo user id above to load categories.</p>
        )}

        {userId && (
          <>
            {/* Create (REQ-36, REQ-37, REQ-38) */}
            <form onSubmit={handleCreate} style={cardStyle}>
              <h2 style={{ margin: '0 0 16px', fontSize: 18 }}>Add a category</h2>

              <label style={labelStyle}>
                Name
                <input
                  style={inputStyle}
                  value={form.name}
                  maxLength={30}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Weekend dining"
                />
                <FieldError text={formErrors.name} />
              </label>

              <label style={labelStyle}>
                Type
                <select
                  style={inputStyle}
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value, parent_category_id: '' }))}
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
                <FieldError text={formErrors.type} />
              </label>

              <label style={labelStyle}>
                Parent category (optional)
                <select
                  style={inputStyle}
                  value={form.parent_category_id}
                  onChange={(e) => setForm((f) => ({ ...f, parent_category_id: e.target.value }))}
                >
                  <option value="">None - top level</option>
                  {parentOptions.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <span style={{ display: 'block', marginTop: 5, fontSize: 13, color: colors.muted, fontWeight: 400 }}>
                  Subcategories can only be one level deep.
                </span>
                <FieldError text={formErrors.parent_category_id} />
              </label>

              <label style={labelStyle}>
                Colour (optional)
                <input
                  style={inputStyle}
                  value={form.colour}
                  onChange={(e) => setForm((f) => ({ ...f, colour: e.target.value }))}
                  placeholder="#4F46E5"
                />
                <FieldError text={formErrors.colour} />
              </label>

              <button type="submit" style={button('primary', busy)} disabled={busy}>
                Add category
              </button>
            </form>

            {/* Lists */}
            {categories === null ? (
              <p style={{ color: colors.muted }}>Loading categories...</p>
            ) : categories.length === 0 ? (
              <div style={cardStyle}>
                <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>No categories yet</h2>
                <p style={{ margin: '0 0 14px', color: colors.muted }}>
                  Start with the standard set - Food, Groceries, Transport, Rent, Utilities,
                  Health, Education, Entertainment, Shopping, Salary, Interest and Other.
                </p>
                <button style={button('primary', busy)} disabled={busy} onClick={handleSeedDefaults}>
                  Add the default categories
                </button>
              </div>
            ) : (
              <>
                <section style={cardStyle}>
                  <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Expense categories</h2>
                  <p style={{ margin: '0 0 6px', color: colors.muted, fontSize: 14 }}>
                    {expense.length} top-level
                  </p>
                  {expense.map((c) => <CategoryRow key={c.id} category={c} depth={0} {...rowProps} />)}
                </section>

                <section style={cardStyle}>
                  <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Income categories</h2>
                  <p style={{ margin: '0 0 6px', color: colors.muted, fontSize: 14 }}>
                    {income.length} top-level
                  </p>
                  {income.map((c) => <CategoryRow key={c.id} category={c} depth={0} {...rowProps} />)}
                </section>

                <button style={button('ghost', busy)} disabled={busy} onClick={handleSeedDefaults}>
                  Restore any missing default categories
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

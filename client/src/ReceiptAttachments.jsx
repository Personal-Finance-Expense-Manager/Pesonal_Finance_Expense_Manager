import { useEffect, useState } from 'react';
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_RULES,
  MAX_ATTACHMENTS,
  attachmentRequest as call,
  checkAttachment,
  uploadAttachment,
} from './receipts.js';

/**
 * Receipt attachments for one transaction - US-23 (#57), SRS REQ-79 to REQ-81.
 *
 * Shows a thumbnail of each attachment (an image preview, or a PDF tile), lets
 * the owner view, download and delete each one, and add more up to three.
 * Files are checked here before upload where possible (REQ-80); the server
 * checks again, including the file's actual content.
 */

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const tile = {
  width: 140,
  border: '1px solid #334155',
  borderRadius: 8,
  padding: 8,
  background: '#111827',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const thumb = {
  width: '100%',
  height: 96,
  objectFit: 'contain',
  borderRadius: 6,
  background: '#1e293b',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#fca5a5',
  fontWeight: 700,
};

const smallButton = {
  padding: '4px 8px',
  borderRadius: 6,
  border: '1px solid #475569',
  background: 'transparent',
  color: '#e2e8f0',
  cursor: 'pointer',
  fontSize: 12,
};

export default function ReceiptAttachments({ transactionId, userId, onChange }) {
  const [items, setItems] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;

    call(`transactions/${transactionId}/attachments`, userId)
      .then((result) => {
        if (!cancelled) setItems(result.data || []);
      })
      .catch((error) => {
        if (!cancelled) setMessage(error.message);
      });

    return () => {
      cancelled = true;
    };
  }, [transactionId, userId, reload]);

  async function add(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    setMessage('');

    if (items.length + files.length > MAX_ATTACHMENTS) {
      setMessage(`A transaction can have at most ${MAX_ATTACHMENTS} attachments.`);
      return;
    }

    const problem = files.map(checkAttachment).find(Boolean);
    if (problem) {
      setMessage(problem);
      return;
    }

    setBusy(true);
    try {
      for (const file of files) {
        await uploadAttachment(transactionId, file, userId);
      }
      setMessage(files.length === 1 ? 'Attachment added.' : `${files.length} attachments added.`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
      setReload((n) => n + 1);
      onChange?.();
    }
  }

  // Signed URLs expire after a few minutes, so ask for a fresh one on click.
  async function freshUrls(id) {
    const result = await call(`attachments/${id}`, userId);
    return result.data;
  }

  async function view(id) {
    const win = window.open('', '_blank');
    try {
      const { view_url: url } = await freshUrls(id);
      if (win) {
        win.opener = null;
        win.location.href = url;
      } else {
        window.location.assign(url);
      }
    } catch (error) {
      win?.close();
      setMessage(error.message);
    }
  }

  async function download(id) {
    try {
      const { download_url: url } = await freshUrls(id);
      // The server sends Content-Disposition: attachment, so this downloads
      // the file without leaving the page.
      window.location.assign(url);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function remove(item) {
    if (!window.confirm(`Delete "${item.file_name}"? This cannot be undone.`)) return;
    setMessage('');
    try {
      await call(`attachments/${item.id}`, userId, { method: 'DELETE' });
      setMessage('Attachment deleted.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setReload((n) => n + 1);
      onChange?.();
    }
  }

  return (
    <div style={{ padding: '12px 4px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {items.map((item) => (
          <div key={item.id} style={tile}>
            {item.is_image ? (
              <img src={item.view_url} alt={`Receipt ${item.file_name}`} style={thumb} />
            ) : (
              <div style={thumb} aria-label={`PDF receipt ${item.file_name}`}>PDF</div>
            )}
            <span style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{item.file_name}</span>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>{formatSize(item.size_bytes)}</span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <button type="button" style={smallButton} onClick={() => view(item.id)}>View</button>
              <button type="button" style={smallButton} onClick={() => download(item.id)}>Download</button>
              <button
                type="button"
                style={{ ...smallButton, borderColor: '#7f1d1d', color: '#fca5a5' }}
                onClick={() => remove(item)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}

        {!items.length && (
          <span style={{ color: '#94a3b8', fontSize: 14 }}>No receipts attached yet.</span>
        )}
      </div>

      <label style={{ display: 'block', marginTop: 12, color: '#cbd5e1', fontSize: 14 }}>
        Add receipt ({ATTACHMENT_RULES})
        <input
          type="file"
          accept={ATTACHMENT_ACCEPT}
          multiple
          onChange={add}
          disabled={busy || items.length >= MAX_ATTACHMENTS}
          style={{ display: 'block', marginTop: 6, color: '#cbd5e1' }}
        />
      </label>

      {busy && <p style={{ color: '#cbd5e1', fontSize: 14 }}>Uploading…</p>}
      {message && (
        <p role="status" style={{ color: '#fde68a', fontSize: 14, overflowWrap: 'anywhere' }}>
          {message}
        </p>
      )}
    </div>
  );
}

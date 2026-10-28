import { authHeaders } from './auth.js';

/**
 * Receipt attachment rules and requests - US-23 (#57), SRS REQ-79 and REQ-80.
 * Shared by the transaction form and the ReceiptAttachments panel.
 */

const API = 'http://localhost:5000/api';

export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf';
export const ATTACHMENT_RULES = 'JPG, PNG or PDF, 5 MB or less, up to 3 per transaction.';

const TYPES = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'application/pdf': ['pdf'],
};

/** The browser-side check (REQ-80). Returns an error message, or '' if fine. */
export function checkAttachment(file) {
  const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
  const type = file.type || Object.keys(TYPES).find((t) => TYPES[t].includes(ext)) || '';

  if (!TYPES[type] || !TYPES[type].includes(ext)) {
    return `"${file.name}" is not a supported file type. Attach a JPG, PNG or PDF file of 5 MB or less.`;
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `"${file.name}" is larger than 5 MB. Attach a JPG, PNG or PDF file of 5 MB or less.`;
  }

  if (file.size === 0) return `"${file.name}" is empty.`;

  return '';
}

export async function attachmentRequest(path, userId, options = {}) {
  const response = await fetch(`${API}/${path}`, {
    ...options,
    headers: { ...authHeaders(userId), ...options.headers },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || 'Request failed.');
  return result;
}

/** Upload one file to a transaction. The body is the file itself. */
export function uploadAttachment(transactionId, file, userId) {
  const ext = file.name.split('.').pop().toLowerCase();
  const type = file.type || Object.keys(TYPES).find((t) => TYPES[t].includes(ext));

  return attachmentRequest(`transactions/${transactionId}/attachments`, userId, {
    method: 'POST',
    headers: { 'Content-Type': type, 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  });
}

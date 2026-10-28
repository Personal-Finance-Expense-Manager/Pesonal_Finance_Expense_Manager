/**
 * Receipt attachment rules - US-23 (#57), SRS REQ-79 and REQ-80.
 *
 *   - JPG, PNG or PDF only
 *   - 5 MB or less
 *   - at most three per transaction
 *
 * The declared type is never trusted on its own. A file is accepted only when
 * its declared MIME type, its file-name extension and its first bytes (the
 * "magic number") all agree, so a renamed .exe is still rejected (UT_52).
 */

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TRANSACTION = 3;

export const ATTACHMENT_RULES_MESSAGE =
  'Attach a JPG, PNG or PDF file of 5 MB or less.';

/** The permitted types, their extensions and their leading bytes. */
export const FILE_TYPES = {
  'image/jpeg': { extensions: ['jpg', 'jpeg'], storedExtension: 'jpg', magic: [0xff, 0xd8, 0xff] },
  'image/png': {
    extensions: ['png'],
    storedExtension: 'png',
    magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  'application/pdf': { extensions: ['pdf'], storedExtension: 'pdf', magic: [0x25, 0x50, 0x44, 0x46, 0x2d] },
};

export const ALLOWED_MIME_TYPES = Object.keys(FILE_TYPES);

/** The MIME type the file's first bytes identify, or null if none of ours. */
export function detectFileType(buffer) {
  if (!buffer || typeof buffer.length !== 'number') return null;

  for (const [mime, { magic }] of Object.entries(FILE_TYPES)) {
    if (buffer.length >= magic.length && magic.every((byte, i) => buffer[i] === byte)) {
      return mime;
    }
  }

  return null;
}

/**
 * Clean a client-supplied file name for storage and for Content-Disposition.
 * Drops any directory part and control characters, and caps the length.
 */
export function sanitizeFileName(raw) {
  let name = typeof raw === 'string' ? raw : '';

  try {
    name = decodeURIComponent(name);
  } catch {
    // Not percent-encoded; use as sent.
  }

  name = name
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f"]/g, '')
    .trim();

  if (!name || name === '.' || name === '..') return '';

  if (name.length > 255) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot) : '';
    name = name.slice(0, 255 - ext.length) + ext;
  }

  return name;
}

function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * Check an uploaded file. Returns { data } or { status, message }.
 *
 *   413 - larger than 5 MB          (REQ-80, UT_53)
 *   415 - not a JPG, PNG or PDF     (REQ-80, UT_52)
 *   400 - empty or unnamed
 */
export function validateAttachment({ buffer, fileName, mimeType }) {
  const size = buffer?.length ?? 0;

  if (!size) {
    return { status: 400, message: 'Choose a file to attach.' };
  }

  if (size > MAX_ATTACHMENT_BYTES) {
    return { status: 413, message: `That file is larger than 5 MB. ${ATTACHMENT_RULES_MESSAGE}` };
  }

  const name = sanitizeFileName(fileName);

  if (!name) {
    return { status: 400, message: 'The file needs a name.' };
  }

  const declared = String(mimeType || '').split(';')[0].trim().toLowerCase();
  const detected = detectFileType(buffer);
  const rules = FILE_TYPES[declared];

  if (!rules || detected !== declared || !rules.extensions.includes(extensionOf(name))) {
    return { status: 415, message: `That file type is not supported. ${ATTACHMENT_RULES_MESSAGE}` };
  }

  return {
    data: {
      fileName: name,
      mimeType: declared,
      sizeBytes: size,
      storedExtension: rules.storedExtension,
    },
  };
}

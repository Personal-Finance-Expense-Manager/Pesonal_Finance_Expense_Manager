/**
 * Minimal RFC 4180 CSV reading and writing - US-24 (#58), SRS REQ-82, REQ-83.
 *
 * Reading handles quoted fields, doubled quotes, commas and line breaks
 * inside quotes, CRLF or LF line endings and a leading UTF-8 byte-order mark
 * (Excel adds one). Writing quotes only the fields that need it and ends rows
 * with CRLF, as the RFC specifies.
 */

const BOM = '﻿';

/** Parse CSV text into an array of rows, each an array of strings. */
export function parseCsv(text) {
  const input = String(text ?? '');
  const source = input.startsWith(BOM) ? input.slice(1) : input;
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"' && field === '') {
      quoted = true;
      i += 1;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
    } else if (ch === '\r' || ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += ch === '\r' && source[i + 1] === '\n' ? 2 : 1;
    } else {
      field += ch;
      i += 1;
    }
  }

  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  // Drop blank lines (a trailing newline, or empty rows between records).
  return rows.filter((r) => r.length > 1 || r[0].trim() !== '');
}

// A cell starting with one of these is run as a formula by spreadsheet
// programs ("CSV injection", OWASP). Such text is prefixed with an apostrophe
// on export, and the apostrophe is removed again on import.
const FORMULA_START = /^[=+\-@\t\r]/;

/** Make a text cell safe to open in a spreadsheet. */
export function protectCell(value) {
  const text = value == null ? '' : String(value);
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** Undo protectCell for a cell read back from a file. */
export function unprotectCell(value) {
  const text = String(value ?? '');
  return text.startsWith("'") && FORMULA_START.test(text.slice(1)) ? text.slice(1) : text;
}

function quote(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Turn rows (arrays of values) into CSV text, with a BOM so Excel reads UTF-8. */
export function toCsv(rows, { bom = true } = {}) {
  const body = rows.map((row) => row.map(quote).join(',')).join('\r\n');
  return `${bom ? BOM : ''}${body}\r\n`;
}

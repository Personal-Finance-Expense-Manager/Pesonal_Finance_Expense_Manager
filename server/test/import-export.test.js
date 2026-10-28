import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, protectCell, toCsv, unprotectCell } from '../src/utils/csv.js';
import { normaliseAmount, normaliseDate, suggestMapping } from '../src/services/importService.js';
import { CSV_COLUMNS } from '../src/services/exportService.js';

// ---------------------------------------------------------------------------
// RFC 4180 reading and writing (REQ-82, REQ-83)
// ---------------------------------------------------------------------------

test('parseCsv reads quoted fields with commas, quotes and line breaks', () => {
  const rows = parseCsv('a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n');
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['x, y', 'say "hi"', 'line1\nline2'],
  ]);
});

test('parseCsv strips the byte-order mark Excel adds and skips blank lines', () => {
  const rows = parseCsv('﻿date,amount\n\n2026-10-01,10\n\n');
  assert.deepEqual(rows, [['date', 'amount'], ['2026-10-01', '10']]);
});

test('parseCsv keeps empty cells', () => {
  assert.deepEqual(parseCsv('a,,c\n,,\n'), [['a', '', 'c'], ['', '', '']]);
});

test('toCsv quotes only what needs quoting and ends rows with CRLF', () => {
  const text = toCsv([['a', 'b,c', 'say "hi"'], ['1', '', 'x']], { bom: false });
  assert.equal(text, 'a,"b,c","say ""hi"""\r\n1,,x\r\n');
});

test('toCsv output parses back to the same rows', () => {
  const rows = [['note', 'tags'], ['Dinner, with "friends"\nat 9', 'food;fun'], ['  padded  ', '']];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

test('a note that looks like a spreadsheet formula is neutralised and restored', () => {
  assert.equal(protectCell('=HYPERLINK("x")'), '\'=HYPERLINK("x")');
  assert.equal(protectCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(protectCell('Dinner'), 'Dinner');
  assert.equal(unprotectCell(protectCell('=1+1')), '=1+1');
  assert.equal(unprotectCell("'quoted on purpose"), "'quoted on purpose");
});

// ---------------------------------------------------------------------------
// REQ-82: documented column order
// ---------------------------------------------------------------------------

test('REQ-82 the export columns are in the documented order', () => {
  assert.deepEqual(CSV_COLUMNS, [
    'date', 'type', 'amount', 'currency', 'account', 'to_account',
    'category', 'payment_mode', 'note', 'tags',
  ]);
});

// ---------------------------------------------------------------------------
// REQ-83: column mapping and lenient value reading
// ---------------------------------------------------------------------------

test('REQ-83 an exported file maps itself with no help from the user', () => {
  const mapping = suggestMapping(CSV_COLUMNS);
  assert.deepEqual(mapping, {
    date: 0, type: 1, amount: 2, account: 4, to_account: 5,
    category: 6, payment_mode: 7, note: 8, tags: 9,
  });
});

test('REQ-83 common bank-statement headings are recognised', () => {
  const mapping = suggestMapping(['Txn Date', 'Narration', 'Amount (INR)', 'Account Name']);
  assert.deepEqual(mapping, { date: 0, amount: 2, account: 3, note: 1 });
});

test('REQ-83 unknown headings are left for the user to map', () => {
  assert.deepEqual(suggestMapping(['When', 'How much', 'Where']), {});
});

test('dates: ISO is kept; DD/MM/YYYY and DD-MM-YYYY become ISO', () => {
  assert.equal(normaliseDate('2026-10-05'), '2026-10-05');
  assert.equal(normaliseDate('05/10/2026'), '2026-10-05');
  assert.equal(normaliseDate('5-1-2026'), '2026-01-05');
  assert.equal(normaliseDate('Oct 5'), 'Oct 5'); // left for the validator to reject
});

test('amounts: currency symbols and thousands separators are removed', () => {
  assert.equal(normaliseAmount('₹1,234.50'), '1234.50');
  assert.equal(normaliseAmount('INR 1,00,000'), '100000');
  assert.equal(normaliseAmount(' Rs. 99 '), '99');
  assert.equal(normaliseAmount('12.345'), '12.345'); // left for the validator to reject
});

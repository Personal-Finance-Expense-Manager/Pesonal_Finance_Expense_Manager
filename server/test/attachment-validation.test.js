import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ATTACHMENT_BYTES,
  detectFileType,
  sanitizeFileName,
  validateAttachment,
} from '../src/validators/file.js';
import { signAttachment, verifyAttachment, SIGNED_URL_TTL_SECONDS } from '../src/utils/signedUrl.js';

process.env.ATTACHMENT_URL_SECRET = 'a'.repeat(40);

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const PDF = Buffer.from('%PDF-1.7\n%');
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);

// ---------------------------------------------------------------------------
// REQ-79 / UT_51: JPG, PNG and PDF are accepted
// ---------------------------------------------------------------------------

test('REQ-79 a JPG, a PNG and a PDF are each accepted', () => {
  for (const [buffer, fileName, mimeType] of [
    [JPG, 'receipt1.jpg', 'image/jpeg'],
    [JPG, 'receipt1.JPEG', 'image/jpeg'],
    [PNG, 'receipt2.png', 'image/png'],
    [PDF, 'receipt3.pdf', 'application/pdf'],
  ]) {
    const result = validateAttachment({ buffer, fileName, mimeType });
    assert.ok(result.data, `${fileName} should be accepted`);
    assert.equal(result.data.mimeType, mimeType);
  }
});

test('REQ-79 a file of exactly 5 MB is accepted', () => {
  const buffer = Buffer.alloc(MAX_ATTACHMENT_BYTES);
  PDF.copy(buffer);
  const result = validateAttachment({ buffer, fileName: 'big.pdf', mimeType: 'application/pdf' });
  assert.ok(result.data);
  assert.equal(result.data.sizeBytes, MAX_ATTACHMENT_BYTES);
});

test('REQ-79 the stored extension is normalised (.jpeg -> jpg)', () => {
  const result = validateAttachment({ buffer: JPG, fileName: 'a.jpeg', mimeType: 'image/jpeg' });
  assert.equal(result.data.storedExtension, 'jpg');
});

// ---------------------------------------------------------------------------
// REQ-80 / UT_52, UT_53: wrong type or over 5 MB is rejected, naming the rules
// ---------------------------------------------------------------------------

test('REQ-80 an .exe is rejected with 415 and the permitted types are named', () => {
  const result = validateAttachment({ buffer: EXE, fileName: 'receipt.exe', mimeType: 'application/octet-stream' });
  assert.equal(result.status, 415);
  assert.match(result.message, /JPG, PNG or PDF/);
  assert.match(result.message, /5 MB/);
});

test('REQ-80 an .exe renamed to .pdf is still rejected (content is checked)', () => {
  const result = validateAttachment({ buffer: EXE, fileName: 'receipt.pdf', mimeType: 'application/pdf' });
  assert.equal(result.status, 415);
});

test('REQ-80 a PNG declared as a PDF is rejected', () => {
  const result = validateAttachment({ buffer: PNG, fileName: 'receipt.pdf', mimeType: 'application/pdf' });
  assert.equal(result.status, 415);
});

test('REQ-80 a real PDF with the wrong extension is rejected', () => {
  const result = validateAttachment({ buffer: PDF, fileName: 'receipt.txt', mimeType: 'application/pdf' });
  assert.equal(result.status, 415);
});

test('REQ-80 a file over 5 MB is rejected with 413 and the limit is named', () => {
  const buffer = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1);
  PDF.copy(buffer);
  const result = validateAttachment({ buffer, fileName: 'receipt.pdf', mimeType: 'application/pdf' });
  assert.equal(result.status, 413);
  assert.match(result.message, /5 MB/);
});

test('REQ-80 an empty file is rejected', () => {
  const result = validateAttachment({ buffer: Buffer.alloc(0), fileName: 'a.pdf', mimeType: 'application/pdf' });
  assert.equal(result.status, 400);
});

test('REQ-80 a MIME type with parameters is still recognised', () => {
  const result = validateAttachment({ buffer: PDF, fileName: 'a.pdf', mimeType: 'application/pdf; charset=binary' });
  assert.ok(result.data);
});

test('detectFileType identifies each permitted type by its first bytes', () => {
  assert.equal(detectFileType(JPG), 'image/jpeg');
  assert.equal(detectFileType(PNG), 'image/png');
  assert.equal(detectFileType(PDF), 'application/pdf');
  assert.equal(detectFileType(EXE), null);
  assert.equal(detectFileType(Buffer.from([0xff])), null);
});

// ---------------------------------------------------------------------------
// File names
// ---------------------------------------------------------------------------

test('sanitizeFileName drops directories, control characters and quotes', () => {
  assert.equal(sanitizeFileName('..%2F..%2Fetc%2Fpasswd.pdf'), 'passwd.pdf');
  assert.equal(sanitizeFileName('C:\\Users\\me\\bill.png'), 'bill.png');
  assert.equal(sanitizeFileName('a"b\u0007.pdf'), 'ab.pdf');
  assert.equal(sanitizeFileName('%E0%A4%AC%E0%A4%BF%E0%A4%B2.pdf'), 'बिल.pdf');
  assert.equal(sanitizeFileName('..'), '');
});

test('sanitizeFileName keeps the extension when it shortens a long name', () => {
  const name = sanitizeFileName(`${'x'.repeat(300)}.pdf`);
  assert.equal(name.length, 255);
  assert.ok(name.endsWith('.pdf'));
});

// ---------------------------------------------------------------------------
// REQ-81 / ST_54: short-lived signed URLs for the owner only
// ---------------------------------------------------------------------------

const ATTACHMENT = '65f000000000000000000001';
const OWNER = '65f0000000000000000000aa';
const OTHER = '65f0000000000000000000bb';

test('REQ-81 a freshly signed URL verifies for the owner', () => {
  const now = Date.now();
  const { expires, signature } = signAttachment(ATTACHMENT, OWNER, now);
  assert.equal(verifyAttachment(ATTACHMENT, OWNER, expires, signature, now), 'ok');
});

test('REQ-81 signed URLs live for at most 15 minutes', () => {
  assert.ok(SIGNED_URL_TTL_SECONDS <= 15 * 60);
});

test('REQ-81 an expired URL is refused', () => {
  const now = Date.now();
  const { expires, signature } = signAttachment(ATTACHMENT, OWNER, now);
  const later = now + (SIGNED_URL_TTL_SECONDS + 1) * 1000;
  assert.equal(verifyAttachment(ATTACHMENT, OWNER, expires, signature, later), 'expired');
});

test('REQ-81 a URL issued for one user does not work for another', () => {
  const { expires, signature } = signAttachment(ATTACHMENT, OWNER);
  assert.equal(verifyAttachment(ATTACHMENT, OTHER, expires, signature), 'invalid');
});

test('REQ-81 a URL cannot be moved to another attachment', () => {
  const { expires, signature } = signAttachment(ATTACHMENT, OWNER);
  assert.equal(verifyAttachment('65f000000000000000000002', OWNER, expires, signature), 'invalid');
});

test('REQ-81 extending the expiry breaks the signature', () => {
  const { expires, signature } = signAttachment(ATTACHMENT, OWNER);
  assert.equal(verifyAttachment(ATTACHMENT, OWNER, expires + 3600, signature), 'invalid');
});

test('REQ-81 a missing or malformed signature is refused', () => {
  const { expires } = signAttachment(ATTACHMENT, OWNER);
  assert.equal(verifyAttachment(ATTACHMENT, OWNER, expires, ''), 'invalid');
  assert.equal(verifyAttachment(ATTACHMENT, OWNER, expires, undefined), 'invalid');
  assert.equal(verifyAttachment(ATTACHMENT, OWNER, 'soon', 'abc'), 'invalid');
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Store test uploads in a throwaway directory, never in server/uploads.
const uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pfem-uploads-'));
process.env.UPLOAD_DIR = uploadRoot;

const {
  startApi, stopApi, createUser, createAccount, apiAs, record, fetchUrl,
} = await import('./helpers/integration.js');
const { default: Attachment } = await import('../src/models/Attachment.js');
const { default: AuditLog } = await import('../src/models/AuditLog.js');
const { default: Transaction } = await import('../src/models/Transaction.js');
const { purgeExpired } = await import('../src/services/recycleBinService.js');

before(startApi);
after(async () => {
  await stopApi();
  await fs.rm(uploadRoot, { recursive: true, force: true });
});

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 2)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 3)]);
const EXE = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(512)]);

async function setup() {
  const user = await createUser('attach');
  const bank = await createAccount(user);
  const expense = await record(user, { type: 'expense', amount: '500', account_id: bank.id });
  return { user, bank, api: apiAs(user), transactionId: String(expense.id) };
}

function upload(api, transactionId, buffer, fileName, mimeType) {
  return api.raw('POST', `/api/transactions/${transactionId}/attachments`, {
    body: buffer,
    headers: { 'Content-Type': mimeType, 'X-File-Name': encodeURIComponent(fileName) },
  });
}

async function storedFiles() {
  return fs.readdir(uploadRoot).catch(() => []);
}

// ---------------------------------------------------------------------------
// REQ-79 - up to three JPG/PNG/PDF files per transaction
// ---------------------------------------------------------------------------

test('UT_51 / UT_82: a JPG, a PNG and a PDF can all be attached to one transaction', async () => {
  const { api, transactionId } = await setup();

  for (const [buffer, name, type] of [
    [JPG, 'receipt1.jpg', 'image/jpeg'],
    [PNG, 'receipt2.png', 'image/png'],
    [PDF, 'receipt3.pdf', 'application/pdf'],
  ]) {
    const res = await upload(api, transactionId, buffer, name, type);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.file_name, name);
    assert.equal(res.body.data.size_bytes, buffer.length);
  }

  const list = await api.get(`/api/transactions/${transactionId}/attachments`);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.data.map((a) => a.file_name), ['receipt1.jpg', 'receipt2.png', 'receipt3.pdf']);
  assert.deepEqual(list.body.data.map((a) => a.is_image), [true, true, false]);

  // The thumbnail count is shown against the transaction in the list.
  const page = await api.get('/api/transactions');
  const row = page.body.data.find((t) => t.id === transactionId);
  assert.equal(row.attachment_count, 3);
});

test('REQ-79: a fourth attachment is refused and nothing extra is stored', async () => {
  const { api, transactionId } = await setup();
  for (let i = 1; i <= 3; i += 1) {
    assert.equal((await upload(api, transactionId, JPG, `r${i}.jpg`, 'image/jpeg')).status, 201);
  }
  const before = (await storedFiles()).length;

  const res = await upload(api, transactionId, JPG, 'r4.jpg', 'image/jpeg');
  assert.equal(res.status, 409);
  assert.match(res.body.message, /at most 3/);
  assert.equal((await storedFiles()).length, before);
});

test('REQ-79: the file is stored under a random name, not the name the user gave it', async () => {
  const { api, transactionId } = await setup();
  const res = await upload(api, transactionId, PDF, '../../evil.pdf', 'application/pdf');
  assert.equal(res.status, 201);
  assert.equal(res.body.data.file_name, 'evil.pdf');

  const record = await Attachment.findById(res.body.data.id).lean();
  assert.match(record.object_key, /^[a-f\d]{32}\.pdf$/);
  assert.ok((await storedFiles()).includes(record.object_key));
});

// ---------------------------------------------------------------------------
// REQ-80 - unsupported or oversized files are rejected, naming the rules
// ---------------------------------------------------------------------------

test('UT_52: an .exe is rejected and the permitted types are named', async () => {
  const { api, transactionId } = await setup();
  const before = (await storedFiles()).length;
  const res = await upload(api, transactionId, EXE, 'receipt.exe', 'application/octet-stream');
  assert.equal(res.status, 415);
  assert.match(res.body.message, /JPG, PNG or PDF/);
  assert.equal((await storedFiles()).length, before);
});

test('UT_53: a 6 MB PDF is rejected and the size limit is named', async () => {
  const { api, transactionId } = await setup();
  const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(6 * 1024 * 1024)]);
  const res = await upload(api, transactionId, big, 'receipt.pdf', 'application/pdf');
  assert.equal(res.status, 413);
  assert.match(res.body.message, /5 MB/);
});

// ---------------------------------------------------------------------------
// REQ-81 - view, download and delete through short-lived signed URLs
// ---------------------------------------------------------------------------

test('ST_54: the owner can view and download through the signed URL', async () => {
  const { api, transactionId } = await setup();
  const { body } = await upload(api, transactionId, PNG, 'bill.png', 'image/png');

  const view = await fetchUrl(body.data.view_url);
  assert.equal(view.status, 200);
  assert.equal(view.headers.get('content-type'), 'image/png');
  assert.match(view.headers.get('content-disposition'), /^inline;/);
  assert.equal(view.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(view.buffer.equals(PNG));

  const download = await fetchUrl(body.data.download_url);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /^attachment; filename="bill.png"/);
  assert.ok(download.buffer.equals(PNG));

  const expiresAt = new Date(body.data.url_expires_at).getTime();
  assert.ok(expiresAt - Date.now() <= 15 * 60 * 1000);
});

test('ST_54: an altered or unsigned URL does not expose the file', async () => {
  const { api, transactionId } = await setup();
  const { body } = await upload(api, transactionId, PDF, 'r.pdf', 'application/pdf');

  const url = new URL(body.data.view_url);
  const unsigned = `${url.origin}${url.pathname}`;
  assert.equal((await fetchUrl(unsigned)).status, 403);

  url.searchParams.set('expires', String(Number(url.searchParams.get('expires')) + 3600));
  const extended = await fetchUrl(url.toString());
  assert.equal(extended.status, 403);
  assert.equal(extended.buffer.includes(Buffer.from('%PDF')), false);
});

test('ST_54: an expired URL does not expose the file', async () => {
  const { api, transactionId } = await setup();
  const { body } = await upload(api, transactionId, PDF, 'r.pdf', 'application/pdf');

  const { signAttachment } = await import('../src/utils/signedUrl.js');
  const record = await Attachment.findById(body.data.id).lean();
  const old = signAttachment(record._id, record.user_id, Date.now() - 60 * 60 * 1000);
  const url = new URL(body.data.view_url);
  url.searchParams.set('expires', String(old.expires));
  url.searchParams.set('signature', old.signature);

  assert.equal((await fetchUrl(url.toString())).status, 403);
});

test('ST_41 / SAF-8: another user cannot list, upload to, fetch or delete my attachments', async () => {
  const { api, transactionId } = await setup();
  const { body } = await upload(api, transactionId, JPG, 'mine.jpg', 'image/jpeg');
  const intruder = apiAs(await createUser('intruder'));

  assert.equal((await intruder.get(`/api/transactions/${transactionId}/attachments`)).status, 404);
  assert.equal((await upload(intruder, transactionId, JPG, 'x.jpg', 'image/jpeg')).status, 404);
  assert.equal((await intruder.get(`/api/attachments/${body.data.id}`)).status, 404);
  assert.equal((await intruder.delete(`/api/attachments/${body.data.id}`)).status, 404);

  // Still there for the owner.
  assert.equal((await api.get(`/api/attachments/${body.data.id}`)).status, 200);
});

test('REQ-81: signing in is required to list or upload', async () => {
  const { transactionId } = await setup();
  const anonymous = apiAs(null);
  assert.equal((await anonymous.get(`/api/transactions/${transactionId}/attachments`)).status, 401);
  assert.equal((await upload(anonymous, transactionId, JPG, 'x.jpg', 'image/jpeg')).status, 401);
});

test('ST_54: deleting removes the record and the stored file, and the old URL stops working', async () => {
  const { api, transactionId, user } = await setup();
  const { body } = await upload(api, transactionId, JPG, 'gone.jpg', 'image/jpeg');
  const { object_key: key } = await Attachment.findById(body.data.id).lean();

  const res = await api.delete(`/api/attachments/${body.data.id}`);
  assert.equal(res.status, 200);
  assert.equal(await Attachment.countDocuments({ _id: body.data.id }), 0);
  assert.equal((await storedFiles()).includes(key), false);
  assert.equal((await fetchUrl(body.data.view_url)).status, 403);

  const audit = await AuditLog.find({ user_id: user._id, entity_type: 'attachment' }).lean();
  assert.deepEqual(audit.map((a) => a.action).sort(), ['delete', 'upload']);
});

test('a deleted transaction cannot take new attachments', async () => {
  const { api, transactionId } = await setup();
  assert.equal((await api.delete(`/api/transactions/${transactionId}`)).status, 200);
  assert.equal((await upload(api, transactionId, JPG, 'late.jpg', 'image/jpeg')).status, 404);
});

test('BR-12: purging an expired transaction also deletes its stored receipt files', async () => {
  const { api, transactionId } = await setup();
  const { body } = await upload(api, transactionId, JPG, 'old.jpg', 'image/jpeg');
  const { object_key: key } = await Attachment.findById(body.data.id).lean();

  await Transaction.updateOne(
    { _id: transactionId },
    { is_deleted: true, deleted_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
  );
  await purgeExpired();

  assert.equal(await Attachment.countDocuments({ transaction_id: transactionId }), 0);
  assert.equal((await storedFiles()).includes(key), false);
});

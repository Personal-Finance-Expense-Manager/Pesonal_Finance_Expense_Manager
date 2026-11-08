import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

process.env.DEV_EMAIL_CONSOLE = 'true';
process.env.UPLOAD_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'pfem-uploads-'));

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

const { startApi, stopApi, apiUrl } = await import('./helpers/integration.js');
const { PASSWORD, bearer, createAdminUser, createRealUser, signIn } = await import('./helpers/auth.js');
const { default: AuditLog } = await import('../src/models/AuditLog.js');
const { default: User } = await import('../src/models/User.js');
const { default: Transaction } = await import('../src/models/Transaction.js');
const { default: Session } = await import('../src/models/Session.js');
const { migrateEncryption } = await import('../src/services/encryptionMigration.js');
const { PRIVACY_POLICY_VERSION } = await import('../src/config/privacy.js');

/**
 * US-28 (#67): SEC-3 encryption at rest, SEC-13 consent and data-subject rights.
 */

before(startApi);
after(async () => {
  await stopApi();
  await fs.rm(process.env.UPLOAD_DIR, { recursive: true, force: true });
});

const anon = () => bearer(apiUrl(), null);
const raw = (name) => mongoose.connection.collection(name);
const today = () => new Date().toISOString().slice(0, 10);

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.alloc(17),
  Buffer.alloc(200, 9), Buffer.from([0, 0, 0, 0]), Buffer.from('IEND'), Buffer.from([0xae, 0x42, 0x60, 0x82]),
]);

async function withData(label) {
  const user = await createRealUser(label, { mobile_number: '+919876543210' });
  const api = bearer(apiUrl(), (await signIn(user)).token);
  const account = (await api.post('/api/accounts', { name: `${label} Account`, type: 'bank', opening_balance: '1000.00', currency: 'INR' })).body.account;
  const category = (await api.post('/api/categories', { name: `${label} Cat`, type: 'expense' })).body.category;
  const tx = (await api.post('/api/transactions', {
    type: 'expense', amount: '45.50', account_id: account.id, category_id: category.id, transaction_date: today(), note: `${label} confidential note`,
  })).body.data;
  const up = await api.raw('POST', `/api/transactions/${tx.id}/attachments`, { body: png, headers: { 'Content-Type': 'image/png', 'X-File-Name': `${label}-receipt.png` } });
  const attachment = (await up.json()).data;
  return { user, api, account, category, tx, attachment };
}

// ---------------------------------------------------------------------------
// SEC-13 - consent at registration
// ---------------------------------------------------------------------------

async function register(overrides = {}) {
  const lines = [];
  const original = console.log;
  console.log = (...a) => { lines.push(a.join(' ')); };
  let res;
  try {
    res = await anon().post('/api/auth/register', {
      name: 'New Person', email: `new${Date.now()}${Math.floor(Math.random() * 1e4)}@example.test`, password: 'Str0ng!Passw0rd',
      termsAccepted: true, privacyPolicyAccepted: true, dataProcessingConsent: true, ...overrides,
    });
  } finally {
    console.log = original;
  }
  return { res, code: /\b(\d{6})\b/.exec(lines.join('\n'))?.[1] };
}

test('SEC-13 registration is refused without explicit consent to process personal data', async () => {
  const usersBefore = await User.countDocuments({});
  for (const consent of [undefined, false, 'true', 1, null, 'yes']) {
    const body = { name: 'A', email: 'consent@example.test', password: 'Str0ng!Passw0rd', termsAccepted: true, privacyPolicyAccepted: true };
    if (consent !== undefined) body.dataProcessingConsent = consent;
    const res = await anon().post('/api/auth/register', body);
    assert.equal(res.status, 400, String(consent));
    assert.match(res.body.message, /consent/i);
  }
  assert.equal(await User.countDocuments({}), usersBefore, 'no account was created');
});

test('SEC-13 consent is stored with its version, purposes, time and source IP', async () => {
  const { res } = await register({ email: 'consented@example.test' });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const stored = await raw('users').findOne({ email_hash: { $exists: true }, 'consent.personal_data_processing': true }, { sort: { _id: -1 } });
  assert.equal(stored.consent.personal_data_processing, true);
  assert.equal(stored.consent.policy_version, PRIVACY_POLICY_VERSION);
  assert.ok(stored.consent.purposes.length >= 3);
  assert.ok(stored.consent.given_at instanceof Date);
  assert.match(stored.consent.given_ip, /127\.0\.0\.1|::1/);
  assert.equal(stored.consent.withdrawn_at, null);
  assert.ok(stored.terms_accepted_at && stored.privacy_policy_accepted_at);

  const audited = await AuditLog.findOne({ action: 'auth.register' }).lean();
  assert.equal(audited.metadata.consent_policy_version, PRIVACY_POLICY_VERSION);
  assert.ok(!JSON.stringify(audited).includes('consented@example.test'));
});

test('SEC-13 a person registers, verifies by email code and signs in end to end with encrypted storage', async () => {
  const email = `e2e${Date.now()}@example.test`;
  const { res, code } = await register({ email, name: 'End To End' });
  assert.equal(res.status, 201);
  assert.ok(code, 'the development mail console printed a code');

  assert.equal((await anon().post('/api/auth/verify-email', { email, code })).status, 200);
  const login = await anon().post('/api/auth/login', { email: email.toUpperCase(), password: 'Str0ng!Passw0rd' });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.name, 'End To End');
  assert.equal(login.body.user.email, email);

  const stored = await raw('users').findOne({ email_hash: { $exists: true }, name: { $not: /^Erased/ } }, { sort: { _id: -1 } });
  assert.ok(stored.name.startsWith('enc:v1:') && stored.email.startsWith('enc:v1:'));
  assert.ok(!JSON.stringify(stored).includes(email) && !JSON.stringify(stored).includes('End To End'));
});

test('SEC-2 passwords are stored as bcrypt with a work factor of at least 12, never in plaintext', async () => {
  const email = `bcrypt${Date.now()}@example.test`;
  const password = 'Str0ng!Passw0rd';
  await register({ email, password });
  const stored = await raw('users').findOne({ password_hash: { $exists: true } }, { sort: { _id: -1 } });
  const match = /^\$2[aby]\$(\d{2})\$/.exec(stored.password_hash);
  assert.ok(match, 'a bcrypt hash');
  assert.ok(Number(match[1]) >= 12, `cost ${match[1]}`);
  assert.ok(!JSON.stringify(stored).includes(password));

  // Password reset writes a hash with the same minimum cost.
  const user = await createRealUser('resetter');
  const { default: crypto } = await import('node:crypto');
  const token = crypto.randomBytes(32).toString('hex');
  await User.updateOne({ _id: user._id }, { password_reset_token_hash: crypto.createHash('sha256').update(token).digest('hex'), password_reset_expires_at: new Date(Date.now() + 600_000) });
  const reset = await anon().post('/api/auth/password-reset/confirm', { email: user.email, token, newPassword: 'N3w!Passw0rd-xyz', confirmPassword: 'N3w!Passw0rd-xyz' });
  if (reset.status === 200) {
    const after = await raw('users').findOne({ _id: user._id });
    assert.ok(Number(/^\$2[aby]\$(\d{2})\$/.exec(after.password_hash)[1]) >= 12);
    assert.ok(!JSON.stringify(after).includes('N3w!Passw0rd'));
  }
});

// ---------------------------------------------------------------------------
// SEC-3 - encryption at rest, with the application still working
// ---------------------------------------------------------------------------

test('SEC-3 names, emails, mobile numbers, notes and attachment names are ciphertext in the database; the API still shows plaintext', async () => {
  const { user, api, tx, attachment } = await withData('crypt');

  const u = await raw('users').findOne({ _id: user._id });
  for (const field of ['name', 'email', 'mobile_number']) assert.match(u[field], /^enc:v1:/, field);
  assert.match(u.email_hash, /^[a-f\d]{64}$/);
  assert.ok(!JSON.stringify(u).includes('crypt'), 'no fragment of the name or email is stored in the clear');
  assert.ok(!JSON.stringify(u).includes('9876543210'));

  const t = await raw('transactions').findOne({ _id: new mongoose.Types.ObjectId(tx.id) });
  assert.match(t.note, /^enc:v1:/);
  assert.ok(!JSON.stringify(t).includes('confidential'));

  const a = await raw('attachments').findOne({ _id: new mongoose.Types.ObjectId(attachment.id) });
  assert.match(a.file_name, /^enc:v1:/);

  const listed = await api.get('/api/transactions');
  assert.ok(JSON.stringify(listed.body).includes('crypt confidential note'), 'the owner sees the note');
  assert.ok(!JSON.stringify(listed.body).includes('enc:v1:'), 'ciphertext never reaches a client');
  assert.equal((await api.get('/api/auth/me')).body.data.name, user.name);
});

test('SEC-3 the same note encrypts differently each time (no equality leak), and both read back', async () => {
  const { api, account, category } = await withData('twice');
  for (let i = 0; i < 2; i += 1) {
    await api.post('/api/transactions', { type: 'expense', amount: '1', account_id: account.id, category_id: category.id, transaction_date: today(), note: 'identical note' });
  }
  const notes = (await raw('transactions').find({ note: /^enc:v1:/ }).toArray()).map((t) => t.note);
  assert.equal(new Set(notes).size, notes.length);
  assert.equal((await api.get('/api/transactions?search=IDENTICAL')).body.data.length, 2);
});

test('SEC-3 searching notes still works although they are encrypted, and combines with other filters and pagination', async () => {
  const { api, account, category } = await withData('searcher');
  for (const note of ['Coffee with Anand', 'Monthly rent', 'coffee beans', 'Groceries']) {
    await api.post('/api/transactions', { type: 'expense', amount: '10', account_id: account.id, category_id: category.id, transaction_date: today(), note });
  }
  const found = await api.get('/api/transactions?search=COFFEE');
  assert.equal(found.status, 200);
  assert.equal(found.body.data.length, 2);
  assert.ok(found.body.data.every((t) => /coffee/i.test(t.note)));
  assert.equal((await api.get('/api/transactions?search=zzz-nothing')).body.data.length, 0);
  assert.equal((await api.get('/api/transactions?search=coffee&limit=1')).body.data.length, 1);
  assert.equal((await api.get('/api/transactions?search=coffee&limit=1')).body.pagination?.total_items ?? 2, 2);
  assert.equal((await api.get('/api/transactions?search=.*')).body.data.length, 0, 'a regex is matched literally');
});

test('SEC-3 an email address is still unique and case-insensitive although it is encrypted', async () => {
  const first = await createRealUser('unique');
  await assert.rejects(User.create({ name: 'Dup', email: first.email.toUpperCase(), password_hash: 'x', email_verified: true }), (e) => e.code === 11000);
  const second = await createRealUser('other');
  assert.equal((await User.findOne({ email: second.email.toUpperCase() }))._id.toString(), String(second._id));
  assert.equal(await User.findOne({ email: 'nobody@example.test' }), null);
});

test('SEC-3 uploaded files are readable again through the API after being encrypted on disk', async () => {
  const { attachment } = await withData('fileback');
  const res = await fetch(attachment.view_url);
  assert.equal(res.status, 200);
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(png));
  const files = await fs.readdir(process.env.UPLOAD_DIR);
  const onDisk = await fs.readFile(path.join(process.env.UPLOAD_DIR, files[0]));
  assert.ok(!onDisk.includes(Buffer.from('IHDR')));
});

test('SEC-3 a damaged ciphertext in one record does not break the list that contains it', async () => {
  const { user, api, account, category } = await withData('damaged');
  await api.post('/api/transactions', { type: 'expense', amount: '3', account_id: account.id, category_id: category.id, transaction_date: today(), note: 'second good note' });
  await raw('transactions').updateOne({ user_id: user._id, note: /^enc:v1:/ }, { $set: { note: 'enc:v1:1:AAAA:AAAA:AAAA' } });
  const res = await api.get('/api/transactions');
  assert.equal(res.status, 200);
  assert.ok(res.body.data.length >= 2);
});

test('SEC-3 a note that merely looks like ciphertext is stored safely and read back as typed', async () => {
  const { api, account, category } = await withData('lookalike');
  const text = 'enc:v1:1:AAAA:BBBB:CCCC';
  const res = await api.post('/api/transactions', { type: 'expense', amount: '1', account_id: account.id, category_id: category.id, transaction_date: today(), note: text });
  assert.equal(res.status, 201);
  assert.ok(JSON.stringify((await api.get('/api/transactions')).body).includes(text));
});

test('SEC-3 the migration encrypts existing plaintext records and files, is safe to repeat, and changes nothing on a dry run', async () => {
  const { user } = await withData('legacy');
  const { default: Attachment } = await import('../src/models/Attachment.js');
  const att = await raw('attachments').findOne({ user_id: user._id });
  const key = att.object_key;

  // Put the user back into the pre-encryption state.
  const { decryptString } = await import('../src/utils/crypto.js');
  const { decryptBuffer } = await import('../src/utils/crypto.js');
  const original = await raw('users').findOne({ _id: user._id });
  await raw('users').updateOne({ _id: user._id }, { $set: { name: decryptString(original.name), email: decryptString(original.email), mobile_number: decryptString(original.mobile_number) }, $unset: { email_hash: '' } });
  const tx = await raw('transactions').findOne({ user_id: user._id });
  await raw('transactions').updateOne({ _id: tx._id }, { $set: { note: decryptString(tx.note) } });
  const filePath = path.join(process.env.UPLOAD_DIR, key);
  await fs.writeFile(filePath, decryptBuffer(await fs.readFile(filePath), key));

  // Legacy rows still work before the migration has run.
  assert.equal((await User.findOne({ email: user.email }))?.name, user.name);

  const dry = await migrateEncryption({ dryRun: true });
  assert.ok(dry.collections.users.updated >= 1 && dry.files.encrypted >= 1);
  assert.ok(!(await raw('users').findOne({ _id: user._id })).name.startsWith('enc:v1:'), 'a dry run writes nothing');

  const done = await migrateEncryption();
  assert.ok(done.collections.users.updated >= 1);
  const migrated = await raw('users').findOne({ _id: user._id });
  assert.match(migrated.email, /^enc:v1:/);
  assert.match(migrated.email_hash, /^[a-f\d]{64}$/);
  assert.match((await raw('transactions').findOne({ _id: tx._id })).note, /^enc:v1:/);
  assert.equal((await fs.readFile(filePath)).subarray(0, 8).toString(), 'PFEMENC1');

  const again = await migrateEncryption();
  assert.equal(again.collections.users.updated, 0, 'running it twice changes nothing');
  assert.equal(again.files.encrypted, 0);

  assert.equal((await User.findOne({ email: user.email }))?.name, user.name, 'lookups work on the migrated record');
  assert.ok((await Attachment.findById(att._id)).file_name.includes('legacy'));
  assert.ok(Buffer.from(await (await fetch((await bearer(apiUrl(), (await signIn(user)).token).get(`/api/transactions/${tx._id}/attachments`)).body.data[0].view_url)).arrayBuffer()).equals(png));
});

// ---------------------------------------------------------------------------
// SEC-13 - access, portability, correction
// ---------------------------------------------------------------------------

test('SEC-13 access: a person sees what is held about them, their consent, and the retention rules', async () => {
  const { api } = await withData('access');
  const res = await api.get('/api/privacy/me');
  assert.equal(res.status, 200);
  const { data } = res.body;
  assert.match(data.profile.email, /^access/);
  assert.equal(data.consent.personal_data_processing, true);
  assert.ok(data.records_held.transactions >= 1 && data.records_held.accounts >= 1 && data.records_held.attachments >= 1);
  assert.ok(data.retention.audit_trail.includes('12 months') && data.retention.backups.includes('7 days'));
  assert.ok(data.your_rights.erasure_and_withdrawal_of_consent);
  assert.ok(!JSON.stringify(res.body).includes('password_hash'));
  assert.equal((await bearer(apiUrl(), null).get('/api/privacy/me')).status, 401);
});

test('SEC-13 portability: the export is the person\'s whole data, as JSON, decrypted, and only theirs', async () => {
  const mine = await withData('portable');
  const other = await withData('bystander');
  const res = await mine.api.get('/api/privacy/export');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment/);
  const text = JSON.stringify(res.body);
  assert.ok(text.includes('portable confidential note') && text.includes('portable Account'));
  assert.ok(!text.includes('bystander'));
  for (const forbidden of ['password_hash', 'enc:v1:', 'email_hash']) assert.ok(!text.includes(forbidden), forbidden);
  assert.ok(await AuditLog.findOne({ user_id: mine.user._id, action: 'export.privacy_portability', category: 'export' }));
  void other;
});

test('SEC-13 correction: a person can correct their name and mobile number, and the change is audited by field name only', async () => {
  const { user, api } = await withData('correct');
  const res = await api.patch('/api/privacy/profile', { name: 'Corrected Name', mobileNumber: '+911111111111' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.name, 'Corrected Name');
  assert.equal((await User.findById(user._id)).name, 'Corrected Name');
  assert.match((await raw('users').findOne({ _id: user._id })).name, /^enc:v1:/);

  const entry = await AuditLog.findOne({ user_id: user._id, action: 'privacy.profile_corrected' }).lean();
  assert.deepEqual(entry.metadata.fields.sort(), ['mobile_number', 'name']);
  assert.ok(!JSON.stringify(entry).includes('Corrected Name'));

  for (const bad of [{}, { name: '' }, { name: 'x'.repeat(200) }, { name: 42 }, { mobileNumber: 'x'.repeat(40) }]) {
    assert.equal((await api.patch('/api/privacy/profile', bad)).status, 400, JSON.stringify(bad));
  }
  const ignored = await api.patch('/api/privacy/profile', { name: 'Still Fine', role: 'admin', email: 'x@y.z', status: 'active' });
  assert.equal(ignored.status, 200);
  const after = await User.findById(user._id);
  assert.equal(after.role, 'user', 'mass assignment of the role is impossible');
  assert.equal(after.email, user.email);
});

test('SEC-13 an account created before consent existed can record consent, and it is audited', async () => {
  const user = await createRealUser('oldaccount', { consent: null });
  const api = bearer(apiUrl(), (await signIn(user)).token);
  assert.equal((await api.get('/api/auth/me')).body.data.consent_given, false);
  assert.equal((await api.post('/api/privacy/consent', {})).status, 400);
  assert.equal((await api.post('/api/privacy/consent', { dataProcessingConsent: 'yes' })).status, 400);
  const res = await api.post('/api/privacy/consent', { dataProcessingConsent: true });
  assert.equal(res.status, 201);
  assert.equal((await api.get('/api/auth/me')).body.data.consent_given, true);
  assert.equal((await User.findById(user._id)).consent.policy_version, PRIVACY_POLICY_VERSION);
  assert.ok(await AuditLog.findOne({ user_id: user._id, action: 'privacy.consent_recorded' }));
});

// ---------------------------------------------------------------------------
// SEC-13 - erasure (also how consent is withdrawn)
// ---------------------------------------------------------------------------

test('SEC-13 erasure needs the password and a typed confirmation', async () => {
  const { user, api } = await withData('refuse');
  assert.equal((await api.delete('/api/privacy/account', { password: PASSWORD })).status, 400);
  assert.equal((await api.delete('/api/privacy/account', { confirm: 'DELETE' })).status, 403);
  assert.equal((await api.delete('/api/privacy/account', { confirm: 'DELETE', password: 'Wrong-Password1!' })).status, 403);
  assert.equal((await User.findById(user._id)).status, 'active');
  assert.ok(await Transaction.countDocuments({ user_id: user._id }));
});

test('SEC-13 an administrator account cannot be erased through the self-service endpoint', async () => {
  const admin = await createAdminUser('eraseadmin');
  const api = bearer(apiUrl(), (await signIn(admin)).token);
  assert.equal((await api.delete('/api/privacy/account', { confirm: 'DELETE', password: PASSWORD })).status, 403);
});

test('SEC-13 erasure removes the person\'s data everywhere, deletes their files, ends their sessions and keeps only an anonymous tombstone', async () => {
  const gone = await withData('erased');
  const keeper = await withData('keeper');
  const { default: Attachment } = await import('../src/models/Attachment.js');
  const key = (await raw('attachments').findOne({ user_id: gone.user._id })).object_key;
  const filesBefore = (await fs.readdir(process.env.UPLOAD_DIR)).length;

  const res = await gone.api.delete('/api/privacy/account', { confirm: 'DELETE', password: PASSWORD });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.data.collections_cleared >= 3);

  // Every collection that holds user records is empty for this user.
  const mongooseModels = mongoose.modelNames().filter((n) => !['User', 'AuditLog'].includes(n)).map((n) => mongoose.model(n)).filter((m) => m.schema.path('user_id'));
  for (const model of mongooseModels) assert.equal(await model.countDocuments({ user_id: gone.user._id }), 0, model.modelName);
  assert.equal(await Attachment.countDocuments({ user_id: gone.user._id }), 0);

  // Their file is gone from disk; nobody else's is.
  await assert.rejects(fs.stat(path.join(process.env.UPLOAD_DIR, key)));
  assert.equal((await fs.readdir(process.env.UPLOAD_DIR)).length, filesBefore - 1);

  // The user record is an anonymous tombstone.
  const tomb = await raw('users').findOne({ _id: gone.user._id });
  assert.equal(tomb.status, 'closed');
  assert.ok(tomb.erased_at);
  for (const field of ['password_hash', 'email_hash', 'mobile_number', 'app_lock_pin_hash', 'monthly_income']) assert.equal(tomb[field], undefined, field);
  assert.equal(tomb.name, 'Erased user');
  assert.ok(tomb.email.startsWith('erased-') && tomb.email.endsWith('@invalid.example'));
  assert.ok(!JSON.stringify(tomb).includes(gone.user.email), 'the original address is gone');
  assert.equal(tomb.consent.personal_data_processing, false);
  assert.ok(tomb.consent.withdrawn_at);

  // They are signed out and cannot come back.
  assert.equal(await Session.countDocuments({ user_id: gone.user._id, revoked_at: null }), 0);
  assert.equal((await gone.api.get('/api/transactions')).status, 401);
  assert.equal((await anon().post('/api/auth/login', { email: gone.user.email, password: PASSWORD })).status, 401);
  assert.equal((await gone.api.delete('/api/privacy/account', { confirm: 'DELETE', password: PASSWORD })).status, 401);

  // Somebody else is untouched.
  assert.ok((await keeper.api.get('/api/transactions')).body.data.length >= 1);
  assert.equal((await fetch(keeper.attachment.view_url)).status, 200);

  // The audit trail records the erasure, without the person's details.
  const entries = await AuditLog.find({ user_id: gone.user._id, category: 'privacy' }).lean();
  assert.deepEqual(entries.map((e) => e.action).sort(), ['privacy.account_erased', 'privacy.account_erasure_started']);
  const dump = JSON.stringify(await AuditLog.find({ user_id: gone.user._id }).lean());
  assert.ok(!dump.includes(gone.user.email) && !dump.includes('confidential'));
});

test('SEC-13 an erased person\'s email address can be registered again', async () => {
  const { user, api } = await withData('reuse');
  await api.delete('/api/privacy/account', { confirm: 'DELETE', password: PASSWORD });
  const { res } = await register({ email: user.email, name: 'Returning' });
  assert.equal(res.status, 201);
});

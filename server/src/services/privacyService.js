import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Session from '../models/Session.js';
import Attachment from '../models/Attachment.js';
import { ApiError } from '../utils/apiError.js';
import { deleteObject } from './storageService.js';
import { recordAuditStrict } from './auditService.js';

/**
 * Personal-data rights - US-28 (#67), SRS SEC-13 and the DPDP Act, 2023:
 *
 *   access        GET    /api/privacy/me          what is held, consent, retention
 *   portability   GET    /api/privacy/export      everything, as JSON (same export as REQ-87)
 *   correction    PATCH  /api/privacy/profile     name and mobile number
 *   consent       POST   /api/privacy/consent     record consent (accounts made before it existed)
 *   erasure       DELETE /api/privacy/account     erase the account and all its data
 *                                                 (this is also how consent is withdrawn)
 *
 * What this does NOT do: it does not decide whether the product is legally
 * compliant. Grievance-officer contact, breach notification and the published
 * notice are organisational duties listed in docs/SECURITY.md.
 */

export const RETENTION_NOTICE = {
  account_data: 'Kept while your account exists; deleted when you erase your account.',
  recycle_bin: 'Deleted transactions are kept 30 days in the recycle bin, then removed permanently.',
  audit_trail: 'A security record of sign-ins and account actions (no amounts or notes) is kept for 12 months, as the security policy requires, then removed automatically.',
  backups: 'Encrypted backups are kept for 7 days. Erased data leaves them as they expire.',
};

const here = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.resolve(here, '../models');

/** Make sure every model file has registered itself, so erasure cannot miss one. */
async function loadAllModels() {
  for (const file of await fs.readdir(modelsDir)) {
    if (file.endsWith('.js')) await import(pathToFileURL(path.join(modelsDir, file)).href);
  }
}

/** Every collection that holds a user's own records (a `user_id` path), except the audit trail and the user itself. */
async function userOwnedModels() {
  await loadAllModels();
  return mongoose
    .modelNames()
    .filter((name) => name !== 'User' && name !== 'AuditLog')
    .map((name) => mongoose.model(name))
    .filter((model) => model.schema.path('user_id'));
}

export async function dataInventory(userId) {
  const models = await userOwnedModels();
  const counts = await Promise.all(models.map((m) => m.countDocuments({ user_id: userId })));
  const inventory = {};
  models.forEach((model, i) => {
    if (counts[i] > 0) inventory[model.collection.name] = counts[i];
  });
  return inventory;
}

export async function accessReport(userId) {
  const user = await User.findById(userId).lean();
  if (!user) throw new ApiError(404, 'Account not found.');

  return {
    profile: {
      name: user.name,
      email: user.email,
      mobile_number: user.mobile_number ?? null,
      created_at: user.createdAt,
      last_sign_in_at: user.last_sign_in_at ?? null,
    },
    consent: user.consent ?? null,
    records_held: await dataInventory(userId),
    retention: RETENTION_NOTICE,
    your_rights: {
      access: 'GET /api/privacy/me',
      portability: 'GET /api/privacy/export',
      correction: 'PATCH /api/privacy/profile',
      erasure_and_withdrawal_of_consent: 'DELETE /api/privacy/account',
    },
  };
}

export async function correctProfile(userId, { name, mobileNumber }) {
  const changes = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) throw new ApiError(400, 'Enter your full name (up to 120 characters).');
    changes.name = name.trim();
  }
  if (mobileNumber !== undefined) {
    if (mobileNumber !== null && (typeof mobileNumber !== 'string' || mobileNumber.trim().length > 30)) {
      throw new ApiError(400, 'Enter a valid mobile number.');
    }
    changes.mobile_number = mobileNumber ? mobileNumber.trim() : null;
  }
  if (!Object.keys(changes).length) throw new ApiError(400, 'Nothing to correct. Send name and/or mobileNumber.');

  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, 'Account not found.');
  Object.assign(user, changes);
  await user.save();

  return { fields: Object.keys(changes), profile: { name: user.name, email: user.email, mobile_number: user.mobile_number ?? null } };
}

export async function recordConsent(userId, { policyVersion, purposes, ip }) {
  const now = new Date();
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        consent: {
          personal_data_processing: true,
          policy_version: policyVersion,
          purposes,
          given_at: now,
          given_ip: ip ? String(ip).slice(0, 64) : null,
          withdrawn_at: null,
        },
        privacy_policy_accepted_at: now,
      },
    },
  );
  return { policy_version: policyVersion, given_at: now };
}

/**
 * Erase an account. The person's records are deleted from every collection
 * that holds them, stored receipt files are removed, every session ends and
 * the user record is reduced to an anonymous tombstone (so audit entries that
 * name the id stay meaningful without naming a person). The audit trail itself
 * is kept for its 12-month period; it holds no names, emails, amounts or notes.
 */
export async function eraseAccount(userId, { password, confirm }, ip) {
  if (confirm !== 'DELETE') throw new ApiError(400, 'Type DELETE to confirm. This permanently erases your account and data.');

  const user = await User.findById(userId).select('+password_hash');
  if (!user || user.status === 'closed') throw new ApiError(404, 'Account not found.');
  if (user.role === 'admin') throw new ApiError(403, 'An administrator account cannot be erased here. Remove the role first.');

  if (typeof password !== 'string' || !password || password.length > 128 || !(await bcrypt.compare(password, user.password_hash))) {
    throw new ApiError(403, 'Your password is not correct.');
  }

  await recordAuditStrict({
    userId: user._id, actorRole: 'user', category: 'privacy', action: 'privacy.account_erasure_started',
    entityType: 'user', entityId: user._id, ip,
  });

  // Files first: they are found through the records that are about to go.
  const files = await Attachment.find({ user_id: user._id }).select('object_key').lean();
  for (const file of files) await deleteObject(file.object_key).catch(() => {});

  const deleted = {};
  for (const model of await userOwnedModels()) {
    const result = await model.deleteMany({ user_id: user._id });
    if (result.deletedCount) deleted[model.collection.name] = result.deletedCount;
  }

  const now = new Date();
  await Session.updateMany({ user_id: user._id, revoked_at: null }, { $set: { revoked_at: now } });

  // Replace every personal field. Set directly on the collection: the encrypted
  // fields must not be re-encrypted from a placeholder that looks real.
  await User.collection.updateOne(
    { _id: user._id },
    {
      $set: {
        name: 'Erased user',
        email: `erased-${user._id}@invalid.example`,
        status: 'closed',
        erased_at: now,
        email_verified: false,
        app_lock_enabled: false,
        consent: { personal_data_processing: false, policy_version: null, purposes: [], given_at: null, given_ip: null, withdrawn_at: now },
      },
      $unset: {
        email_hash: '', mobile_number: '', password_hash: '', app_lock_pin_hash: '',
        email_verification_code_hash: '', email_verification_expires_at: '',
        password_reset_token_hash: '', password_reset_expires_at: '', app_lock_credentials: '',
        monthly_income: '',
      },
    },
  );

  await recordAuditStrict({
    userId: user._id, actorRole: 'user', category: 'privacy', action: 'privacy.account_erased',
    entityType: 'user', entityId: user._id, ip, metadata: { collections_cleared: Object.keys(deleted).length },
  }).catch(() => {});

  return { erased_at: now, collections_cleared: Object.keys(deleted).length };
}

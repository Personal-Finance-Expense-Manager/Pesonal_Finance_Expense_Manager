import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Session from '../models/Session.js';
import AuditLog, { AUDIT_CATEGORIES } from '../models/AuditLog.js';
import { ApiError } from '../utils/apiError.js';
import { recordAuditStrict } from './auditService.js';

/**
 * Administrator user management - US-26 (#62), SRS REQ-94.
 *
 * PRIVACY BY CONSTRUCTION. An administrator manages accounts, not money. Every
 * query here selects an explicit allow-list of account fields (ADMIN_USER_FIELDS)
 * from the users collection only. There is no code path from this module to the
 * transactions, accounts, budgets, goals, reports or attachments collections, so
 * no admin endpoint can return an amount, a balance, a note, a file or a report.
 * The password hash, PIN hash, verification and reset secrets are never selected.
 */

export const ADMIN_USER_FIELDS =
  '_id name email role status email_verified createdAt last_sign_in_at suspended_at suspended_by suspension_reason erased_at consent.personal_data_processing consent.given_at consent.withdrawn_at';

export function presentAdminUser(user) {
  return {
    id: String(user._id),
    name: user.name ?? null,
    email: user.email ?? null,
    role: user.role || 'user',
    status: user.status,
    email_verified: Boolean(user.email_verified),
    created_at: user.createdAt ?? null,
    last_sign_in_at: user.last_sign_in_at ?? null,
    suspended_at: user.suspended_at ?? null,
    suspension_reason: user.suspension_reason ?? null,
    erased_at: user.erased_at ?? null,
    consent_given: Boolean(user.consent?.personal_data_processing) && !user.consent?.withdrawn_at,
  };
}

const USER_STATUSES = ['active', 'suspended', 'closed'];
const objectId = (value, message = 'User not found.') => {
  if (!mongoose.isValidObjectId(value)) throw new ApiError(404, message);
  return new mongoose.Types.ObjectId(String(value));
};

export async function userSummary(now = new Date()) {
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [byStatus, unverified, admins, recent, total] = await Promise.all([
    User.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    User.countDocuments({ email_verified: false, status: { $ne: 'closed' } }),
    User.countDocuments({ role: 'admin' }),
    User.countDocuments({ createdAt: { $gte: since } }),
    User.countDocuments({}),
  ]);

  const counts = Object.fromEntries(USER_STATUSES.map((status) => [status, 0]));
  for (const row of byStatus) if (row._id in counts) counts[row._id] = row.count;

  return { total, ...counts, unverified, admins, new_last_30_days: recent };
}

export async function listUsers(query, { page, limit }) {
  const filter = {};

  if (query.status !== undefined) {
    if (!USER_STATUSES.includes(query.status)) throw new ApiError(400, `status must be one of: ${USER_STATUSES.join(', ')}.`);
    filter.status = query.status;
  }
  if (query.role !== undefined) {
    if (!['user', 'admin'].includes(query.role)) throw new ApiError(400, 'role must be user or admin.');
    filter.role = query.role;
  }
  if (query.verified !== undefined) {
    if (!['true', 'false'].includes(query.verified)) throw new ApiError(400, 'verified must be true or false.');
    filter.email_verified = query.verified === 'true';
  }
  if (query.email !== undefined) {
    // Names and addresses are encrypted, so only an exact address can be searched.
    if (typeof query.email !== 'string' || query.email.length > 254) throw new ApiError(400, 'email must be a single address.');
    filter.email = query.email.trim().toLowerCase();
  }
  if (query.id !== undefined) {
    if (!mongoose.isValidObjectId(query.id)) throw new ApiError(400, 'id is not valid.');
    filter._id = query.id;
  }

  const sortKey = { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, last_sign_in: { last_sign_in_at: -1 } }[query.sort ?? 'newest'];
  if (!sortKey) throw new ApiError(400, 'sort must be newest, oldest or last_sign_in.');

  const [rows, total] = await Promise.all([
    User.find(filter).select(ADMIN_USER_FIELDS).sort({ ...sortKey, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  return { data: rows.map(presentAdminUser), page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) };
}

export async function getUser(id) {
  const user = await User.findById(objectId(id)).select(ADMIN_USER_FIELDS).lean();
  if (!user) throw new ApiError(404, 'User not found.');
  return presentAdminUser(user);
}

async function loadTarget(adminId, id) {
  const targetId = objectId(id);
  if (String(targetId) === String(adminId)) throw new ApiError(400, 'You cannot change the status of your own account.');

  const target = await User.findById(targetId).select('_id role status').lean();
  if (!target) throw new ApiError(404, 'User not found.');
  if (target.role === 'admin') throw new ApiError(403, 'Administrator accounts cannot be suspended here.');
  return target;
}

export async function suspendUser(admin, id, reason, ip) {
  const clean = typeof reason === 'string' ? reason.trim() : '';
  if (!clean || clean.length > 300) throw new ApiError(400, 'Give a reason for the suspension (up to 300 characters).');

  const target = await loadTarget(admin._id, id);
  if (target.status === 'suspended') throw new ApiError(409, 'This account is already suspended.');
  if (target.status !== 'active') throw new ApiError(409, 'Only an active account can be suspended.');

  // The action does not happen unless the record of it can be stored.
  await recordAuditStrict({
    userId: admin._id, actorRole: 'admin', targetUserId: target._id, category: 'admin',
    action: 'admin.user_suspended', entityType: 'user', entityId: target._id, ip,
    metadata: { reason: clean },
  });

  const now = new Date();
  const updated = await User.findOneAndUpdate(
    { _id: target._id, status: 'active', role: { $ne: 'admin' } },
    { $set: { status: 'suspended', suspended_at: now, suspended_by: admin._id, suspension_reason: clean } },
    { new: true },
  ).select(ADMIN_USER_FIELDS).lean();

  if (!updated) throw new ApiError(409, 'The account changed while you were suspending it. Reload and try again.');

  // Take effect immediately: every open session of that user ends now.
  await Session.updateMany({ user_id: target._id, revoked_at: null }, { $set: { revoked_at: now } });

  return presentAdminUser(updated);
}

export async function restoreUser(admin, id, ip) {
  const target = await loadTarget(admin._id, id);
  if (target.status !== 'suspended') throw new ApiError(409, 'Only a suspended account can be restored.');

  await recordAuditStrict({
    userId: admin._id, actorRole: 'admin', targetUserId: target._id, category: 'admin',
    action: 'admin.user_restored', entityType: 'user', entityId: target._id, ip,
  });

  const updated = await User.findOneAndUpdate(
    { _id: target._id, status: 'suspended' },
    { $set: { status: 'active', suspended_at: null, suspended_by: null, suspension_reason: null } },
    { new: true },
  ).select(ADMIN_USER_FIELDS).lean();

  if (!updated) throw new ApiError(409, 'The account changed while you were restoring it. Reload and try again.');
  return presentAdminUser(updated);
}

export async function listAuditLogs(query, { page, limit }) {
  const filter = {};

  if (query.category !== undefined) {
    if (!AUDIT_CATEGORIES.includes(query.category)) throw new ApiError(400, `category must be one of: ${AUDIT_CATEGORIES.join(', ')}.`);
    filter.category = query.category;
  }
  if (query.outcome !== undefined) {
    if (!['success', 'failure', 'denied'].includes(query.outcome)) throw new ApiError(400, 'outcome must be success, failure or denied.');
    filter.outcome = query.outcome;
  }
  if (query.action !== undefined) {
    if (typeof query.action !== 'string' || !/^[a-z0-9_.]{1,80}$/.test(query.action)) throw new ApiError(400, 'action is not valid.');
    filter.action = query.action;
  }
  if (query.userId !== undefined) {
    if (!mongoose.isValidObjectId(query.userId)) throw new ApiError(400, 'userId is not valid.');
    filter.user_id = query.userId;
  }
  for (const [param, op] of [['from', '$gte'], ['to', '$lte']]) {
    if (query[param] === undefined) continue;
    const date = new Date(query[param]);
    if (Number.isNaN(date.getTime())) throw new ApiError(400, `${param} must be a date.`);
    filter.timestamp = { ...(filter.timestamp || {}), [op]: date };
  }

  const [rows, total] = await Promise.all([
    AuditLog.find(filter).sort({ timestamp: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);

  return {
    data: rows.map((row) => ({
      id: String(row._id),
      timestamp: row.timestamp,
      action: row.action,
      category: row.category,
      outcome: row.outcome,
      actor_id: row.user_id ? String(row.user_id) : null,
      actor_role: row.actor_role ?? null,
      target_user_id: row.target_user_id ? String(row.target_user_id) : null,
      entity_type: row.entity_type ?? null,
      entity_id: row.entity_id ? String(row.entity_id) : null,
      ip_address: row.ip_address ?? null,
      metadata: row.metadata ?? null,
    })),
    page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)),
  };
}

/** Re-check the administrator's own password before a destructive action. */
export async function confirmAdminPassword(adminId, password) {
  if (typeof password !== 'string' || !password || password.length > 128) return false;
  const admin = await User.findById(adminId).select('+password_hash');
  return Boolean(admin?.password_hash) && bcrypt.compare(password, admin.password_hash);
}

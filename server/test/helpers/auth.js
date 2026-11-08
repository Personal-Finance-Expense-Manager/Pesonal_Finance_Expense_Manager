/**
 * Real-token helpers for the US-26 / US-28 integration tests.
 *
 * The older suites sign requests with the development X-User-Id header. These
 * helpers mint genuine JWTs backed by Session records, so authentication, roles,
 * suspension, idle timeout and token expiry are exercised the way production
 * sees them. Import this AFTER helpers/integration.js (it needs the app's models).
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import Session from '../../src/models/Session.js';
import User from '../../src/models/User.js';

export const PASSWORD = 'Sup3r-Secret!pw';
let counter = 0;
let passwordHash;

export async function createRealUser(label = 'person', overrides = {}) {
  counter += 1;
  passwordHash ??= await bcrypt.hash(PASSWORD, 12);
  return User.create({
    name: `${label} ${counter}`,
    email: `${label}${counter}.${crypto.randomBytes(3).toString('hex')}@example.test`,
    password_hash: passwordHash,
    email_verified: true,
    status: 'active',
    consent: { personal_data_processing: true, policy_version: 'test', purposes: ['account_management'], given_at: new Date() },
    ...overrides,
  });
}

export const createAdminUser = (label = 'admin') => createRealUser(label, { role: 'admin' });

/** A valid signed-in session for `user`. Returns { token, session, jti }. */
export async function signIn(user, { lastActivity = new Date(), expiresInSeconds = 24 * 3600 } = {}) {
  const jti = crypto.randomUUID();
  const session = await Session.create({
    jti,
    user_id: user._id,
    expires_at: new Date(Date.now() + expiresInSeconds * 1000),
    last_activity_at: lastActivity,
  });
  const token = jwt.sign({ jti }, process.env.JWT_SECRET, {
    subject: String(user._id),
    expiresIn: expiresInSeconds,
    algorithm: 'HS256',
  });
  return { token, session, jti };
}

export function signToken(claims, options = {}, secret = process.env.JWT_SECRET) {
  return jwt.sign(claims, secret, { algorithm: 'HS256', ...options });
}

/** An HTTP client that sends `Authorization: Bearer <token>`. */
export function bearer(baseUrl, token, extraHeaders = {}) {
  async function request(method, path, body, headers = {}) {
    const all = { 'Content-Type': 'application/json', ...extraHeaders, ...headers };
    if (token) all.Authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: all,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { status: response.status, body: json, headers: response.headers };
  }
  return {
    get: (p, h) => request('GET', p, undefined, h),
    post: (p, b, h) => request('POST', p, b ?? {}, h),
    patch: (p, b, h) => request('PATCH', p, b ?? {}, h),
    delete: (p, b, h) => request('DELETE', p, b, h),
    raw: (method, path, { body, headers = {} } = {}) =>
      fetch(`${baseUrl}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body, redirect: 'manual' }),
  };
}

export { mongoose };

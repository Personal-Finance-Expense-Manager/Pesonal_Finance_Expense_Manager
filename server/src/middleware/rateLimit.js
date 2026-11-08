import crypto from 'node:crypto';
import { recordAudit } from '../services/auditService.js';

/**
 * Rate limiting - US-28 (#67), SEC-7.
 *
 *   global limiter  100 requests / minute / client IP
 *   auth limiter     10 requests / minute / account, on sign-in, registration,
 *                    verification and password reset
 *
 * The client IP is `req.ip`. Express only reads X-Forwarded-For when TRUST_PROXY
 * names the number of proxy hops to believe (config/security.js), so a client
 * cannot choose its own address by sending a header.
 *
 * The counters live in process memory. That is correct for one API instance;
 * behind several instances give createRateLimiter a shared `store` (Redis) with
 * the same hit() contract. This limitation is documented in docs/SECURITY.md.
 */

export class MemoryStore {
  constructor(windowMs) {
    this.windowMs = windowMs;
    this.hits = new Map();
    this.sweeper = setInterval(() => this.sweep(), Math.max(windowMs, 30_000));
    this.sweeper.unref?.();
  }

  hit(key, now = Date.now()) {
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    return { count: entry.count, resetAt: entry.resetAt };
  }

  sweep(now = Date.now()) {
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }

  reset() {
    this.hits.clear();
  }
}

export function createRateLimiter({ name, windowMs = 60_000, max, keyFor, store = new MemoryStore(windowMs), skip }) {
  const limiter = async function rateLimiter(req, res, next) {
    try {
      if (skip?.(req)) return next();

      const key = `${name}:${keyFor(req)}`;
      const { count, resetAt } = await store.hit(key);
      const remaining = Math.max(0, max - count);

      res.setHeader('RateLimit-Limit', String(max));
      res.setHeader('RateLimit-Remaining', String(remaining));
      res.setHeader('RateLimit-Reset', String(Math.ceil((resetAt - Date.now()) / 1000)));

      if (count <= max) return next();

      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfter));

      // One audit record per offender per window, not one per rejected request.
      if (count === max + 1) {
        void recordAudit({
          category: 'security',
          outcome: 'denied',
          action: 'rate_limit.exceeded',
          ip: req.ip,
          metadata: { limiter: name, path: (req.originalUrl || '').split('?')[0].slice(0, 120) },
        });
      }

      return res.status(429).json({
        message: 'Too many requests. Please wait a moment and try again.',
        retryAfterSeconds: retryAfter,
      });
    } catch (error) {
      // A broken limiter must not take the API down; it fails open and says so.
      console.error('[rate-limit] store error:', error.message);
      return next();
    }
  };
  limiter.store = store;
  return limiter;
}

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);

/**
 * The "account" an authentication request is about: the email in the body, or
 * (for the password-reset confirmation, which has no email) a digest of the
 * reset token, or failing both the client IP. Identifying values are hashed so
 * the in-memory table never holds an address in the clear.
 */
export function accountKey(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
  if (email) return `acct:${digest(email)}`;
  const token = typeof body.token === 'string' ? body.token.slice(0, 512) : '';
  if (token) return `tok:${digest(token)}`;
  return `ip:${req.ip}`;
}

export function rateLimitingEnabled() {
  if (process.env.RATE_LIMIT_ENABLED === 'false') return false;
  // The existing integration suites fire hundreds of requests a minute from
  // one address; they opt in explicitly when they are testing the limiter.
  if (process.env.NODE_ENV === 'test') return process.env.RATE_LIMIT_IN_TEST === 'true';
  return true;
}

const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

export function buildGlobalLimiter() {
  return createRateLimiter({
    name: 'global',
    max: numberFromEnv('RATE_LIMIT_GLOBAL_PER_MINUTE', 100),
    keyFor: (req) => `ip:${req.ip}`,
    skip: (req) => !rateLimitingEnabled() || (req.originalUrl || '').split('?')[0] === '/api/health',
  });
}

export function buildAuthLimiter() {
  return createRateLimiter({
    name: 'auth',
    max: numberFromEnv('RATE_LIMIT_AUTH_PER_MINUTE', 10),
    keyFor: accountKey,
    skip: () => !rateLimitingEnabled(),
  });
}

/**
 * Central security configuration - US-28 (#67), SRS SEC-1, SEC-2, SEC-8, SEC-12.
 *
 * Every security-relevant setting is read here, from the environment, so there
 * is one place to review and no secret or limit is scattered through the code.
 * Nothing in this file is a secret: keys and signing secrets are only ever read
 * from environment variables (or a secret manager that populates them).
 */

export const BCRYPT_MIN_ROUNDS = 12; // SEC-2
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // SEC-4: 24-hour JWT
export const SESSION_IDLE_MAX_MINUTES = 30; // SEC-8
export const SIGNED_URL_MAX_SECONDS = 15 * 60; // SEC-10
export const HSTS_MAX_AGE_SECONDS = 365 * 24 * 60 * 60; // SEC-1: one year
export const AUDIT_MIN_RETENTION_DAYS = 365; // REQ-96: 12 months
export const BACKUP_RETENTION_DAYS_DEFAULT = 7; // REQ-97

export function isProduction() {
  return process.env.NODE_ENV === 'production';
}

export function isTestEnv() {
  return process.env.NODE_ENV === 'test';
}

/** bcrypt cost factor. Never below 12, whatever the environment says (SEC-2). */
export function bcryptRounds() {
  const configured = Number(process.env.BCRYPT_ROUNDS);
  if (Number.isInteger(configured) && configured >= BCRYPT_MIN_ROUNDS && configured <= 15) {
    return configured;
  }
  return BCRYPT_MIN_ROUNDS;
}

/** Inactivity limit for a signed-in session. Can be lowered, never raised above 30 minutes (SEC-8). */
export function sessionIdleMs() {
  const configured = Number(process.env.SESSION_IDLE_TIMEOUT_MINUTES);
  const minutes =
    Number.isFinite(configured) && configured > 0
      ? Math.min(configured, SESSION_IDLE_MAX_MINUTES)
      : SESSION_IDLE_MAX_MINUTES;
  return minutes * 60 * 1000;
}

/** How long audit records are kept. Never below 12 months (REQ-96). */
export function auditRetentionDays() {
  const configured = Number(process.env.AUDIT_RETENTION_DAYS);
  return Number.isFinite(configured) && configured >= AUDIT_MIN_RETENTION_DAYS
    ? Math.floor(configured)
    : AUDIT_MIN_RETENTION_DAYS;
}

/**
 * How many reverse-proxy hops to trust for the client IP (SEC-7).
 * Unset means none: req.ip is the TCP peer and X-Forwarded-For is ignored, so a
 * client cannot choose its own address to dodge rate limits or forge audit IPs.
 */
export function trustProxySetting() {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined || raw === '' || raw === 'false') return false;
  const hops = Number(raw);
  if (Number.isInteger(hops) && hops >= 1 && hops <= 5) return hops;
  throw new Error('TRUST_PROXY must be a whole number of proxy hops between 1 and 5 (or unset).');
}

/** Allowed browser origins (CORS and the Origin guard). Comma-separated CLIENT_ORIGIN. */
export function allowedOrigins() {
  return (process.env.CLIENT_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export function httpsRequired() {
  if (process.env.FORCE_HTTPS === 'true') return true;
  if (process.env.FORCE_HTTPS === 'false') return false;
  return isProduction();
}

const PLACEHOLDER = /change[-_ ]?me|replace[-_ ]?me|your[-_ ]|example|placeholder|xxxx|secret$/i;

function weakSecret(value) {
  return !value || value.length < 32 || PLACEHOLDER.test(value) || /^(.)\1+$/.test(value);
}

/**
 * Check the environment and return a list of problems (SEC-12).
 * `strict` (production) turns the important ones into start-up failures.
 */
export function environmentProblems(env = process.env) {
  const problems = [];
  const production = env.NODE_ENV === 'production';

  const need = (name, check, message) => {
    if (!check(env[name])) problems.push(`${name}: ${message}`);
  };

  need('MONGO_URI', Boolean, 'is required.');
  need('JWT_SECRET', (v) => !weakSecret(v), 'must be a random value of at least 32 characters.');
  need('EMAIL_VERIFICATION_SECRET', (v) => !weakSecret(v), 'must be a random value of at least 32 characters.');
  need('ENCRYPTION_KEY', (v) => Boolean(v), 'is required (32 random bytes as 64 hex characters or base64).');

  if (production) {
    need('BLIND_INDEX_KEY', Boolean, 'is required in production (32 random bytes). It must never change.');
    need('CLIENT_ORIGIN', (v) => Boolean(v) && !v.includes('*'), 'must list the exact client origin(s); "*" is not allowed.');
    need('CLIENT_ORIGIN', (v) => !v || v.split(',').every((o) => o.trim().startsWith('https://')), 'must use https:// in production.');

    if (env.DEV_AUTH_HEADER === 'true') problems.push('DEV_AUTH_HEADER: must not be enabled in production.');
    if (env.DEV_EMAIL_CONSOLE === 'true') problems.push('DEV_EMAIL_CONSOLE: must not be enabled in production.');

    if (env.FORCE_HTTPS !== 'false' && !env.TRUST_PROXY) {
      problems.push(
        'TRUST_PROXY: set the number of reverse-proxy hops (usually 1) so HTTPS can be detected, or set FORCE_HTTPS=false only if TLS is enforced elsewhere.'
      );
    }

    if (env.BACKUP_ENABLED !== 'false') {
      need('BACKUP_ENCRYPTION_KEY', Boolean, 'is required while backups are enabled.');
      if (env.BACKUP_ENCRYPTION_KEY && env.BACKUP_ENCRYPTION_KEY === env.ENCRYPTION_KEY) {
        problems.push('BACKUP_ENCRYPTION_KEY: must differ from ENCRYPTION_KEY.');
      }
    }
    if (!env.ATTACHMENT_URL_SECRET) problems.push('ATTACHMENT_URL_SECRET: set a value separate from JWT_SECRET.');
    if (!env.APP_LOCK_SECRET) problems.push('APP_LOCK_SECRET: set a value separate from JWT_SECRET.');
  }

  return problems;
}

/** Called once at start-up. Production refuses to start with an unsafe configuration. */
export function assertEnvironment(env = process.env, log = console) {
  const problems = environmentProblems(env);

  if (!problems.length) return;

  if (env.NODE_ENV === 'production') {
    for (const problem of problems) log.error(`[config] ${problem}`);
    throw new Error('Unsafe or incomplete configuration for production. See the messages above.');
  }

  for (const problem of problems) log.warn(`[config] ${problem}`);
}

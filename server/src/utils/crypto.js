import crypto from 'node:crypto';

/**
 * Application-level encryption at rest - US-28 (#67), SRS SEC-3.
 *
 * AES-256-GCM (authenticated: a changed byte fails decryption instead of
 * yielding garbage). Keys come only from the environment:
 *
 *   ENCRYPTION_KEY            current key, 32 random bytes (64 hex chars or base64)
 *   ENCRYPTION_KEY_ID         label stored with each value (default "1")
 *   ENCRYPTION_KEYS_PREVIOUS  "id:key,id:key" - old keys, decrypt-only, for rotation
 *   BLIND_INDEX_KEY           keys the HMAC used to look up encrypted fields (email)
 *
 * Text values are stored as   enc:v1:<keyId>:<iv>:<tag>:<ciphertext>   (base64url).
 * Files are stored as         "PFEMENC1" | keyIdLength | keyId | iv | tag | ciphertext.
 *
 * A fresh random 96-bit IV is used for every encryption. A value that does not
 * carry the prefix is treated as legacy plaintext and returned unchanged, so
 * records written before this feature keep working until the migration script
 * (scripts/migrate-encryption.js) has run.
 */

const TEXT_PREFIX = 'enc:v1:';
const FILE_MAGIC = Buffer.from('PFEMENC1');
const AAD = Buffer.from('pfem:v1');

export class DecryptionError extends Error {
  constructor(message = 'Stored data could not be decrypted.') {
    super(message);
    this.name = 'DecryptionError';
  }
}

export function parseKey(raw, name) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const value = raw.trim();
  const buffer = /^[0-9a-fA-F]{64}$/.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');

  if (buffer.length !== 32) {
    throw new Error(`${name} must be exactly 32 bytes (64 hex characters, or base64 of 32 bytes).`);
  }
  return buffer;
}

let cache = { signature: null, ring: null };
let ephemeral = null;

function signature(env) {
  return [env.ENCRYPTION_KEY, env.ENCRYPTION_KEY_ID, env.ENCRYPTION_KEYS_PREVIOUS, env.BLIND_INDEX_KEY, env.NODE_ENV, env.NODE_TEST_CONTEXT].join('|');
}

/** Build (and cache) the key ring from the environment. */
export function keyRing(env = process.env) {
  const sig = signature(env);
  if (cache.signature === sig && cache.ring) return cache.ring;

  let current = parseKey(env.ENCRYPTION_KEY, 'ENCRYPTION_KEY');

  if (!current) {
    if (env.NODE_ENV === 'test' || env.NODE_TEST_CONTEXT) {
      // Tests (npm test / node --test) need no configuration: a throw-away key that lives only as long as the process.
      ephemeral ??= crypto.randomBytes(32);
      current = ephemeral;
    } else {
      throw new Error(
        'ENCRYPTION_KEY is not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" and put it in server/.env.'
      );
    }
  }

  const currentId = (env.ENCRYPTION_KEY_ID || '1').trim();
  if (!/^[A-Za-z0-9_-]{1,16}$/.test(currentId)) {
    throw new Error('ENCRYPTION_KEY_ID may only contain letters, digits, "-" and "_" (max 16).');
  }

  const keys = new Map([[currentId, current]]);

  for (const entry of String(env.ENCRYPTION_KEYS_PREVIOUS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const at = entry.indexOf(':');
    const id = entry.slice(0, at);
    if (at < 1 || !/^[A-Za-z0-9_-]{1,16}$/.test(id)) {
      throw new Error('ENCRYPTION_KEYS_PREVIOUS must look like "id:key,id:key".');
    }
    keys.set(id, parseKey(entry.slice(at + 1), `ENCRYPTION_KEYS_PREVIOUS (${id})`));
  }

  const blind =
    parseKey(env.BLIND_INDEX_KEY, 'BLIND_INDEX_KEY') ??
    Buffer.from(crypto.hkdfSync('sha256', current, Buffer.alloc(0), 'pfem-blind-index-v1', 32));

  const ring = { currentId, current, keys, blind };
  cache = { signature: sig, ring };
  return ring;
}

export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(TEXT_PREFIX);
}

const b64 = (buffer) => buffer.toString('base64url');

/** Encrypt text. null, undefined and the empty string are returned as they are. */
export function encryptString(plain) {
  if (plain === null || plain === undefined || plain === '') return plain;

  const { currentId, current } = keyRing();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', current, iv);
  cipher.setAAD(AAD);
  const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);

  return `${TEXT_PREFIX}${currentId}:${b64(iv)}:${b64(cipher.getAuthTag())}:${b64(body)}`;
}

/** Decrypt text. Legacy plaintext (no prefix) passes through. Tampering throws DecryptionError. */
export function decryptString(value) {
  if (!isEncrypted(value)) return value;

  const parts = value.slice(TEXT_PREFIX.length).split(':');
  if (parts.length !== 4) throw new DecryptionError();

  const [keyId, iv, tag, body] = parts;
  const key = keyRing().keys.get(keyId);
  if (!key) throw new DecryptionError(`No key is configured for key id "${keyId}".`);

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new DecryptionError();
  }
}

export function isEncryptedFile(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > FILE_MAGIC.length && buffer.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC);
}

/** Encrypt file bytes. `context` (the object key) is authenticated, so a file cannot be swapped for another. */
export function encryptBuffer(buffer, context = '') {
  const { currentId, current } = keyRing();
  const id = Buffer.from(currentId, 'utf8');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', current, iv);
  cipher.setAAD(Buffer.concat([AAD, Buffer.from(String(context))]));
  const body = Buffer.concat([cipher.update(buffer), cipher.final()]);

  return Buffer.concat([FILE_MAGIC, Buffer.from([id.length]), id, iv, cipher.getAuthTag(), body]);
}

/** Decrypt file bytes. Legacy unencrypted files are returned unchanged. */
export function decryptBuffer(buffer, context = '') {
  if (!isEncryptedFile(buffer)) return buffer;

  try {
    let at = FILE_MAGIC.length;
    const idLength = buffer[at];
    at += 1;
    const keyId = buffer.subarray(at, at + idLength).toString('utf8');
    at += idLength;
    const iv = buffer.subarray(at, at + 12);
    at += 12;
    const tag = buffer.subarray(at, at + 16);
    at += 16;

    const key = keyRing().keys.get(keyId);
    if (!key) throw new DecryptionError(`No key is configured for key id "${keyId}".`);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.concat([AAD, Buffer.from(String(context))]));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(buffer.subarray(at)), decipher.final()]);
  } catch (error) {
    throw error instanceof DecryptionError ? error : new DecryptionError();
  }
}

/**
 * Keyed, deterministic digest of a normalised value, used to look up and
 * de-duplicate encrypted fields (the email address) without decrypting them.
 */
export function blindIndex(value) {
  return crypto
    .createHmac('sha256', keyRing().blind)
    .update(String(value).trim().toLowerCase())
    .digest('hex');
}

/** Test helper: forget the cached key ring. */
export function resetKeyRingCache() {
  cache = { signature: null, ring: null };
}

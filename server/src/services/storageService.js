import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptBuffer, encryptBuffer } from '../utils/crypto.js';

/**
 * Receipt file storage - US-23 (#57), SRS REQ-79 and REQ-81.
 *
 * Files are written to a directory on the API server's disk, outside anything
 * the web server serves, under a random name (the object_key stored on the
 * Attachment record). The client never sees the path: a file is only ever
 * returned through a short-lived signed URL (signedUrl.js).
 *
 * US-28 (SEC-3): the bytes are encrypted with AES-256-GCM before they touch the
 * disk, bound to the object key so a file cannot be swapped for another. Files
 * stored before encryption existed are still readable and are encrypted by
 * scripts/migrate-encryption.js.
 *
 * UPLOAD_DIR sets the directory; the default is server/uploads, which
 * .gitignore already excludes. Swapping this module for S3 or similar later
 * only needs the same three functions.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.resolve(here, '../../uploads');

// Only names this module generated are ever accepted, so a stored key can
// never be turned into a path outside the upload directory.
const OBJECT_KEY = /^[a-f\d]{32}\.(jpg|png|pdf)$/;

export function uploadDir() {
  return path.resolve(process.env.UPLOAD_DIR || DEFAULT_DIR);
}

export function isValidObjectKey(key) {
  return typeof key === 'string' && OBJECT_KEY.test(key);
}

function pathFor(key) {
  if (!isValidObjectKey(key)) {
    throw new Error('Invalid object key.');
  }
  return path.join(uploadDir(), key);
}

/** Store the bytes under a new random key and return the key. */
export async function saveObject(buffer, extension) {
  const key = `${crypto.randomBytes(16).toString('hex')}.${extension}`;
  await fs.mkdir(uploadDir(), { recursive: true });
  // "wx" fails rather than overwrite, should two keys ever collide.
  await fs.writeFile(pathFor(key), encryptBuffer(buffer, key), { flag: 'wx', mode: 0o600 });
  return key;
}

/** Absolute path of a stored object (used by the migration and backup tooling). */
export function objectPath(key) {
  return pathFor(key);
}

/** The decrypted bytes of a stored object. Throws ENOENT if it is gone. */
export async function readObject(key) {
  return decryptBuffer(await fs.readFile(pathFor(key)), key);
}

/**
 * Delete a stored object. A file that is already gone, or a key this module
 * never issued (records created before uploads existed), is not an error.
 */
export async function deleteObject(key) {
  if (!isValidObjectKey(key)) return false;

  try {
    await fs.unlink(pathFor(key));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

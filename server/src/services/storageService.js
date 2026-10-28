import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Receipt file storage - US-23 (#57), SRS REQ-79 and REQ-81.
 *
 * Files are written to a directory on the API server's disk, outside anything
 * the web server serves, under a random name (the object_key stored on the
 * Attachment record). The client never sees the path: a file is only ever
 * returned through a short-lived signed URL (signedUrl.js).
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
  await fs.writeFile(pathFor(key), buffer, { flag: 'wx' });
  return key;
}

/** Absolute path of a stored object, for res.sendFile. */
export function objectPath(key) {
  return pathFor(key);
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

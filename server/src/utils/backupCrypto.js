import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { parseKey } from './crypto.js';

/**
 * Authenticated, streaming encryption for backup files - US-26 (#62), REQ-97.
 *
 * A backup can be far larger than memory, and a single AES-GCM message must be
 * decrypted whole before any of it can be trusted. So the file is a series of
 * independently authenticated chunks:
 *
 *   "PFEMBK01" | salt(16) | nonceBase(8)
 *   then, repeated:  uint32 header | ciphertext | tag(16)
 *
 *   header = plaintext length, with the top bit set on the LAST chunk.
 *
 * - The AES-256 key is derived (HKDF-SHA256) from BACKUP_ENCRYPTION_KEY and a
 *   random per-file salt, so no two files share a key.
 * - Each chunk's 96-bit IV is nonceBase || chunkIndex, so an IV is never reused.
 * - The chunk index, the final-chunk flag and the file header are authenticated
 *   (AAD). Reordering, removing, repeating or truncating chunks fails to decrypt.
 * - A file that ends without a final chunk is reported as truncated.
 */

const MAGIC = Buffer.from('PFEMBK01');
const CHUNK_SIZE = 1024 * 1024;
const TAG_LENGTH = 16;
const FINAL_FLAG = 0x80000000;
const HEADER_LENGTH = MAGIC.length + 16 + 8;

export class BackupCryptoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackupCryptoError';
  }
}

export function backupKey(env = process.env) {
  const key = parseKey(env.BACKUP_ENCRYPTION_KEY, 'BACKUP_ENCRYPTION_KEY');
  if (!key) throw new BackupCryptoError('BACKUP_ENCRYPTION_KEY is not set.');
  return key;
}

function chunkKey(master, salt) {
  return Buffer.from(crypto.hkdfSync('sha256', master, salt, 'pfem-backup-v1', 32));
}

function chunkIv(nonceBase, index) {
  const iv = Buffer.alloc(12);
  nonceBase.copy(iv, 0);
  iv.writeUInt32BE(index >>> 0, 8);
  return iv;
}

function chunkAad(header, index, final) {
  const aad = Buffer.alloc(header.length + 5);
  header.copy(aad, 0);
  aad.writeUInt32BE(index >>> 0, header.length);
  aad[header.length + 4] = final ? 1 : 0;
  return aad;
}

export function createEncryptStream(master = backupKey()) {
  const salt = crypto.randomBytes(16);
  const nonceBase = crypto.randomBytes(8);
  const header = Buffer.concat([MAGIC, salt, nonceBase]);
  const key = chunkKey(master, salt);

  let pending = Buffer.alloc(0);
  let index = 0;
  let headerSent = false;

  const seal = (plain, final) => {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, chunkIv(nonceBase, index));
    cipher.setAAD(chunkAad(header, index, final));
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE((plain.length | (final ? FINAL_FLAG : 0)) >>> 0, 0);
    index += 1;
    return Buffer.concat([length, body, cipher.getAuthTag()]);
  };

  return new Transform({
    transform(data, _encoding, callback) {
      try {
        if (!headerSent) {
          this.push(header);
          headerSent = true;
        }
        pending = pending.length ? Buffer.concat([pending, data]) : data;

        // Keep the last chunk back: only at the end do we know which one is final.
        while (pending.length > CHUNK_SIZE) {
          this.push(seal(pending.subarray(0, CHUNK_SIZE), false));
          pending = pending.subarray(CHUNK_SIZE);
        }
        callback();
      } catch (error) {
        callback(error);
      }
    },
    flush(callback) {
      try {
        if (!headerSent) this.push(header);
        this.push(seal(pending, true));
        callback();
      } catch (error) {
        callback(error);
      }
    },
  });
}

export function createDecryptStream(master = backupKey()) {
  let buffer = Buffer.alloc(0);
  let header = null;
  let key = null;
  let nonceBase = null;
  let index = 0;
  let sawFinal = false;

  const fail = (message) => new BackupCryptoError(message);

  return new Transform({
    transform(data, _encoding, callback) {
      try {
        buffer = buffer.length ? Buffer.concat([buffer, data]) : data;

        if (!header) {
          if (buffer.length < HEADER_LENGTH) return callback();
          header = buffer.subarray(0, HEADER_LENGTH);
          if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw fail('This is not a PFEM backup file.');
          key = chunkKey(master, header.subarray(MAGIC.length, MAGIC.length + 16));
          nonceBase = header.subarray(MAGIC.length + 16, HEADER_LENGTH);
          buffer = buffer.subarray(HEADER_LENGTH);
        }

        for (;;) {
          if (sawFinal && buffer.length) throw fail('Unexpected data after the final chunk.');
          if (buffer.length < 4) break;

          const field = buffer.readUInt32BE(0);
          const final = (field & FINAL_FLAG) !== 0;
          const length = (field & ~FINAL_FLAG) >>> 0;
          if (length > CHUNK_SIZE) throw fail('A chunk is larger than allowed.');
          if (buffer.length < 4 + length + TAG_LENGTH) break;

          const body = buffer.subarray(4, 4 + length);
          const tag = buffer.subarray(4 + length, 4 + length + TAG_LENGTH);

          let plain;
          try {
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, chunkIv(nonceBase, index));
            decipher.setAAD(chunkAad(header, index, final));
            decipher.setAuthTag(tag);
            plain = Buffer.concat([decipher.update(body), decipher.final()]);
          } catch {
            throw fail('The backup is corrupt, was modified, or the key is wrong.');
          }

          this.push(plain);
          index += 1;
          buffer = buffer.subarray(4 + length + TAG_LENGTH);
          if (final) sawFinal = true;
        }
        callback();
      } catch (error) {
        callback(error);
      }
    },
    flush(callback) {
      if (!header || !sawFinal || buffer.length) return callback(fail('The backup is truncated.'));
      return callback();
    },
  });
}

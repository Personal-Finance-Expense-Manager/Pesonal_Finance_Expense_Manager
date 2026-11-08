import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import { blindIndex, encryptBuffer, encryptString, isEncrypted, isEncryptedFile } from '../utils/crypto.js';
import { isValidObjectKey, objectPath } from './storageService.js';

/**
 * Encrypt records written before US-28 SEC-3 existed.
 *
 * Idempotent and safe to re-run: a value that already carries the "enc:v1:"
 * prefix, or a file that already starts with the PFEMENC1 header, is skipped.
 * It writes through the raw MongoDB collection (not the Mongoose models), so
 * nothing is encrypted twice and no validators or hooks run on old data.
 *
 *   npm run migrate:encryption -- --dry-run     count what would change
 *   npm run migrate:encryption                  do it
 *
 * Take a backup first (docs/BACKUP_AND_RESTORE.md). Encrypted values need the
 * same ENCRYPTION_KEY (and BLIND_INDEX_KEY) from then on.
 */
const TARGETS = [
  { collection: 'users', fields: ['name', 'email', 'mobile_number'], blind: { email: 'email_hash' } },
  { collection: 'transactions', fields: ['note'] },
  { collection: 'transfers', fields: ['note'] },
  { collection: 'recurringrules', fields: ['note'] },
  { collection: 'attachments', fields: ['file_name'] },
];

export async function migrateEncryption({ dryRun = false, db = mongoose.connection.db, log = () => {} } = {}) {
  const report = { dryRun, collections: {}, files: { encrypted: 0, already: 0, missing: 0 } };

  for (const { collection, fields, blind = {} } of TARGETS) {
    const result = { scanned: 0, updated: 0, fieldsEncrypted: 0 };
    report.collections[collection] = result;

    const exists = await db.listCollections({ name: collection }).hasNext();
    if (!exists) continue;

    const cursor = db.collection(collection).find({});
    let operations = [];

    for await (const doc of cursor) {
      result.scanned += 1;
      const $set = {};

      for (const field of fields) {
        const value = doc[field];
        if (typeof value === 'string' && value !== '' && !isEncrypted(value)) {
          const plain = field in blind ? value.trim().toLowerCase() : value;
          $set[field] = encryptString(plain);
          if (field in blind) $set[blind[field]] = blindIndex(plain);
          result.fieldsEncrypted += 1;
        } else if (field in blind && isEncrypted(value) && !doc[blind[field]]) {
          // Encrypted but never indexed (partially migrated): index it now.
          const { decryptString } = await import('../utils/crypto.js');
          $set[blind[field]] = blindIndex(decryptString(value));
        }
      }

      if (Object.keys($set).length) {
        result.updated += 1;
        if (!dryRun) operations.push({ updateOne: { filter: { _id: doc._id }, update: { $set } } });
      }

      if (operations.length >= 500) {
        await db.collection(collection).bulkWrite(operations, { ordered: false });
        operations = [];
      }
    }
    if (operations.length) await db.collection(collection).bulkWrite(operations, { ordered: false });
    log(`${collection}: ${result.updated} of ${result.scanned} records ${dryRun ? 'would be ' : ''}updated`);
  }

  // Receipt files.
  if (await db.listCollections({ name: 'attachments' }).hasNext()) {
    for await (const doc of db.collection('attachments').find({}, { projection: { object_key: 1 } })) {
      if (!isValidObjectKey(doc.object_key)) continue;
      try {
        const bytes = await fs.readFile(objectPath(doc.object_key));
        if (isEncryptedFile(bytes)) {
          report.files.already += 1;
          continue;
        }
        if (!dryRun) {
          // Write beside, then rename: a crash never leaves a half-written receipt.
          const target = objectPath(doc.object_key);
          await fs.writeFile(`${target}.tmp`, encryptBuffer(bytes, doc.object_key), { mode: 0o600 });
          await fs.rename(`${target}.tmp`, target);
        }
        report.files.encrypted += 1;
      } catch (error) {
        if (error.code === 'ENOENT') report.files.missing += 1;
        else throw error;
      }
    }
    log(`files: ${report.files.encrypted} ${dryRun ? 'would be ' : ''}encrypted, ${report.files.already} already encrypted, ${report.files.missing} missing`);
  }

  return report;
}

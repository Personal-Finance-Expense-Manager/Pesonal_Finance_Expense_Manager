import { blindIndex, decryptString, encryptString, isEncrypted } from '../../utils/crypto.js';

/**
 * Transparent field-level encryption - US-28 (#67), SRS SEC-3.
 *
 *   schema.plugin(fieldEncryption, {
 *     fields: ['name', 'email'],
 *     blindIndex: { email: 'email_hash' },
 *   });
 *
 * - Assigning to an encrypted path stores AES-256-GCM ciphertext; reading the
 *   path from a document returns the plaintext. Existing code that does
 *   `user.email` or `transaction.note` is unchanged.
 * - toJSON()/toObject() decrypt, and so do `.lean()` and aggregation results,
 *   so no route can leak ciphertext by accident.
 * - A "blind index" path holds a keyed HMAC of the normalised plaintext, which
 *   is how an encrypted email is looked up and kept unique. Queries that filter
 *   on the encrypted path (`{ email: 'a@b.c' }`) are rewritten to use it. The
 *   rewrite also matches a not-yet-migrated plaintext record, so deploying
 *   before running the migration script does not lock anyone out.
 * - Free-text search over an encrypted path is impossible in the database by
 *   design; callers that need it filter after decrypting (see routes/transactions.js).
 */

const QUERY_HOOKS = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'countDocuments',
];

const isQuery = (value) => Boolean(value) && typeof value.getFilter === 'function';

function readable(value) {
  try {
    return decryptString(value);
  } catch {
    // One damaged value must not take a whole list down with it.
    return null;
  }
}

function decryptRow(row, fields) {
  if (!row || typeof row !== 'object') return row;
  for (const field of fields) {
    if (isEncrypted(row[field])) row[field] = readable(row[field]);
  }
  return row;
}

export default function fieldEncryption(schema, { fields = [], blindIndex: indexes = {} } = {}) {
  for (const path of fields) {
    const type = schema.path(path);
    if (!type) throw new Error(`fieldEncryption: unknown path "${path}".`);

    // The ciphertext is longer than the text, so a maxlength rule written for
    // the text must be applied to the decrypted value instead.
    const max = type.options?.maxlength;
    if (max) {
      type.validators = type.validators.filter((v) => v.type !== 'maxlength');
      type.validate({
        validator: (value) => {
          const plain = readable(value);
          return plain == null || plain.length <= max;
        },
        message: `Path \`${path}\` is longer than the maximum allowed length (${max}).`,
      });
    }

    // Mongoose runs setters last-to-first; index 0 therefore runs after trim and
    // lowercase have tidied the value, which is when it must be encrypted.
    type.setters.unshift(function encrypt(value) {
      // Query filters and updates are handled in the hooks below, before casting.
      if (isQuery(this)) return value;
      return typeof value === 'string' ? encryptString(value) : value;
    });

    type.get((value) => (typeof value === 'string' ? readable(value) : value));
  }

  // Hash the email whenever it is set on a document.
  schema.pre('validate', function setBlindIndexes() {
    for (const [path, indexPath] of Object.entries(indexes)) {
      if (this.isNew || this.isModified(path) || !this.get(indexPath)) {
        const plain = this.get(path);
        if (plain) this.set(indexPath, blindIndex(plain));
      }
    }
  });

  const decryptTransform = (existing) => (doc, ret, options) => {
    const base = typeof existing === 'function' ? existing(doc, ret, options) ?? ret : ret;
    return decryptRow(base, fields);
  };

  for (const option of ['toJSON', 'toObject']) {
    const current = schema.get(option) || {};
    schema.set(option, { ...current, transform: decryptTransform(current.transform) });
  }

  // Filters and updates, before Mongoose casts them.
  schema.pre(QUERY_HOOKS, function rewriteQuery() {
    const filter = this.getFilter?.();

    if (filter) {
      for (const [path, indexPath] of Object.entries(indexes)) {
        if (!(path in filter)) continue;

        const wanted = filter[path];
        const values =
          typeof wanted === 'string'
            ? [wanted]
            : Array.isArray(wanted?.$in) && wanted.$in.every((v) => typeof v === 'string')
              ? wanted.$in
              : null;

        if (!values) throw new Error(`"${path}" is encrypted: only equality and $in lookups are supported.`);

        const clause = {
          $or: [
            { [indexPath]: values.length === 1 ? blindIndex(values[0]) : { $in: values.map(blindIndex) } },
            { [path]: values.length === 1 ? values[0].trim().toLowerCase() : { $in: values.map((v) => v.trim().toLowerCase()) } },
          ],
        };

        delete filter[path];
        filter.$and = [...(filter.$and || []), clause];
      }

      for (const path of fields) {
        if (path in filter && !(path in indexes)) {
          throw new Error(`"${path}" is encrypted and cannot be used in a database filter.`);
        }
      }
    }

    const update = this.getUpdate?.();
    if (update && typeof update === 'object' && !Array.isArray(update)) {
      const targets = [update, update.$set, update.$setOnInsert].filter(Boolean);

      for (const target of targets) {
        for (const path of fields) {
          if (typeof target[path] !== 'string') continue;
          const plain = path in indexes ? target[path].trim().toLowerCase() : target[path];
          if (path in indexes) target[indexes[path]] = blindIndex(plain);
          target[path] = encryptString(plain);
        }
      }
    }
  });

  // .lean() results and aggregation output bypass getters; decrypt them here.
  schema.post(['find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete'], function decryptLean(result) {
    if (!result || !this.mongooseOptions?.().lean) return;
    for (const row of Array.isArray(result) ? result : [result]) decryptRow(row, fields);
  });

  schema.post('aggregate', function decryptAggregate(result) {
    if (!Array.isArray(result)) return;
    for (const row of result) decryptRow(row, fields);
  });
}

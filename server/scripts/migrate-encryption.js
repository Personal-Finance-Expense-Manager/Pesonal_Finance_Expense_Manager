import 'dotenv/config';
import mongoose from 'mongoose';
import { migrateEncryption } from '../src/services/encryptionMigration.js';
import { keyRing } from '../src/utils/crypto.js';

/** Encrypt existing records (US-28 SEC-3). Usage: npm run migrate:encryption [-- --dry-run] */
const dryRun = process.argv.includes('--dry-run');

keyRing(); // fails with a clear message if ENCRYPTION_KEY is missing
await mongoose.connect(process.env.MONGO_URI);

try {
  console.log(dryRun ? 'DRY RUN - nothing will be written.' : 'Encrypting existing records...');
  const report = await migrateEncryption({ dryRun, log: (line) => console.log(' ', line) });
  console.log(dryRun ? 'Dry run finished.' : 'Done. Re-running is safe: encrypted values are skipped.');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await mongoose.disconnect();
}

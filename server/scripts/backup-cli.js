import 'dotenv/config';
import mongoose from 'mongoose';
import {
  backupDir, cleanupExpiredBackups, createBackup, listBackups, restoreBackup, verifyBackup,
} from '../src/services/backupService.js';

/**
 * Backup tools that work without the API running (disaster recovery) - US-26, REQ-97.
 *
 *   npm run backup -- create
 *   npm run backup -- list
 *   npm run backup -- verify  <id>
 *   npm run backup -- restore <id> --yes     replaces ALL current data
 *   npm run backup -- cleanup
 *
 * Stop the API (or let it run: it enters maintenance mode only inside the same
 * process, so for a CLI restore stop the API first) before restoring.
 */
const [command, id, ...rest] = process.argv.slice(2);
await mongoose.connect(process.env.MONGO_URI);

try {
  if (command === 'create') {
    const info = await createBackup({ trigger: 'manual' });
    console.log(`Created ${info.id} (${info.documents} documents, ${info.consistency}) in ${backupDir()}`);
  } else if (command === 'list') {
    for (const b of await listBackups()) console.log(`${b.id}  ${b.created_at}  ${b.documents} docs  ${b.consistency}  ${b.trigger}`);
  } else if (command === 'verify' && id) {
    console.log(JSON.stringify(await verifyBackup(id), null, 2));
  } else if (command === 'restore' && id) {
    if (![id, ...rest].includes('--yes')) throw new Error('Restoring replaces ALL current data. Add --yes to confirm.');
    console.log(JSON.stringify(await restoreBackup(id), null, 2));
  } else if (command === 'cleanup') {
    console.log('Removed:', await cleanupExpiredBackups());
  } else {
    console.error('Usage: npm run backup -- create | list | verify <id> | restore <id> --yes | cleanup');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

import 'dotenv/config';
import mongoose from 'mongoose';
import FinancialOperation from '../src/models/FinancialOperation.js';
import { reconcileFinancialOperation } from '../src/services/financialOperationService.js';
import { inMaintenanceMode } from '../src/middleware/maintenance.js';

// Never auto-recover a live operation: there is no distributed transaction/lease.
// Operator must stop all API and scheduler processes before applying recovery.
const apply = process.argv.includes('--apply');
if (apply && !process.argv.includes('--all-writers-stopped')) {
  throw new Error('Stop ALL API/scheduler instances, then use --apply --all-writers-stopped. Default is read-only.');
}
if (apply && inMaintenanceMode()) throw new Error('An incomplete backup restore must be recovered before financial reconciliation.');
try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000, autoCreate: false, autoIndex: false });
  const operations = await FinancialOperation.find({});
  console.log(JSON.stringify({ pending_operations: operations.length, apply }));
  for (const operation of operations) {
    console.log(JSON.stringify({ id: String(operation._id), kind: operation.kind, state: operation.state }));
    if (apply) await reconcileFinancialOperation(operation);
  }
} finally { await mongoose.disconnect(); }

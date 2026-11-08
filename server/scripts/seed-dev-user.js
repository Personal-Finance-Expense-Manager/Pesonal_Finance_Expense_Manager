/**
 * Create (or reuse) a verified demo user for local development.
 *
 *   cd server
 *   npm run seed:dev
 *
 * Also adds a few demo expense categories (Food, Transport, ...).
 *
 *   npm run seed:dev -- --fresh
 *
 * --fresh first deletes everything the demo user owns (accounts,
 * transactions, transfers, budgets, alerts, categories) so you can start a
 * test or a demo recording from a clean slate. The user id stays the same.
 *
 * Prints the demo account's email and password. Sign in with them on the web
 * client like any other user; every page authenticates with the session token.
 * Refuses to run with NODE_ENV=production.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Category from '../src/models/Category.js';
import Account from '../src/models/Account.js';
import Transaction from '../src/models/Transaction.js';
import Transfer from '../src/models/Transfer.js';
import Budget from '../src/models/Budget.js';
import Notification from '../src/models/Notification.js';
import { createDefaultCategories } from '../src/services/categoryService.js';
import { CONSENT_PURPOSES, PRIVACY_POLICY_VERSION } from '../src/config/privacy.js';

const DEMO_EMAIL = 'demo@pfem.local';

// The demo user gets the same default categories a real registration creates
// (US-12, REQ-35), so the demo account behaves like a genuine one: income
// categories exist, and the built-in categories are protected by REQ-39.

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to create a demo user in production.');
  process.exit(1);
}

if (!process.env.MONGO_URI) {
  console.error('MONGO_URI is not set. Copy server/.env.example to server/.env first.');
  process.exit(1);
}

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });

  let user = await User.findOne({ email: DEMO_EMAIL });

  if (!user) {
    user = await User.create({
      name: 'Demo User',
      email: DEMO_EMAIL,
      password_hash: await bcrypt.hash('Demo@12345', 12),
      email_verified: true,
      terms_accepted_at: new Date(),
      privacy_policy_accepted_at: new Date(),
      // US-28 SEC-13: recorded like a real registration, so the demo account
      // behaves like a genuine one on the Privacy page.
      consent: {
        personal_data_processing: true,
        policy_version: PRIVACY_POLICY_VERSION,
        purposes: CONSENT_PURPOSES,
        given_at: new Date(),
        given_ip: null,
        withdrawn_at: null,
      },
    });
    console.log('Created demo user.');
  } else {
    console.log('Demo user already exists.');
  }

  if (process.argv.includes('--fresh')) {
    const mine = { user_id: user._id };
    const results = await Promise.all([
      Transaction.deleteMany(mine),
      Transfer.deleteMany(mine),
      Budget.deleteMany(mine),
      Notification.deleteMany(mine),
      Account.deleteMany(mine),
      Category.deleteMany(mine),
    ]);
    const removed = results.reduce((n, r) => n + r.deletedCount, 0);
    console.log(`Fresh start: removed ${removed} demo records (accounts, transactions, budgets, ...).`);
  }

  const added = await createDefaultCategories(user._id);
  if (added) console.log(`Added ${added} default categories (REQ-35).`);

  console.log('');
  console.log(`  email:    ${DEMO_EMAIL}`);
  console.log('  password: Demo@12345');
  console.log('');
  console.log('Sign in with these on the web client (http://localhost:5173).');
} catch (error) {
  console.error(`Could not create the demo user: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

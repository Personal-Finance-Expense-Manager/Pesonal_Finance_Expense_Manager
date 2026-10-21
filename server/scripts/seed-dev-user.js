/**
 * Create (or reuse) a verified demo user for local development.
 *
 *   cd server
 *   npm run seed:dev
 *
 * Also adds a few demo expense categories (Food, Transport, ...).
 *
 * Prints the user's id. Paste it into the "Demo user id" box on the
 * Accounts or Budgets page while sign-in (US-04) is not merged yet.
 * Refuses to run with NODE_ENV=production.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Category from '../src/models/Category.js';

const DEMO_EMAIL = 'demo@pfem.local';

// Demo expense categories so budgets (US-14) can be tried before the
// categories story (US-12) is merged. Created for the demo user only.
const DEMO_CATEGORIES = ['Food', 'Transport', 'Shopping', 'Bills', 'Entertainment'];

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
    });
    console.log('Created demo user.');
  } else {
    console.log('Demo user already exists.');
  }

  let added = 0;
  for (const name of DEMO_CATEGORIES) {
    const exists = await Category.findOne({ user_id: user._id, type: 'expense', name });
    if (!exists) {
      await Category.create({ user_id: user._id, type: 'expense', name });
      added += 1;
    }
  }
  if (added) console.log(`Added ${added} demo expense categories.`);

  console.log('');
  console.log(`  email:    ${DEMO_EMAIL}`);
  console.log('  password: Demo@12345');
  console.log(`  user id:  ${user._id.toString()}`);
  console.log('');
  console.log('Copy the user id into the Accounts or Budgets page.');
} catch (error) {
  console.error(`Could not create the demo user: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

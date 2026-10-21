/**
 * Create (or reuse) a verified demo user for local development.
 *
 *   cd server
 *   npm run seed:dev
 *
 * Prints the user's id. Paste it into the "Demo user id" box on the
 * Accounts page (http://localhost:5173/#/accounts) while sign-in (US-04)
 * is not merged yet. Refuses to run with NODE_ENV=production.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../src/models/User.js';

const DEMO_EMAIL = 'demo@pfem.local';

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

  console.log('');
  console.log(`  email:    ${DEMO_EMAIL}`);
  console.log('  password: Demo@12345');
  console.log(`  user id:  ${user._id.toString()}`);
  console.log('');
  console.log('Copy the user id into the Accounts page.');
} catch (error) {
  console.error(`Could not create the demo user: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import { recordAuditStrict } from '../src/services/auditService.js';

/**
 * Grant or remove the administrator role (US-26, REQ-94). There is deliberately
 * no API for this: the first administrator is made by someone with access to the
 * server, and the change is written to the audit trail.
 *
 *   npm run admin:promote -- someone@example.com
 *   npm run admin:promote -- someone@example.com --demote
 */
const [email, ...flags] = process.argv.slice(2);
const demote = flags.includes('--demote');

if (!email || email.startsWith('--')) {
  console.error('Usage: npm run admin:promote -- <email> [--demote]');
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI);
try {
  const user = await User.findOne({ email });
  if (!user) throw new Error('No account has that email address.');
  if (user.status !== 'active' || !user.email_verified) throw new Error('The account must be active and email-verified.');

  user.role = demote ? 'user' : 'admin';
  await recordAuditStrict({
    userId: null, actorRole: null, targetUserId: user._id, category: 'admin',
    action: demote ? 'admin.role_removed' : 'admin.role_granted', entityType: 'user', entityId: user._id,
    metadata: { via: 'server_cli' },
  });
  await user.save();
  console.log(`${demote ? 'Removed the administrator role from' : 'Made administrator:'} ${user.name}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

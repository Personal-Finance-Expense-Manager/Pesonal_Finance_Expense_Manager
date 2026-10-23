import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import validator from 'validator';
import User from '../models/User.js';
import { createDefaultCategories } from '../services/categoryService.js';
import Session from '../models/Session.js';
import authenticate from '../middleware/authenticate.js';

const router = Router();

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_WINDOW_MS = 60 * 60 * 1000;
const MAX_VERIFICATION_ATTEMPTS = 3;
const MAX_RESENDS_PER_HOUR = 3;

function smtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.EMAIL_FROM
  );
}

/**
 * TEMPORARY, local development only.
 *
 * A student machine has no SMTP server, so registration could not be completed
 * or demonstrated at all. With DEV_EMAIL_CONSOLE=true in server/.env - and only
 * outside production - the verification code is printed to the API console
 * instead of being emailed. Everything else is unchanged: the code is still
 * random, still hashed with EMAIL_VERIFICATION_SECRET, still expires in ten
 * minutes and is still rate limited (REQ-4).
 *
 * Configure real SMTP credentials and remove the flag before any deployment.
 */
function devEmailFallback() {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.DEV_EMAIL_CONSOLE === 'true'
  );
}

function emailServiceConfigured() {
  // The verification secret is required either way: it hashes the code.
  const secretOk = Boolean(
    process.env.EMAIL_VERIFICATION_SECRET &&
    process.env.EMAIL_VERIFICATION_SECRET.length >= 32
  );

  return secretOk && (smtpConfigured() || devEmailFallback());
}

function getVerificationCodeHash(code) {
  return crypto
    .createHmac('sha256', process.env.EMAIL_VERIFICATION_SECRET)
    .update(code)
    .digest('hex');
}

function codesMatch(code, storedHash) {
  if (!storedHash) return false;

  const suppliedHash = Buffer.from(getVerificationCodeHash(code), 'hex');
  const expectedHash = Buffer.from(storedHash, 'hex');

  return (
    suppliedHash.length === expectedHash.length &&
    crypto.timingSafeEqual(suppliedHash, expectedHash)
  );
}

function generateVerificationCode() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

async function sendVerificationEmail(email, code) {
  if (!smtpConfigured() && devEmailFallback()) {
    console.log('');
    console.log('  ------------------------------------------------------------');
    console.log(`  [dev] Verification code for ${email}: ${code}`);
    console.log('  [dev] No SMTP configured, so the code is printed here.');
    console.log('  ------------------------------------------------------------');
    console.log('');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: 'Verify your Personal Finance account',
    text: [
      `Your verification code is: ${code}`,
      '',
      'This code expires in 10 minutes.',
      'If you did not request this, you can ignore this email.',
    ].join('\n'),
  });
}

function passwordRulesNotMet(password) {
  const unmet = [];

  if (password.length < 8) {
    unmet.push('At least 8 characters');
  }

  if (!/[A-Z]/.test(password)) {
    unmet.push('At least one uppercase letter');
  }

  if (!/[a-z]/.test(password)) {
    unmet.push('At least one lowercase letter');
  }

  if (!/[0-9]/.test(password)) {
    unmet.push('At least one digit');
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    unmet.push('At least one special character');
  }

  return unmet;
}

function validEmail(email) {
  return (
    typeof email === 'string' &&
    validator.isEmail(email.trim(), { allow_utf8_local_part: false })
  );
}

function registrationConflict(res) {
  return res.status(409).json({
    message: 'Unable to register with this email address.',
  });
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      mobileNumber,
      termsAccepted,
      privacyPolicyAccepted,
    } = req.body ?? {};

    if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) {
      return res.status(400).json({
        message: 'Enter your full name.',
      });
    }

    if (!validEmail(email)) {
      return res.status(400).json({
        message: 'Enter a valid email address.',
      });
    }

    if (
      typeof password !== 'string' ||
      password.length > 128
    ) {
      return res.status(400).json({
        message: 'Enter a valid password.',
        unmetRules: ['Password must be provided and no longer than 128 characters'],
      });
    }

    const unmetRules = passwordRulesNotMet(password);

    if (unmetRules.length > 0) {
      return res.status(400).json({
        message: 'Password does not meet the requirements.',
        unmetRules,
      });
    }

    if (termsAccepted !== true || privacyPolicyAccepted !== true) {
      return res.status(400).json({
        message: 'You must accept the Terms of Service and Privacy Policy.',
      });
    }

    if (
      mobileNumber != null &&
      (typeof mobileNumber !== 'string' || mobileNumber.trim().length > 30)
    ) {
      return res.status(400).json({
        message: 'Enter a valid mobile number.',
      });
    }

    if (!emailServiceConfigured()) {
      return res.status(503).json({
        message: 'Email verification is not configured.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return registrationConflict(res);
    }

    const code = generateVerificationCode();
    const now = new Date();

    const user = new User({
      name: name.trim(),
      email: normalizedEmail,
      mobile_number: mobileNumber?.trim() || undefined,
      password_hash: await bcrypt.hash(password, 12),
      email_verified: false,
      email_verification_code_hash: getVerificationCodeHash(code),
      email_verification_expires_at: new Date(
        now.getTime() + CODE_TTL_MS
      ),
      email_verification_attempts: 0,
      email_verification_resend_count: 0,
      email_verification_resend_window_started_at: now,
      terms_accepted_at: now,
      privacy_policy_accepted_at: now,
      status: 'active',
    });

    try {
      await user.save();
    } catch (error) {
      if (error?.code === 11000) {
        return registrationConflict(res);
      }

      throw error;
    }

    // REQ-35: every new user starts with the default categories. A failure
    // here must not fail the registration - the user can seed them later from
    // the categories screen - so it is logged and swallowed.
    try {
      await createDefaultCategories(user._id);
    } catch (error) {
      console.error('[auth] Default categories failed:', error.message);
    }

    try {
      await sendVerificationEmail(normalizedEmail, code);
    } catch (error) {
      console.error('[auth] Verification email failed:', error.message);

      await User.deleteOne({
        _id: user._id,
        email_verified: false,
      });

      return res.status(503).json({
        message: 'Unable to send the verification email. Please try again later.',
      });
    }

    return res.status(201).json({
      message: 'Registration started. Check your email for the verification code.',
    });
  } catch (error) {
    console.error('[auth] Registration failed:', error.message);

    return res.status(500).json({
      message: 'Unable to complete registration.',
    });
  }
});

// POST /api/auth/verify-email
router.post('/verify-email', async (req, res) => {
  try {
    const { email, code } = req.body ?? {};

    if (
      !validEmail(email) ||
      typeof code !== 'string' ||
      !/^\d{6}$/.test(code)
    ) {
      return res.status(400).json({
        message: 'Enter a valid email address and six-digit verification code.',
      });
    }

    const user = await User.findOne({
      email: email.trim().toLowerCase(),
      status: 'active',
      email_verified: false,
    }).select('+email_verification_code_hash +email_verification_expires_at');

    if (!user) {
      return res.status(400).json({
        message: 'Invalid or expired verification code.',
      });
    }

    if (user.email_verification_attempts >= MAX_VERIFICATION_ATTEMPTS) {
      return res.status(429).json({
        message: 'Verification limit reached. Request a new code.',
      });
    }

    if (
      !user.email_verification_expires_at ||
      user.email_verification_expires_at.getTime() <= Date.now()
    ) {
      return res.status(400).json({
        message: 'Invalid or expired verification code.',
      });
    }

    if (!codesMatch(code, user.email_verification_code_hash)) {
      user.email_verification_attempts += 1;
      await user.save();

      if (user.email_verification_attempts >= MAX_VERIFICATION_ATTEMPTS) {
        return res.status(429).json({
          message: 'Verification limit reached. Request a new code.',
        });
      }

      return res.status(400).json({
        message: 'Invalid or expired verification code.',
      });
    }

    user.email_verified = true;
    user.email_verification_code_hash = undefined;
    user.email_verification_expires_at = undefined;
    user.email_verification_attempts = 0;

    await user.save();

    return res.status(200).json({
      message: 'Email verified successfully.',
    });
  } catch (error) {
    console.error('[auth] Email verification failed:', error.message);

    return res.status(500).json({
      message: 'Unable to verify the email address.',
    });
  }
});

// POST /api/auth/resend-code
router.post('/resend-code', async (req, res) => {
  try {
    const { email } = req.body ?? {};

    if (!validEmail(email)) {
      return res.status(400).json({
        message: 'Enter a valid email address.',
      });
    }

    if (!emailServiceConfigured()) {
      return res.status(503).json({
        message: 'Email verification is not configured.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({
      email: normalizedEmail,
      status: 'active',
      email_verified: false,
    }).select(
      '+email_verification_resend_count +email_verification_resend_window_started_at'
    );

    // Do not disclose whether a registered account exists.
    if (!user) {
      return res.status(202).json({
        message: 'If a pending registration exists, a verification email will be sent.',
      });
    }

    const now = new Date();
    const windowStart = user.email_verification_resend_window_started_at;

    if (
      !windowStart ||
      now.getTime() - windowStart.getTime() >= RESEND_WINDOW_MS
    ) {
      user.email_verification_resend_window_started_at = now;
      user.email_verification_resend_count = 0;
    }

    if (user.email_verification_resend_count >= MAX_RESENDS_PER_HOUR) {
      return res.status(429).json({
        message: 'Resend limit reached. Please try again later.',
      });
    }

    const code = generateVerificationCode();

    user.email_verification_code_hash = getVerificationCodeHash(code);
    user.email_verification_expires_at = new Date(
      now.getTime() + CODE_TTL_MS
    );
    user.email_verification_attempts = 0;
    user.email_verification_resend_count += 1;

    await user.save();

    try {
      await sendVerificationEmail(normalizedEmail, code);
    } catch (error) {
      console.error('[auth] Resend email failed:', error.message);

      return res.status(503).json({
        message: 'Unable to send the verification email. Please try again later.',
      });
    }

    return res.status(202).json({
      message: 'If a pending registration exists, a verification email will be sent.',
    });
  } catch (error) {
    console.error('[auth] Resend request failed:', error.message);

    return res.status(500).json({
      message: 'Unable to process the resend request.',
    });
  }
});

// US-04: Notify the account owner when sign-in attempts trigger a lockout.
async function sendAccountLockoutEmail(email, lockedUntil) {
  if (!smtpConfigured() && devEmailFallback()) {
    console.log(`  [dev] Account ${email} locked until ${lockedUntil.toISOString()}.`);
    return;
  }

  if (!smtpConfigured()) {
    throw new Error('SMTP is not configured');
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: 'Personal Finance account temporarily locked',
    text: [
      'We detected five consecutive failed sign-in attempts.',
      'Your account is temporarily locked for 15 minutes.',
      `The lock expires at: ${lockedUntil.toISOString()}`,
      'If this was not you, secure your account.',
    ].join('\n'),
  });
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body ?? {};

    if (
      !validEmail(email) ||
      typeof password !== 'string' ||
      password.length === 0 ||
      password.length > 128
    ) {
      return res.status(400).json({
        message: 'Enter a valid email address and password.',
      });
    }

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret || jwtSecret.length < 32) {
      console.error('[auth] JWT_SECRET is missing or too short.');

      return res.status(503).json({
        message: 'Authentication service is not configured.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({
      email: normalizedEmail,
    }).select('+password_hash');

    // Use a generic response to avoid disclosing account details.
    if (!user || user.status !== 'active') {
      return res.status(401).json({
        message: 'Invalid email or password.',
      });
    }

    const now = new Date();

    // A locked account must remain blocked even if the password is correct.
    if (
      user.sign_in_locked_until &&
      user.sign_in_locked_until.getTime() > now.getTime()
    ) {
      return res.status(423).json({
        message: 'Sign-in is temporarily locked. Try again later.',
      });
    }

    // Reset expired lockouts before processing the new attempt.
    if (
      user.sign_in_locked_until &&
      user.sign_in_locked_until.getTime() <= now.getTime()
    ) {
      user.failed_sign_in_attempts = 0;
      user.sign_in_locked_until = null;
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordMatches) {
      user.failed_sign_in_attempts =
        (user.failed_sign_in_attempts || 0) + 1;

      if (user.failed_sign_in_attempts >= 5) {
        user.failed_sign_in_attempts = 5;

        const lockedUntil = new Date(
          now.getTime() + 15 * 60 * 1000
        );

        user.sign_in_locked_until = lockedUntil;
        await user.save();

        try {
          await sendAccountLockoutEmail(user.email, lockedUntil);
        } catch (emailError) {
          console.error(
            '[auth] Account lockout notification failed:',
            emailError.message
          );
        }

        return res.status(423).json({
          message:
            'Sign-in is temporarily locked after repeated failures. Try again in 15 minutes.',
        });
      }

      await user.save();

      return res.status(401).json({
        message: 'Invalid email or password.',
      });
    }

    // A valid password is not enough until email verification is complete.
    if (!user.email_verified) {
      return res.status(403).json({
        message: 'Verify your email address before signing in.',
      });
    }

    user.failed_sign_in_attempts = 0;
    user.sign_in_locked_until = null;
    await user.save();

    // Every JWT gets a unique ID backed by a revocable database session.
    const jti = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const token = jwt.sign(
      { jti },
      jwtSecret,
      {
        subject: user._id.toString(),
        expiresIn: '24h',
        algorithm: 'HS256',
      }
    );

    await Session.create({
      jti,
      user_id: user._id,
      expires_at: expiresAt,
      revoked_at: null,
    });

    return res.status(200).json({
      message: 'Sign-in successful.',
      token,
      expiresAt: expiresAt.toISOString(),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error('[auth] Sign-in failed:', error.message);

    return res.status(500).json({
      message: 'Unable to sign in.',
    });
  }
});

// POST /api/auth/logout
// Revoke the current session on the server.
router.post('/logout', authenticate, async (req, res) => {
  try {
    req.authSession.revoked_at = new Date();
    await req.authSession.save();

    return res.status(200).json({
      message: 'Signed out successfully.',
    });
  } catch (error) {
    console.error('[auth] Sign-out failed:', error.message);

    return res.status(500).json({
      message: 'Unable to sign out.',
    });
  }
});

// US-04 / REQ-9: Send a single-use password-reset link.
router.post('/password-reset/request', async (req, res) => {
  const genericMessage =
    'If an eligible account exists, a password reset link will be sent.';

  try {
    const { email } = req.body ?? {};

    if (!validEmail(email)) {
      return res.status(400).json({
        message: 'Enter a valid email address.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({
      email: normalizedEmail,
      status: 'active',
      email_verified: true,
    });

    // Always use the same response whether or not the account exists.
    if (!user) {
      return res.status(202).json({ message: genericMessage });
    }

    if (
      !process.env.SMTP_HOST ||
      !process.env.SMTP_USER ||
      !process.env.SMTP_PASS ||
      !process.env.EMAIL_FROM
    ) {
      console.error('[auth] Password-reset email service is not configured.');
      return res.status(202).json({ message: genericMessage });
    }

    // The raw token is emailed; only its SHA-256 hash is stored.
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    user.password_reset_token_hash = resetTokenHash;
    user.password_reset_expires_at = expiresAt;
    await user.save();

    const resetUrl = new URL(
      '/reset-password',
      process.env.CLIENT_ORIGIN || 'http://localhost:5173'
    );

    resetUrl.searchParams.set('email', normalizedEmail);
    resetUrl.searchParams.set('token', resetToken);

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    try {
      await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: normalizedEmail,
        subject: 'Reset your Personal Finance account password',
        text: [
          'A password reset was requested for your account.',
          '',
          `Open this link within 15 minutes to reset your password: ${resetUrl.toString()}`,
          '',
          'The link can be used only once. If you did not request this, ignore this email.',
        ].join('\n'),
      });
    } catch (emailError) {
      console.error(
        '[auth] Password-reset email failed:',
        emailError.message
      );

      // Invalidate the unsent link.
      await User.updateOne(
        {
          _id: user._id,
          password_reset_token_hash: resetTokenHash,
        },
        {
          $unset: {
            password_reset_token_hash: 1,
            password_reset_expires_at: 1,
          },
        }
      );
    }

    return res.status(202).json({ message: genericMessage });
  } catch (error) {
    console.error('[auth] Password-reset request failed:', error.message);

    return res.status(500).json({
      message: 'Unable to process the password-reset request.',
    });
  }
});

// US-04 / REQ-9: Validate the reset link and change the password.
router.post('/password-reset/confirm', async (req, res) => {
  try {
    const { email, token, newPassword } = req.body ?? {};

    if (
      !validEmail(email) ||
      typeof token !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(token)
    ) {
      return res.status(400).json({
        message: 'Invalid or expired password-reset link.',
      });
    }

    if (typeof newPassword !== 'string' || newPassword.length > 128) {
      return res.status(400).json({
        message: 'Enter a valid new password.',
      });
    }

    const unmetRules = passwordRulesNotMet(newPassword);

    if (unmetRules.length > 0) {
      return res.status(400).json({
        message: 'Password does not meet the requirements.',
        unmetRules,
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const tokenHash = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    const now = new Date();

    const user = await User.findOne({
      email: normalizedEmail,
      status: 'active',
      email_verified: true,
      password_reset_token_hash: tokenHash,
      password_reset_expires_at: { $gt: now },
    }).select('+password_reset_token_hash +password_reset_expires_at');

    if (!user) {
      return res.status(400).json({
        message: 'Invalid or expired password-reset link.',
      });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    // The conditional update prevents the same reset token from being
    // successfully consumed twice.
    const updatedUser = await User.findOneAndUpdate(
      {
        _id: user._id,
        password_reset_token_hash: tokenHash,
        password_reset_expires_at: { $gt: now },
        status: 'active',
        email_verified: true,
      },
      {
        $set: {
          password_hash: newPasswordHash,
          failed_sign_in_attempts: 0,
          sign_in_locked_until: null,
        },
        $unset: {
          password_reset_token_hash: 1,
          password_reset_expires_at: 1,
        },
      },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(400).json({
        message: 'Invalid or expired password-reset link.',
      });
    }

    // Invalidate every existing session, including other devices.
    await Session.updateMany(
      { user_id: updatedUser._id, revoked_at: null },
      { $set: { revoked_at: now } }
    );

    return res.status(200).json({
      message: 'Password reset successfully. Please sign in again.',
    });
  } catch (error) {
    console.error('[auth] Password-reset confirmation failed:', error.message);

    return res.status(500).json({
      message: 'Unable to reset the password.',
    });
  }
});

export default router;
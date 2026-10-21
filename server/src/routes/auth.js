import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import validator from 'validator';
import User from '../models/User.js';

const router = Router();

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_WINDOW_MS = 60 * 60 * 1000;
const MAX_VERIFICATION_ATTEMPTS = 3;
const MAX_RESENDS_PER_HOUR = 3;

function emailServiceConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.EMAIL_FROM &&
    process.env.EMAIL_VERIFICATION_SECRET &&
    process.env.EMAIL_VERIFICATION_SECRET.length >= 32
  );
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

export default router;
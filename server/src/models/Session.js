import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema(
  {
    // Unique identifier included in the JWT
    jti: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // User who owns this session
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Session expiry
    expires_at: {
      type: Date,
      required: true,
    },

    // US-28 (SEC-8): the last time a person (not a background timer) used this
    // session. Anything idle for longer than the limit (30 minutes) is revoked
    // by the server, so the timeout does not depend on the browser's timer.
    last_activity_at: {
      type: Date,
      default: Date.now,
    },

    // Set when the user signs out or their sessions are invalidated
    revoked_at: {
      type: Date,
      default: null,
    },

    // US-05 (REQ-11, SEC-8): when the user has the app lock on, this session
    // may use the API only until this moment. Unlocking and the foreground
    // heartbeat push it forward two minutes; a backgrounded or closed app
    // stops sending the heartbeat, so the session re-locks on the server by
    // itself. Null means locked.
    app_unlocked_until: {
      type: Date,
      default: null,
    },

    // US-05 (HI-2): the single-use WebAuthn challenge issued to this session.
    webauthn_challenge: {
      type: String,
      select: false,
    },

    webauthn_challenge_purpose: {
      type: String,
      enum: ['register', 'authenticate'],
      select: false,
    },

    webauthn_challenge_expires_at: {
      type: Date,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

// Automatically clean up expired sessions.
// Authentication middleware must still check expiry and revocation.
sessionSchema.index(
  { expires_at: 1 },
  { expireAfterSeconds: 0 }
);

export default mongoose.models.Session ||
  mongoose.model('Session', sessionSchema);
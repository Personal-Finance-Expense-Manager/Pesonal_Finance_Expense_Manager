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

    // Set when the user signs out or their sessions are invalidated
    revoked_at: {
      type: Date,
      default: null,
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
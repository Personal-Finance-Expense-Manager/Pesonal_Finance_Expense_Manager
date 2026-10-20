import mongoose from 'mongoose';

/**
 * Connect to MongoDB.
 *
 * The connection string comes from the environment and is never hard-coded,
 * as required by SEC-12 of the SRS.
 *
 * A failed connection is logged but does not stop the process, so that the
 * server still answers GET /api/health while the database is unavailable.
 * Once the data model lands in US-02 (#13) the application routes themselves
 * will report a 503 if the database is down.
 */
export async function connectDB() {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.error('[db] MONGO_URI is not set. Copy server/.env.example to server/.env and fill it in.');
    return false;
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    console.log(`[db] connected to ${mongoose.connection.name}`);
    return true;
  } catch (error) {
    console.error(`[db] connection failed: ${error.message}`);
    console.error('[db] the API is running, but any route that needs data will fail until MongoDB is reachable.');
    return false;
  }
}

export function dbState() {
  // 0 disconnected, 1 connected, 2 connecting, 3 disconnecting
  return ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] ?? 'unknown';
}

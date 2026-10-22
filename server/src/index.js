import 'dotenv/config';
import app from './app.js';
import { connectDB } from './config/db.js';
import { startPurgeJob } from './jobs/purgeJob.js';

const PORT = process.env.PORT || 5000;

async function start() {
  const connected = await connectDB();

  // US-09 (REQ-29): permanently remove recycle-bin items older than 30 days.
  if (connected) startPurgeJob();

  app.listen(PORT, () => {
    console.log(`[api] PFEM server listening on http://localhost:${PORT}`);
    console.log(`[api] health check: http://localhost:${PORT}/api/health`);
  });
}

start();

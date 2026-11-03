
import 'dotenv/config';
import app from './app.js';
import { connectDB } from './config/db.js';
import { startPurgeJob } from './jobs/purgeJob.js';
import { startBudgetJob } from './jobs/budgetJob.js';

const PORT = process.env.PORT || 5000;

async function start() {
  const connected = await connectDB();

  if (connected) {
    startPurgeJob();
    startBudgetJob();
  }

  app.listen(PORT, () => {
    console.log(`[api] PFEM server listening on http://localhost:${PORT}`);
    console.log(`[api] health check: http://localhost:${PORT}/api/health`);
  });
}

start();

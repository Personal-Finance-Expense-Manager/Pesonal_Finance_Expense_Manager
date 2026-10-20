import 'dotenv/config';
import app from './app.js';
import { connectDB } from './config/db.js';

const PORT = process.env.PORT || 5000;

async function start() {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`[api] PFEM server listening on http://localhost:${PORT}`);
    console.log(`[api] health check: http://localhost:${PORT}/api/health`);
  });
}

start();

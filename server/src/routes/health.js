import { Router } from 'express';
import { dbState } from '../config/db.js';

const router = Router();

/**
 * GET /api/health
 *
 * Liveness check used by the CI pipeline, the deployment target and the
 * client during development. Returns 200 whenever the API process is up.
 */
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'pfem-api',
    database: dbState(),
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

export default router;

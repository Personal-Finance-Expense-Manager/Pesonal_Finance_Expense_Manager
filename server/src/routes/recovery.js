import { Router } from 'express';
import { listDeletedResources, restoreResource } from '../services/resourceRecoveryService.js';
import { sendApiError } from '../utils/apiError.js';
const router = Router();
router.get('/', async (req, res, next) => {
  try { res.json({ retention_days: 30, items: await listDeletedResources(req.user.id) }); }
  catch (error) { sendApiError(res, next, error); }
});
router.post('/:resource/:id/restore', async (req, res, next) => {
  try { res.json({ message: 'Resource restored.', data: await restoreResource(req.user.id, req.params.resource, req.params.id) }); }
  catch (error) { sendApiError(res, next, error); }
});
export default router;

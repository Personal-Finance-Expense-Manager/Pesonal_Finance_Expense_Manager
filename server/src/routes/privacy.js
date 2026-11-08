import { Router } from 'express';
import { exportAllJson } from '../services/exportService.js';
import {
  accessReport,
  correctProfile,
  eraseAccount,
  recordConsent,
} from '../services/privacyService.js';
import { auditFromRequest } from '../services/auditService.js';
import { ApiError, sendApiError } from '../utils/apiError.js';
import { CONSENT_PURPOSES, PRIVACY_POLICY_VERSION } from '../config/privacy.js';

/**
 * Personal-data rights - US-28 (#67), SEC-13. Mounted behind requireUser, so
 * a person can only ever reach their own data. See services/privacyService.js.
 */
const router = Router();

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (error) {
    sendApiError(res, next, error);
  }
};

// Access.
router.get('/me', handle(async (req, res) => {
  await auditFromRequest(req, { category: 'privacy', action: 'privacy.access_requested' });
  res.json({ data: await accessReport(req.user._id), policy_version: PRIVACY_POLICY_VERSION });
}));

// Portability: the same complete export as /api/data/export.json (REQ-87).
router.get('/export', handle(async (req, res) => {
  const document = await exportAllJson(req.user._id);
  await auditFromRequest(req, { category: 'export', action: 'export.privacy_portability', entityType: 'export' });
  res.set('Content-Disposition', 'attachment; filename="pfem-my-data.json"');
  res.json(document);
}));

// Correction.
router.patch('/profile', handle(async (req, res) => {
  const result = await correctProfile(req.user._id, req.body ?? {});
  await auditFromRequest(req, { category: 'privacy', action: 'privacy.profile_corrected', entityType: 'user', entityId: req.user._id, metadata: { fields: result.fields } });
  res.json({ message: 'Your details were updated.', data: result.profile });
}));

// Consent, for accounts created before consent was collected at registration.
router.post('/consent', handle(async (req, res) => {
  if (req.body?.dataProcessingConsent !== true) {
    throw new ApiError(400, 'Consent must be given explicitly (dataProcessingConsent: true).');
  }
  const consent = await recordConsent(req.user._id, { policyVersion: PRIVACY_POLICY_VERSION, purposes: CONSENT_PURPOSES, ip: req.ip });
  await auditFromRequest(req, { category: 'privacy', action: 'privacy.consent_recorded', entityType: 'user', entityId: req.user._id, metadata: { policy_version: consent.policy_version } });
  res.status(201).json({ message: 'Consent recorded.', data: consent });
}));

// Erasure (and withdrawal of consent).
router.delete('/account', handle(async (req, res) => {
  const result = await eraseAccount(req.user._id, req.body ?? {}, req.ip);
  res.json({ message: 'Your account and data have been erased.', data: result });
}));

export default router;

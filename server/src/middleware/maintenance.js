/**
 * Maintenance mode - US-26 (#62), REQ-97.
 *
 * While a backup is being restored, every request except the health probe is
 * answered 503, so nothing can write to a database that is being replaced.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let active = false;
export const restoreMarkerPath = () => path.join(path.resolve(process.env.BACKUP_DIR ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backups')), '.restore-incomplete.json');

export const setMaintenanceMode = (value) => {
  active = Boolean(value);
};
export const inMaintenanceMode = () => {
  if (active) return true;
  try { fs.statSync(restoreMarkerPath()); return true; }
  catch (error) { return error.code !== 'ENOENT'; } // unknown marker state fails closed
};

export default function maintenance(req, res, next) {
  if (!inMaintenanceMode() || req.path === '/api/health') return next();
  res.setHeader('Retry-After', '60');
  return res.status(503).json({ message: 'The service is being restored from a backup. Please try again shortly.' });
}

/**
 * Maintenance mode - US-26 (#62), REQ-97.
 *
 * While a backup is being restored, every request except the health probe is
 * answered 503, so nothing can write to a database that is being replaced.
 */
let active = false;

export const setMaintenanceMode = (value) => {
  active = Boolean(value);
};
export const inMaintenanceMode = () => active;

export default function maintenance(req, res, next) {
  if (!active || req.path === '/api/health') return next();
  res.setHeader('Retry-After', '60');
  return res.status(503).json({ message: 'The service is being restored from a backup. Please try again shortly.' });
}

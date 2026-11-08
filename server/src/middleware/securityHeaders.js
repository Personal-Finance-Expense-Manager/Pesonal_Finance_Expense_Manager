import { HSTS_MAX_AGE_SECONDS, allowedOrigins, httpsRequired, isProduction } from '../config/security.js';
import { recordAudit } from '../services/auditService.js';

/**
 * Transport security and secure response headers - US-28 (#67), SEC-1, SEC-6.
 *
 * TLS itself is terminated by the reverse proxy (deploy/nginx.conf.example sets
 * TLS 1.2+). This middleware makes the API refuse to be used over plain HTTP in
 * production and adds the headers a browser needs to stay on HTTPS.
 */

/** Redirect (GET/HEAD) or refuse (everything else) when the request did not arrive over HTTPS. */
export function enforceHttps(req, res, next) {
  if (!httpsRequired() || req.secure) return next();

  // The load balancer's health probe usually speaks plain HTTP inside the network.
  if (req.path === '/api/health') return next();

  if (req.method === 'GET' || req.method === 'HEAD') {
    const host = req.headers.host || '';
    // Redirect only to the host the request named, and only a path we serve.
    if (/^[A-Za-z0-9.-]+(:\d+)?$/.test(host)) {
      return res.redirect(308, `https://${host}${req.originalUrl}`);
    }
  }

  return res.status(426).json({ message: 'HTTPS is required.' });
}

/**
 * Headers for every API response. The API only returns JSON and file downloads,
 * so the Content-Security-Policy is the strictest possible: nothing may load or
 * be framed. The web client's own CSP is set where the client is served
 * (deploy/nginx.conf.example).
 */
export function securityHeaders(req, res, next) {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');

  if (httpsRequired() || isProduction()) {
    res.setHeader('Strict-Transport-Security', `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains`);
  }

  next();
}

/**
 * CORS allow-list (SEC-6). Production requires explicit origins (checked at
 * start-up); in development an unset CLIENT_ORIGIN allows the Vite dev server.
 */
export function corsOptions() {
  const origins = allowedOrigins();
  const allowed = origins.length ? origins : ['http://localhost:5173', 'http://127.0.0.1:5173'];

  return {
    origin(origin, callback) {
      // No Origin header: a non-browser client or same-origin request.
      if (!origin || allowed.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-File-Name', 'X-User-Id', 'Idempotency-Key'],
    exposedHeaders: ['Content-Disposition', 'Server-Timing', 'Retry-After'],
    credentials: false, // the API uses a Bearer token, not cookies
    maxAge: 600,
  };
}

/**
 * CSRF defence (SEC-6). Requests are authenticated by an Authorization header,
 * which a cross-site form or image cannot attach, and no cookies are used. As a
 * second layer, a state-changing request from a browser whose Origin is not on
 * the allow-list is refused outright.
 */
export function originGuard(req, res, next) {
  const origin = req.headers.origin;

  if (!origin || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const origins = allowedOrigins();
  const allowed = origins.length ? origins : ['http://localhost:5173', 'http://127.0.0.1:5173'];

  if (allowed.includes(origin)) return next();

  void recordAudit({
    category: 'security',
    outcome: 'denied',
    action: 'request.origin_rejected',
    ip: req.ip,
    metadata: { path: (req.originalUrl || '').split('?')[0].slice(0, 120), method: req.method },
  });

  return res.status(403).json({ message: 'Request origin is not allowed.' });
}

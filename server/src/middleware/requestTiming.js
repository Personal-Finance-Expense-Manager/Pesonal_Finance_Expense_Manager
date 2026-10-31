/**
 * Request timing - US-27 (#14), SRS PER-1, PER-3, PER-5.
 *
 * Every response carries a Server-Timing header with the time the API spent
 * on it, so the browser's network panel shows server time separately from
 * network time. A request slower than SLOW_REQUEST_MS (default 1000 ms, the
 * PER-1 and PER-5 budget) is logged, so a regression shows up in the API
 * console during development and in the logs in production.
 *
 * Only the method and path are logged, never the query string or body, which
 * can hold personal data.
 */

function threshold() {
  const value = Number(process.env.SLOW_REQUEST_MS);
  return Number.isFinite(value) && value > 0 ? value : 1000;
}

export default function requestTiming(req, res, next) {
  const started = process.hrtime.bigint();
  const writeHead = res.writeHead;

  res.writeHead = function timedWriteHead(...args) {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (!res.headersSent) res.setHeader('Server-Timing', `app;dur=${ms.toFixed(1)}`);
    return writeHead.apply(this, args);
  };

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (ms > threshold()) {
      const path = req.originalUrl.split('?')[0];
      console.warn(`[slow] ${req.method} ${path} ${res.statusCode} ${ms.toFixed(0)} ms`);
    }
  });

  next();
}

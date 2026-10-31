import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import requestTiming from '../src/middleware/requestTiming.js';

// ---------------------------------------------------------------------------
// US-27 (PER-1, PER-5): every response says how long the API took, and slow
// requests are logged without their query string.
// ---------------------------------------------------------------------------

function fakeResponse() {
  const res = new EventEmitter();
  res.headers = {};
  res.headersSent = false;
  res.statusCode = 200;
  res.setHeader = (name, value) => {
    res.headers[name.toLowerCase()] = value;
  };
  res.writeHead = function writeHead() {
    res.headersSent = true;
    return this;
  };
  return res;
}

function captureWarnings(fn) {
  const original = console.warn;
  const lines = [];
  console.warn = (line) => lines.push(line);
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return lines;
}

test('PER-1 every response carries a Server-Timing header', () => {
  const req = { method: 'GET', originalUrl: '/api/transactions' };
  const res = fakeResponse();
  let calledNext = false;

  requestTiming(req, res, () => {
    calledNext = true;
  });
  res.writeHead(200);

  assert.equal(calledNext, true);
  assert.match(res.headers['server-timing'], /^app;dur=\d+(\.\d)?$/);
});

test('PER-5 a request slower than the threshold is logged, without its query string', () => {
  process.env.SLOW_REQUEST_MS = '1';
  const req = { method: 'GET', originalUrl: '/api/transactions?search=salary' };
  const res = fakeResponse();
  requestTiming(req, res, () => {});

  const started = Date.now();
  while (Date.now() - started < 5) {
    // wait just past the 1 ms threshold
  }

  const lines = captureWarnings(() => res.emit('finish'));
  delete process.env.SLOW_REQUEST_MS;

  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[slow\] GET \/api\/transactions 200 \d+ ms$/);
  assert.equal(lines[0].includes('salary'), false);
});

test('PER-5 a fast request is not logged', () => {
  process.env.SLOW_REQUEST_MS = '60000';
  const req = { method: 'POST', originalUrl: '/api/transactions' };
  const res = fakeResponse();
  requestTiming(req, res, () => {});

  const lines = captureWarnings(() => res.emit('finish'));
  delete process.env.SLOW_REQUEST_MS;

  assert.deepEqual(lines, []);
});

test('an invalid threshold falls back to 1000 ms', () => {
  process.env.SLOW_REQUEST_MS = 'not-a-number';
  const req = { method: 'GET', originalUrl: '/api/health' };
  const res = fakeResponse();
  requestTiming(req, res, () => {});

  const lines = captureWarnings(() => res.emit('finish'));
  delete process.env.SLOW_REQUEST_MS;

  assert.deepEqual(lines, []);
});

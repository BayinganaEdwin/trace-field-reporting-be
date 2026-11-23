/**
 * Unit tests — Auth middleware (requireAuth, requireRole)
 * Tests the pure middleware logic without making HTTP calls.
 */

// Set test DB before any module load
const os = require('os');
const path = require('path');
process.env.TRACE_TEST_DB = path.join(os.tmpdir(), `trace-mw-test-${process.pid}.json`);

const { initSchema, getDbSync } = require('../../db/schema');

let requireAuth, requireRole;

beforeAll(async () => {
  await initSchema();
  const db = getDbSync();
  db.exec(`
    INSERT OR IGNORE INTO users (id, name, email, role)
    VALUES ('u-mw-worker', 'Test Worker', 'worker-mw@test.com', 'worker'),
           ('u-mw-manager', 'Test Manager', 'manager-mw@test.com', 'manager');
  `);
  ({ requireAuth, requireRole } = require('../../middleware/auth'));
});

// ── Helper to build fake req / res / next ────────────────────────────────────
function makeReqRes(headers = {}, user = null) {
  const req = { headers, query: {}, user };
  const res = {
    _status: null, _body: null,
    status(code) { this._status = code; return this; },
    json(body)   { this._body  = body;  return this; },
  };
  const next = jest.fn();
  return { req, res, next };
}

// ── requireAuth ──────────────────────────────────────────────────────────────
describe('requireAuth middleware', () => {
  test('returns 401 when X-User-Id header is missing', () => {
    const { req, res, next } = makeReqRes({});
    requireAuth(req, res, next);
    expect(res._status).toBe(401);
    expect(res._body.error).toMatch(/Missing/i);
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 when X-User-Id refers to unknown user', () => {
    const { req, res, next } = makeReqRes({ 'x-user-id': 'does-not-exist' });
    requireAuth(req, res, next);
    expect(res._status).toBe(401);
    expect(res._body.error).toMatch(/Unknown user/i);
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next() and sets req.user when valid user id is provided', () => {
    const { req, res, next } = makeReqRes({ 'x-user-id': 'u-mw-worker' });
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe('u-mw-worker');
    expect(req.user.role).toBe('worker');
  });

  test('accepts userId via query param as fallback', () => {
    const req = { headers: {}, query: { userId: 'u-mw-manager' } };
    const res = {
      _status: null, _body: null,
      status(c) { this._status = c; return this; },
      json(b)   { this._body  = b;  return this; },
    };
    const next = jest.fn();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.role).toBe('manager');
  });
});

// ── requireRole ──────────────────────────────────────────────────────────────
describe('requireRole middleware', () => {
  test('returns 401 when req.user is not set', () => {
    const { req, res, next } = makeReqRes({}, null);
    requireRole('manager')(req, res, next);
    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 403 when user role does not match required role', () => {
    const { req, res, next } = makeReqRes({}, { role: 'worker' });
    requireRole('manager')(req, res, next);
    expect(res._status).toBe(403);
    expect(res._body.error).toMatch(/Requires role/i);
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next() when user role matches', () => {
    const { req, res, next } = makeReqRes({}, { role: 'manager' });
    requireRole('manager')(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('calls next() when user role is any of the allowed roles', () => {
    const { req, res, next } = makeReqRes({}, { role: 'owner' });
    requireRole('manager', 'owner')(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

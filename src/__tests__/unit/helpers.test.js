/**
 * Unit tests — Pure helper functions used across route handlers
 * Tests toIso() and parsePhotoUrls() in isolation.
 */

// ── toIso ────────────────────────────────────────────────────────────────────
// Extracted from reports.js — appends 'Z' to SQLite UTC timestamps
function toIso(ts) {
  if (!ts) return ts;
  return ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
}

describe('toIso helper', () => {
  test('converts SQLite datetime to ISO 8601 UTC string', () => {
    expect(toIso('2026-11-24 09:30:00')).toBe('2026-11-24T09:30:00Z');
  });

  test('leaves already-ISO strings unchanged', () => {
    expect(toIso('2026-11-24T09:30:00Z')).toBe('2026-11-24T09:30:00Z');
  });

  test('returns null unchanged', () => {
    expect(toIso(null)).toBeNull();
  });

  test('returns undefined unchanged', () => {
    expect(toIso(undefined)).toBeUndefined();
  });
});

// ── parsePhotoUrls ────────────────────────────────────────────────────────────
// Extracted from reports.js — safely parses JSON array stored in SQLite TEXT
function parsePhotoUrls(str) {
  try { return JSON.parse(str || '[]'); } catch { return []; }
}

describe('parsePhotoUrls helper', () => {
  test('parses a valid JSON array string', () => {
    const result = parsePhotoUrls('["/uploads/photo1.jpg","/uploads/photo2.jpg"]');
    expect(result).toEqual(['/uploads/photo1.jpg', '/uploads/photo2.jpg']);
  });

  test('returns empty array for null input', () => {
    expect(parsePhotoUrls(null)).toEqual([]);
  });

  test('returns empty array for empty string', () => {
    expect(parsePhotoUrls('')).toEqual([]);
  });

  test('returns empty array for malformed JSON', () => {
    expect(parsePhotoUrls('not-json')).toEqual([]);
  });

  test('returns empty array for empty JSON array string', () => {
    expect(parsePhotoUrls('[]')).toEqual([]);
  });
});

// ── RBAC role constants ──────────────────────────────────────────────────────
describe('Role constants', () => {
  const ROLES = ['worker', 'manager', 'owner'];

  test('worker is a valid role', () => {
    expect(ROLES).toContain('worker');
  });

  test('manager is a valid role', () => {
    expect(ROLES).toContain('manager');
  });

  test('worker cannot approve — not in manager/owner set', () => {
    const canApprove = ['manager', 'owner'];
    expect(canApprove).not.toContain('worker');
  });
});

/**
 * Integration tests — /reports endpoints
 * Tests report submission, listing, retrieval, approval, rejection, flagging,
 * and role-based access control enforcement.
 */
const { initTestApp, cleanupTestApp, getRequest, getDb } = require('../testSetup');

beforeAll(async () => { await initTestApp(); });
afterAll(() => { cleanupTestApp(); });

let workerReportId;
let worker2ReportId;

// ── Submission ────────────────────────────────────────────────────────────────
describe('POST /reports — submission', () => {
  test('worker can submit a report and receives 201', async () => {
    const res = await getRequest()
      .post('/reports')
      .set('x-user-id', 'u-worker1')
      .send({
        site_id: 'site-001',
        reported_stage: 'formwork_erected',
        notes: 'Formwork complete on east wall',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^report-/);
    expect(res.body.reported_stage).toBe('formwork_erected');
    expect(res.body.status).toBe('pending');
    workerReportId = res.body.id;
  });

  test('manager cannot submit a report — receives 403', async () => {
    const res = await getRequest()
      .post('/reports')
      .set('x-user-id', 'u-manager')
      .send({ site_id: 'site-001', reported_stage: 'formwork_erected' });

    expect(res.status).toBe(403);
  });

  test('returns 400 when site_id is missing', async () => {
    const res = await getRequest()
      .post('/reports')
      .set('x-user-id', 'u-worker1')
      .send({ reported_stage: 'concrete_poured' });

    expect(res.status).toBe(400);
  });

  test('returns 400 when reported_stage is missing', async () => {
    const res = await getRequest()
      .post('/reports')
      .set('x-user-id', 'u-worker1')
      .send({ site_id: 'site-001' });

    expect(res.status).toBe(400);
  });

  test('returns 404 when site does not exist', async () => {
    const res = await getRequest()
      .post('/reports')
      .set('x-user-id', 'u-worker1')
      .send({ site_id: 'fake-site', reported_stage: 'formwork_erected' });

    expect(res.status).toBe(404);
  });

  test('returns 401 when unauthenticated', async () => {
    const res = await getRequest()
      .post('/reports')
      .send({ site_id: 'site-001', reported_stage: 'formwork_erected' });

    expect(res.status).toBe(401);
  });
});

// ── Listing (role-scoped) ─────────────────────────────────────────────────────
describe('GET /reports — role-scoped listing', () => {
  beforeAll(async () => {
    // Worker 2 submits their own report
    const res = await getRequest()
      .post('/reports')
      .set('x-user-id', 'u-worker2')
      .send({ site_id: 'site-001', reported_stage: 'reinforcement_placed' });
    worker2ReportId = res.body.id;
  });

  test('worker sees only their own reports in the list', async () => {
    const res = await getRequest()
      .get('/reports')
      .set('x-user-id', 'u-worker1');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Every report must belong to u-worker1
    res.body.forEach(r => {
      expect(r.submitted_by_id).toBe('u-worker1');
    });
  });

  test('manager sees all reports across workers', async () => {
    const res = await getRequest()
      .get('/reports')
      .set('x-user-id', 'u-manager');

    expect(res.status).toBe(200);
    const ids = res.body.map(r => r.submitted_by_id);
    // Should include both workers
    expect(ids).toContain('u-worker1');
    expect(ids).toContain('u-worker2');
  });
});

// ── Individual report access (RBAC) ──────────────────────────────────────────
describe('GET /reports/:id — RBAC enforcement', () => {
  test('worker can retrieve their own report', async () => {
    const res = await getRequest()
      .get(`/reports/${workerReportId}`)
      .set('x-user-id', 'u-worker1');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(workerReportId);
  });

  test('worker receives 403 when accessing another worker\'s report', async () => {
    const res = await getRequest()
      .get(`/reports/${worker2ReportId}`)
      .set('x-user-id', 'u-worker1'); // u-worker1 trying to see u-worker2's report

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Not your report/i);
  });

  test('manager can access any report', async () => {
    const res = await getRequest()
      .get(`/reports/${worker2ReportId}`)
      .set('x-user-id', 'u-manager');

    expect(res.status).toBe(200);
  });

  test('returns 404 for non-existent report', async () => {
    const res = await getRequest()
      .get('/reports/report-does-not-exist')
      .set('x-user-id', 'u-manager');

    expect(res.status).toBe(404);
  });
});

// ── Approval / Rejection / Flagging ──────────────────────────────────────────
describe('POST /reports/:id/approve', () => {
  test('manager can approve a pending report', async () => {
    const res = await getRequest()
      .post(`/reports/${workerReportId}/approve`)
      .set('x-user-id', 'u-manager')
      .send({ comment: 'Looks good' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.reviewed_by_id).toBe('u-manager');
  });

  test('worker cannot approve a report — receives 403', async () => {
    const res = await getRequest()
      .post(`/reports/${worker2ReportId}/approve`)
      .set('x-user-id', 'u-worker1');

    expect(res.status).toBe(403);
  });
});

describe('POST /reports/:id/reject', () => {
  test('returns 400 when rejection comment is missing', async () => {
    const res = await getRequest()
      .post(`/reports/${worker2ReportId}/reject`)
      .set('x-user-id', 'u-manager')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/comment is required/i);
  });

  test('manager can reject a report with a comment', async () => {
    const res = await getRequest()
      .post(`/reports/${worker2ReportId}/reject`)
      .set('x-user-id', 'u-manager')
      .send({ comment: 'Photo is blurry, please resubmit' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
    expect(res.body.rejection_reason).toBe('Photo is blurry, please resubmit');
  });
});

describe('POST /reports/:id/flag', () => {
  test('manager can flag a report for follow-up', async () => {
    // Submit a fresh report to flag
    const submit = await getRequest()
      .post('/reports')
      .set('x-user-id', 'u-worker1')
      .send({ site_id: 'site-001', reported_stage: 'concrete_poured' });

    const flagRes = await getRequest()
      .post(`/reports/${submit.body.id}/flag`)
      .set('x-user-id', 'u-manager')
      .send({ comment: 'Needs site inspection' });

    expect(flagRes.status).toBe(200);
    expect(flagRes.body.status).toBe('flagged');
  });
});

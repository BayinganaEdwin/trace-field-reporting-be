/**
 * Integration tests — /sites endpoints
 * Tests site creation, retrieval, update, deletion, and worker assignment.
 */
const { initTestApp, cleanupTestApp, getRequest } = require('../testSetup');

beforeAll(async () => { await initTestApp(); });
afterAll(() => { cleanupTestApp(); });

let createdSiteId;

describe('POST /sites', () => {
  test('manager can create a new site and receives 201', async () => {
    const res = await getRequest()
      .post('/sites')
      .set('x-user-id', 'u-manager')
      .send({ name: 'Integration Test Site', address: 'Kigali, Rwanda' });

    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^site-/);
    expect(res.body.name).toBe('Integration Test Site');
    createdSiteId = res.body.id;
  });

  test('worker cannot create a site — receives 403', async () => {
    const res = await getRequest()
      .post('/sites')
      .set('x-user-id', 'u-worker1')
      .send({ name: 'Worker Site' });

    expect(res.status).toBe(403);
  });

  test('returns 400 when site name is missing', async () => {
    const res = await getRequest()
      .post('/sites')
      .set('x-user-id', 'u-manager')
      .send({ address: 'Somewhere' });

    expect(res.status).toBe(400);
  });

  test('returns 401 when request is unauthenticated', async () => {
    const res = await getRequest()
      .post('/sites')
      .send({ name: 'No Auth Site' });

    expect(res.status).toBe(401);
  });
});

describe('GET /sites', () => {
  test('manager sees only their own sites', async () => {
    const res = await getRequest()
      .get('/sites')
      .set('x-user-id', 'u-manager');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // All returned sites must belong to this manager
    res.body.forEach(site => {
      expect(site.manager_id).toBe('u-manager');
    });
  });

  test('worker sees only sites they are assigned to', async () => {
    const res = await getRequest()
      .get('/sites')
      .set('x-user-id', 'u-worker1');

    expect(res.status).toBe(200);
    // u-worker1 is assigned to site-001 in seed
    expect(res.body.some(s => s.id === 'site-001')).toBe(true);
  });

  test('worker does not see unassigned sites', async () => {
    const res = await getRequest()
      .get('/sites')
      .set('x-user-id', 'u-worker2'); // not assigned to any site

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });
});

describe('GET /sites/:id', () => {
  test('returns site detail with computed fields', async () => {
    const res = await getRequest()
      .get('/sites/site-001')
      .set('x-user-id', 'u-manager');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('site-001');
    expect(res.body).toHaveProperty('totalReports');
    expect(res.body).toHaveProperty('rei');
    expect(res.body).toHaveProperty('workerCount');
  });

  test('returns 404 for non-existent site', async () => {
    const res = await getRequest()
      .get('/sites/site-does-not-exist')
      .set('x-user-id', 'u-manager');

    expect(res.status).toBe(404);
  });
});

describe('PATCH /sites/:id', () => {
  test('manager can update site name', async () => {
    const res = await getRequest()
      .patch('/sites/site-001')
      .set('x-user-id', 'u-manager')
      .send({ name: 'Updated Site Alpha' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Site Alpha');
  });
});

describe('Worker assignment', () => {
  test('manager can assign a worker to a site', async () => {
    const res = await getRequest()
      .post('/sites/site-001/workers')
      .set('x-user-id', 'u-manager')
      .send({ workerId: 'u-worker2' });

    expect(res.status).toBe(201);
    expect(res.body.workerId).toBe('u-worker2');
  });

  test('assigning the same worker twice returns 409', async () => {
    const res = await getRequest()
      .post('/sites/site-001/workers')
      .set('x-user-id', 'u-manager')
      .send({ workerId: 'u-worker2' });

    expect(res.status).toBe(409);
  });

  test('manager can list workers on a site', async () => {
    const res = await getRequest()
      .get('/sites/site-001/workers')
      .set('x-user-id', 'u-manager');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });
});

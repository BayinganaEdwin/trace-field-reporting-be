/**
 * Integration tests — /users endpoints
 * Tests user registration, login, profile retrieval, and profile update.
 */
const { initTestApp, cleanupTestApp, getRequest } = require('../testSetup');

beforeAll(async () => { await initTestApp(); });
afterAll(() => { cleanupTestApp(); });

describe('POST /users/register', () => {
  test('creates a new worker account and returns 201', async () => {
    const res = await getRequest()
      .post('/users/register')
      .send({ name: 'New Worker', email: 'new.worker@trace.com', role: 'worker' });

    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^user-/);
    expect(res.body.email).toBe('new.worker@trace.com');
    expect(res.body.role).toBe('worker');
  });

  test('returns 400 when required fields are missing', async () => {
    const res = await getRequest()
      .post('/users/register')
      .send({ name: 'No Email' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('returns 400 for invalid role value', async () => {
    const res = await getRequest()
      .post('/users/register')
      .send({ name: 'Bad Role', email: 'badrole@test.com', role: 'admin' });

    expect(res.status).toBe(400);
  });

  test('returns 409 when email is already registered', async () => {
    // First registration
    await getRequest()
      .post('/users/register')
      .send({ name: 'Dup User', email: 'dup@trace.com', role: 'worker' });

    // Second with same email
    const res = await getRequest()
      .post('/users/register')
      .send({ name: 'Dup Again', email: 'dup@trace.com', role: 'worker' });

    expect(res.status).toBe(409);
  });
});

describe('POST /users/login', () => {
  test('returns user object for known email', async () => {
    const res = await getRequest()
      .post('/users/login')
      .send({ email: 'alice@test.com' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('u-worker1');
    expect(res.body.name).toBe('Alice Worker');
  });

  test('returns 401 for unknown email', async () => {
    const res = await getRequest()
      .post('/users/login')
      .send({ email: 'nobody@trace.com' });

    expect(res.status).toBe(401);
  });

  test('returns 400 when email field is missing', async () => {
    const res = await getRequest()
      .post('/users/login')
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('GET /users/me', () => {
  test('returns current user profile when authenticated', async () => {
    const res = await getRequest()
      .get('/users/me')
      .set('x-user-id', 'u-manager');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('u-manager');
    expect(res.body.role).toBe('manager');
  });

  test('returns 401 when no auth header is provided', async () => {
    const res = await getRequest().get('/users/me');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /users/me', () => {
  test('updates user name and returns updated profile', async () => {
    const res = await getRequest()
      .patch('/users/me')
      .set('x-user-id', 'u-worker1')
      .send({ name: 'Alice Updated' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Alice Updated');
  });
});

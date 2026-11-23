/**
 * testSetup.js — shared bootstrap for all Trace backend tests
 *
 * Sets TRACE_TEST_DB to a temp file so tests never touch the real database.
 * Call initTestApp() in beforeAll() and cleanupTestApp() in afterAll().
 */
const os   = require('os');
const path = require('path');
const fs   = require('fs');

// Point to a temp DB file unique per test run
const TEST_DB_FILE = path.join(os.tmpdir(), `trace-test-${process.pid}-${Date.now()}.json`);
process.env.TRACE_TEST_DB = TEST_DB_FILE;

// Must be required AFTER setting TRACE_TEST_DB so the module picks it up
const { initSchema, getDbSync } = require('../db/schema');
const { createApp } = require('../app');
const supertest = require('supertest');

let _app = null;
let _request = null;

async function initTestApp() {
  await initSchema();
  _app = createApp();
  _request = supertest(_app);

  // Seed minimal test data
  const db = getDbSync();
  db.exec(`
    INSERT OR IGNORE INTO users (id, name, email, role)
    VALUES
      ('u-worker1', 'Alice Worker',  'alice@test.com',   'worker'),
      ('u-worker2', 'Bob Worker',    'bob@test.com',     'worker'),
      ('u-manager', 'Carol Manager', 'carol@test.com',   'manager'),
      ('u-owner',   'Dave Owner',    'dave@test.com',    'owner');

    INSERT OR IGNORE INTO sites (id, name, address, manager_id, owner_id, target_stage)
    VALUES
      ('site-001', 'Test Site Alpha', 'Gasabo, Kigali', 'u-manager', 'u-owner', 'formwork_erected');

    INSERT OR IGNORE INTO site_workers (site_id, worker_id, assigned_by)
    VALUES ('site-001', 'u-worker1', 'u-manager');
  `);
}

function cleanupTestApp() {
  if (fs.existsSync(TEST_DB_FILE)) fs.unlinkSync(TEST_DB_FILE);
}

function getRequest() { return _request; }
function getDb()      { return getDbSync(); }

module.exports = { initTestApp, cleanupTestApp, getRequest, getDb, TEST_DB_FILE };

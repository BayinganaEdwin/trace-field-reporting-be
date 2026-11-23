/**
 * SQLite schema for SiteLog backend — using sql.js (pure WASM, no native build)
 *
 * sql.js keeps the DB in memory. We persist to disk via JSON serialization
 * after every write, and load it back on startup. This is fine for local/demo use.
 * For production, switch to better-sqlite3 or Turso.
 */
const initSqlJs = require('sql.js');
const path      = require('path');
const fs        = require('fs');

const DB_DIR  = path.join(__dirname, '../../db');
// Allow tests to override the DB file path via environment variable
const DB_FILE = process.env.TRACE_TEST_DB
  ? process.env.TRACE_TEST_DB
  : path.join(DB_DIR, 'sitelog.db.json');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

let _db   = null;
let _SQL  = null;

async function getDb() {
  if (_db) return _db;
  _SQL = await initSqlJs();

  // Load from disk if it exists
  if (fs.existsSync(DB_FILE)) {
    const saved = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    _db = new _SQL.Database(Buffer.from(saved.data));
    console.log('[DB] Loaded existing database from', DB_FILE);
  } else {
    _db = new _SQL.Database();
    console.log('[DB] Created new in-memory database');
  }
  _db.pragma = (sql) => _db.run(`PRAGMA ${sql}`);
  return _db;
}

function persist(db) {
  const data = Array.from(db.export());
  fs.writeFileSync(DB_FILE, JSON.stringify({ data }));
}

// ── Wrapper that auto-persists after writes ───────────────────────────────────
function makeDb(rawDb) {
  return {
    // prepare → returns object with .run(), .get(), .all()
    prepare(sql) {
      return {
        run(...params) {
          rawDb.run(sql, flatParams(params));
          persist(rawDb);
          return { changes: 1 };
        },
        get(...params) {
          const stmt = rawDb.prepare(sql);
          stmt.bind(flatParams(params));
          if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row;
          }
          stmt.free();
          return undefined;
        },
        all(...params) {
          const rows = [];
          const stmt = rawDb.prepare(sql);
          stmt.bind(flatParams(params));
          while (stmt.step()) rows.push(stmt.getAsObject());
          stmt.free();
          return rows;
        },
      };
    },
    exec(sql) {
      rawDb.exec(sql);
      persist(rawDb);
    },
    run(sql, params) {
      rawDb.run(sql, params);
      persist(rawDb);
    },
    // raw access
    _raw: rawDb,
  };
}

// sql.js takes params as array or object; normalise them
function flatParams(args) {
  if (args.length === 0) return [];
  if (args.length === 1 && (Array.isArray(args[0]) || (typeof args[0] === 'object' && args[0] !== null && !Buffer.isBuffer(args[0])))) {
    return args[0];
  }
  return args;
}

let _wrapped = null;

async function getWrappedDb() {
  if (_wrapped) return _wrapped;
  const raw = await getDb();
  _wrapped = makeDb(raw);
  return _wrapped;
}

// Synchronous accessor (call after initSchema resolves)
function getDbSync() {
  if (!_wrapped) throw new Error('DB not initialised — await initSchema() first');
  return _wrapped;
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    role        TEXT NOT NULL,
    phone       TEXT,
    avatar_url  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sites (
    id                   TEXT PRIMARY KEY,
    name                 TEXT NOT NULL,
    address              TEXT,
    latitude             REAL,
    longitude            REAL,
    manager_id           TEXT NOT NULL,
    owner_id             TEXT,
    target_stage         TEXT NOT NULL DEFAULT 'formwork_erected',
    status               TEXT NOT NULL DEFAULT 'active',
    start_date           TEXT,
    end_date             TEXT,
    reference_photo_url  TEXT,
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reports (
    id                TEXT PRIMARY KEY,
    site_id           TEXT NOT NULL,
    site_name         TEXT NOT NULL,
    submitted_by_id   TEXT NOT NULL,
    submitted_at      TEXT NOT NULL DEFAULT (datetime('now')),
    reported_stage    TEXT NOT NULL,
    section           TEXT NOT NULL DEFAULT 'general',
    status            TEXT NOT NULL DEFAULT 'pending',
    notes             TEXT,
    latitude          REAL,
    longitude         REAL,
    photo_urls        TEXT,
    ai_detected_stage     TEXT,
    ai_confidence         REAL,
    ai_all_scores         TEXT,
    ai_model_version      TEXT,
    ai_inference_ms       INTEGER,
    ai_observations       TEXT,
    progress_delta        REAL,
    progress_label        TEXT,
    progress_stagnant     INTEGER,
    compared_to_report_id TEXT,
    reference_similarity  REAL,
    reference_label       TEXT,
    upi_number            TEXT,
    reviewed_by_id    TEXT,
    reviewed_at       TEXT,
    rejection_reason  TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    type        TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT,
    report_id   TEXT,
    site_id     TEXT,
    is_read     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS site_workers (
    site_id      TEXT NOT NULL,
    worker_id    TEXT NOT NULL,
    assigned_by  TEXT,
    assigned_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (site_id, worker_id)
  );

  CREATE INDEX IF NOT EXISTS idx_reports_site    ON reports(site_id);
  CREATE INDEX IF NOT EXISTS idx_reports_worker  ON reports(submitted_by_id);
  CREATE INDEX IF NOT EXISTS idx_reports_status  ON reports(status);
  CREATE INDEX IF NOT EXISTS idx_notif_user      ON notifications(user_id);
  CREATE INDEX IF NOT EXISTS idx_sw_site         ON site_workers(site_id);
  CREATE INDEX IF NOT EXISTS idx_sw_worker       ON site_workers(worker_id);
`;

/** Run an ALTER TABLE statement, ignoring "duplicate column" errors for idempotency. */
function tryAlter(db, sql) {
  try { db.exec(sql); } catch (e) {
    if (!e.message?.includes('duplicate column')) throw e;
  }
}

async function initSchema() {
  const db = await getWrappedDb();
  db.exec(SCHEMA_SQL);

  // ── Migrations — safe to run on every startup ────────────────────────────
  tryAlter(db, 'ALTER TABLE sites ADD COLUMN reference_photo_url TEXT');
  tryAlter(db, 'ALTER TABLE reports ADD COLUMN reference_similarity REAL');
  tryAlter(db, 'ALTER TABLE reports ADD COLUMN reference_label TEXT');
  tryAlter(db, 'ALTER TABLE reports ADD COLUMN upi_number TEXT');
  tryAlter(db, "ALTER TABLE reports ADD COLUMN section TEXT NOT NULL DEFAULT 'general'");

  // Belt-and-suspenders: ensure site_workers exists even on older deployed schemas
  // that pre-date it being added to SCHEMA_SQL above.
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_workers (
      site_id      TEXT NOT NULL,
      worker_id    TEXT NOT NULL,
      assigned_by  TEXT,
      assigned_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (site_id, worker_id)
    );
    CREATE INDEX IF NOT EXISTS idx_sw_site   ON site_workers(site_id);
    CREATE INDEX IF NOT EXISTS idx_sw_worker ON site_workers(worker_id);
  `);

  console.log('[DB] Schema ready');
  return db;
}

module.exports = { initSchema, getDbSync, DB_FILE };

// Performance note: idx_reports_site and idx_reports_worker cover the
// most common query patterns. A composite index on (site_id, submitted_at)
// would further accelerate time-ordered site report feeds at higher data volume.

// Schema version tracking — bump when making breaking changes
// Current version: 2 (added reference_photo_url, section, progress fields)

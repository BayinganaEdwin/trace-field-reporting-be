/**
 * SiteLog Backend — Express + sql.js (SQLite WASM)
 * Start: npm start  |  Dev: npm run dev  |  Seed: npm run seed
 */

// Load .env file if present (copy .env.example to .env and add ANTHROPIC_API_KEY)
try { require('dotenv').config({ path: require('path').join(__dirname, '../.env') }); } catch (_) {}

const express    = require('express');
const cors       = require('cors');
const fileUpload = require('express-fileupload');
const path       = require('path');
const { initSchema } = require('./db/schema');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({ limits: { fileSize: 10 * 1024 * 1024 } }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Routes (registered after DB is ready)
function registerRoutes() {
  app.use('/users',         require('./routes/users'));
  app.use('/sites',         require('./routes/sites'));
  app.use('/reports',       require('./routes/reports'));
  app.use('/notifications', require('./routes/notifications'));
  app.use('/analytics',     require('./routes/analytics'));

  app.use((req, res) => res.status(404).json({ error: `No route: ${req.method} ${req.path}` }));
  app.use((err, req, res, next) => {
    console.error('[Error]', err.stack);
    res.status(500).json({ error: err.message });
  });
}

// Boot — init schema, then seed if the DB is empty (safe for ephemeral hosting)
async function boot() {
  await initSchema();

  const { getDbSync, DB_FILE } = require('./db/schema');
  const fs = require('fs');
  const db = getDbSync();
  const userCount = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  if (userCount === 0) {
    console.log('[SiteLog] Empty database — running seed...');
    // Inline seed to avoid a separate child process
    const { execSync } = require('child_process');
    execSync(`node ${require('path').join(__dirname, 'db/seed.js')}`, { stdio: 'inherit' });
  }

  registerRoutes();
  app.listen(PORT, () => {
    console.log(`[SiteLog API] Running on port ${PORT}`);
  });
}

boot().catch(err => {
  console.error('[Fatal] Boot failed:', err);
  process.exit(1);
});

module.exports = app;

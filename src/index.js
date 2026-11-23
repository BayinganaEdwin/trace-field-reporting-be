/**
 * SiteLog Backend — Express + sql.js (SQLite WASM)
 * Start: npm start  |  Dev: npm run dev  |  Seed: npm run seed
 */

// Load .env file if present (copy .env.example to .env and add ANTHROPIC_API_KEY)
try {
  require('dotenv').config({
    path: require('path').join(__dirname, '../.env'),
  });
} catch (_) {}

const express = require('express');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const { initSchema } = require('./db/schema');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({ limits: { fileSize: 10 * 1024 * 1024 } }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.get('/health', (req, res) =>
  res.json({ status: 'ok', time: new Date().toISOString() }),
);

// Swagger UI — http://localhost:3000/api-docs
app.use(
  '/api-docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'Trace API Docs',
  }),
);

function registerRoutes() {
  app.use('/users', require('./routes/users'));
  app.use('/sites', require('./routes/sites'));
  app.use('/reports', require('./routes/reports'));
  app.use('/notifications', require('./routes/notifications'));
  app.use('/analytics', require('./routes/analytics'));

  app.use((req, res) =>
    res.status(404).json({ error: `No route: ${req.method} ${req.path}` }),
  );
  app.use((err, req, res, next) => {
    console.error('[Error]', err.stack);
    res.status(500).json({ error: err.message });
  });
}

// Boot — init schema, then seed if the DB is empty (safe for ephemeral hosting)
async function boot() {
  await initSchema();

  const { getDbSync } = require('./db/schema');
  const db = getDbSync();
  const userCount = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  if (userCount === 0) {
    console.log('[SiteLog] Empty database — seeding demo data...');
    // Call seed inline so the same in-memory DB gets populated.
    // execSync would run a child process with its own DB singleton and the
    // parent would never see the inserted rows.
    const { seedDatabase } = require('./db/seed');
    await seedDatabase();
  }

  registerRoutes();
  app.listen(PORT, () => {
    console.log(`[Trace API] Running on port ${PORT}`);
  });
}

boot().catch((err) => {
  console.error('[Fatal] Boot failed:', err);
  process.exit(1);
});

module.exports = app;

// Version endpoint — useful for deployment health checks and report attribution
app.get('/version', (_req, res) =>
  res.json({ version: '1.0.0', model: 'mobilenetv2-v1', env: process.env.NODE_ENV || 'development' }),
);

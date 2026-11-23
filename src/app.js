/**
 * app.js — Express app factory (no listen / boot side-effects)
 * Used by tests via supertest, and imported by index.js for the real server.
 */
const express     = require('express');
const cors        = require('cors');
const fileUpload  = require('express-fileupload');
const path        = require('path');

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(fileUpload({ limits: { fileSize: 10 * 1024 * 1024 } }));
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

  app.get('/health', (_req, res) =>
    res.json({ status: 'ok', time: new Date().toISOString() }),
  );

  app.use('/users',         require('./routes/users'));
  app.use('/sites',         require('./routes/sites'));
  app.use('/reports',       require('./routes/reports'));
  app.use('/notifications', require('./routes/notifications'));
  app.use('/analytics',     require('./routes/analytics'));

  app.use((req, res) =>
    res.status(404).json({ error: `No route: ${req.method} ${req.path}` }),
  );
  app.use((err, _req, res, _next) => {
    console.error('[Error]', err.message);
    res.status(500).json({ error: err.message });
  });

  return app;
}

module.exports = { createApp };

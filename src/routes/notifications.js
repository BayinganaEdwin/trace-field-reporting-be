const express = require('express');
const router  = express.Router();
const { v4: uuid } = require('uuid');
const { getDbSync: getDb } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

// GET /notifications — current user's notifications
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM notifications WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 50
  `).all(req.user.id);
  res.json(rows);
});

// POST /notifications/:id/read
router.post('/:id/read', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare(`
    UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?
  `).run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// POST /notifications/read-all
router.post('/read-all', requireAuth, (req, res) => {
  getDb().prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

module.exports = router;

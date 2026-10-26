const express = require('express');
const router = express.Router();
const { getDbSync: getDb } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

// GET /users/me  — current user profile
router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// GET /users/:id
router.get('/:id', requireAuth, (req, res) => {
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// PATCH /users/me  — update profile
router.patch('/me', requireAuth, (req, res) => {
  const { name, phone } = req.body;
  const db = getDb();
  db.prepare(`
    UPDATE users SET name = COALESCE(?, name), phone = COALESCE(?, phone),
                     updated_at = datetime('now')
    WHERE id = ?
  `).run(name ?? null, phone ?? null, req.user.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json(updated);
});

module.exports = router;

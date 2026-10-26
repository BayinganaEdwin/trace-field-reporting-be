const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const { getDbSync: getDb } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

// POST /users/register — create a new user account (prototype: no password hashing)
router.post('/register', (req, res) => {
  const { name, email, role, phone } = req.body;
  if (!name || !email || !role) {
    return res.status(400).json({ error: 'name, email and role are required' });
  }
  if (!['worker', 'manager'].includes(role)) {
    return res.status(400).json({ error: 'role must be worker or manager' });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const id = `user-${uuid().slice(0, 8)}`;
  db.prepare('INSERT INTO users (id, name, email, role, phone) VALUES (?, ?, ?, ?, ?)')
    .run(id, name.trim(), email.toLowerCase().trim(), role, phone ?? null);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.status(201).json(user);
});

// POST /users/login — look up a user by email (prototype: no real password check)
router.post('/login', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim());
  if (!user) {
    return res.status(401).json({ error: 'No account found for this email' });
  }
  res.json(user);
});

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

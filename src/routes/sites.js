const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const { getDbSync: getDb } = require('../db/schema');
const { requireAuth, requireRole } = require('../middleware/auth');

// ── Helpers ───────────────────────────────────────────────────────────────────
function enrichSite(site, db) {
  const reports = db.prepare('SELECT * FROM reports WHERE site_id = ?').all(site.id);
  const totalReports   = reports.length;
  const approvedCount  = reports.filter(r => r.status === 'approved').length;
  const flaggedCount   = reports.filter(r => r.status === 'flagged').length;
  const pendingCount   = reports.filter(r => r.status === 'pending' || r.status === 'verified').length;

  // REI: composite score 0–100
  const reviewable = reports.filter(r => !['uploading','pending'].includes(r.status)).length;
  const rei = reviewable > 0 ? Math.round((approvedCount / reviewable) * 100) : 0;

  // Current stage = most recent approved report's stage
  const lastApproved = reports
    .filter(r => r.status === 'approved')
    .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))[0];
  const currentStage = lastApproved?.reported_stage ?? null;

  return { ...site, totalReports, approvedCount, flaggedCount, pendingCount, rei, currentStage };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /sites — list all active sites (all roles see all sites)
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const sites = db.prepare('SELECT * FROM sites ORDER BY created_at DESC').all();
  res.json(sites.map(s => enrichSite(s, db)));
});

// GET /sites/:id
router.get('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(req.params.id);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  res.json(enrichSite(site, db));
});

// POST /sites — manager or owner creates a site
router.post('/', requireAuth, requireRole('manager', 'owner'), (req, res) => {
  const { name, address, latitude, longitude, target_stage, start_date, owner_id } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const db = getDb();
  const id = `site-${uuid().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO sites (id, name, address, latitude, longitude, manager_id, owner_id,
                       target_stage, start_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name, address ?? null, latitude ?? null, longitude ?? null,
    req.user.id, owner_id ?? null, target_stage ?? 'formwork_erected', start_date ?? null
  );

  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(id);
  res.status(201).json(enrichSite(site, db));
});

// PATCH /sites/:id — update site metadata
router.patch('/:id', requireAuth, requireRole('manager', 'owner'), (req, res) => {
  const { name, address, target_stage, status } = req.body;
  const db = getDb();
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(req.params.id);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  db.prepare(`
    UPDATE sites
    SET name = COALESCE(?, name),
        address = COALESCE(?, address),
        target_stage = COALESCE(?, target_stage),
        status = COALESCE(?, status),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(name ?? null, address ?? null, target_stage ?? null, status ?? null, req.params.id);

  const updated = db.prepare('SELECT * FROM sites WHERE id = ?').get(req.params.id);
  res.json(enrichSite(updated, db));
});

// DELETE /sites/:id — manager or owner deletes a site
router.delete('/:id', requireAuth, requireRole('manager', 'owner'), (req, res) => {
  const db = getDb();
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(req.params.id);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  db.prepare('DELETE FROM sites WHERE id = ?').run(req.params.id);
  res.json({ deleted: true, id: req.params.id });
});

module.exports = router;

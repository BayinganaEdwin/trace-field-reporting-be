const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const { getDbSync: getDb } = require('../db/schema');
const { requireAuth, requireRole } = require('../middleware/auth');

// ── Helpers ───────────────────────────────────────────────────────────────────

function enrichSite(site, db) {
  const reports = db.prepare('SELECT * FROM reports WHERE site_id = ?').all(site.id);
  const totalReports  = reports.length;
  const approvedCount = reports.filter(r => r.status === 'approved').length;
  const flaggedCount  = reports.filter(r => r.status === 'flagged').length;
  const pendingCount  = reports.filter(r => r.status === 'pending' || r.status === 'verified').length;

  // REI: composite score 0–100
  const reviewable = reports.filter(r => !['uploading', 'pending'].includes(r.status)).length;
  const rei = reviewable > 0 ? Math.round((approvedCount / reviewable) * 100) : 0;

  // Current stage = most recent approved report's stage
  const lastApproved = reports
    .filter(r => r.status === 'approved')
    .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))[0];
  const currentStage = lastApproved?.reported_stage ?? null;

  // Actual worker count from junction table
  const workerCountRow = db.prepare(
    'SELECT COUNT(*) as count FROM site_workers WHERE site_id = ?'
  ).get(site.id);
  const workerCount = workerCountRow?.count ?? 0;

  return { ...site, totalReports, approvedCount, flaggedCount, pendingCount, rei, currentStage, workerCount };
}

// ── GET /sites — authenticated, role-based ────────────────────────────────────
// Workers see only sites they are assigned to via site_workers.
// Managers see all sites where manager_id = their user id.
// Owners see all sites where owner_id = their user id.
router.get('/', requireAuth, (req, res) => {
  const db   = getDb();
  const user = req.user;
  let sites;

  if (user.role === 'worker') {
    sites = db.prepare(`
      SELECT s.* FROM sites s
      INNER JOIN site_workers sw ON sw.site_id = s.id
      WHERE sw.worker_id = ?
      ORDER BY s.created_at DESC
    `).all(user.id);
  } else if (user.role === 'manager') {
    sites = db.prepare(
      'SELECT * FROM sites WHERE manager_id = ? ORDER BY created_at DESC'
    ).all(user.id);
  } else if (user.role === 'owner') {
    sites = db.prepare(
      'SELECT * FROM sites WHERE owner_id = ? ORDER BY created_at DESC'
    ).all(user.id);
  } else {
    return res.status(403).json({ error: 'Unknown role' });
  }

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

// ── Worker assignment routes (manager only) ───────────────────────────────────

// GET /sites/:id/workers — list workers assigned to this site
router.get('/:id/workers', requireAuth, requireRole('manager', 'owner'), (req, res) => {
  const db = getDb();
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(req.params.id);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const workers = db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, sw.assigned_at, sw.assigned_by
    FROM site_workers sw
    INNER JOIN users u ON u.id = sw.worker_id
    WHERE sw.site_id = ?
    ORDER BY sw.assigned_at ASC
  `).all(req.params.id);

  res.json(workers);
});

// POST /sites/:id/workers — assign a worker to this site
router.post('/:id/workers', requireAuth, requireRole('manager'), (req, res) => {
  const { workerId } = req.body;
  if (!workerId) return res.status(400).json({ error: 'workerId is required' });

  const db = getDb();
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(req.params.id);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const worker = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(workerId, 'worker');
  if (!worker) return res.status(404).json({ error: 'Worker not found' });

  // Check not already assigned
  const existing = db.prepare(
    'SELECT 1 FROM site_workers WHERE site_id = ? AND worker_id = ?'
  ).get(req.params.id, workerId);
  if (existing) return res.status(409).json({ error: 'Worker already assigned to this site' });

  db.prepare(`
    INSERT INTO site_workers (site_id, worker_id, assigned_by)
    VALUES (?, ?, ?)
  `).run(req.params.id, workerId, req.user.id);

  res.status(201).json({
    siteId: req.params.id,
    workerId,
    assignedBy: req.user.id,
    workerName: worker.name,
  });
});

// DELETE /sites/:id/workers/:workerId — unassign a worker from this site
router.delete('/:id/workers/:workerId', requireAuth, requireRole('manager'), (req, res) => {
  const { id: siteId, workerId } = req.params;
  const db = getDb();

  const existing = db.prepare(
    'SELECT 1 FROM site_workers WHERE site_id = ? AND worker_id = ?'
  ).get(siteId, workerId);
  if (!existing) return res.status(404).json({ error: 'Assignment not found' });

  db.prepare('DELETE FROM site_workers WHERE site_id = ? AND worker_id = ?').run(siteId, workerId);
  res.json({ deleted: true, siteId, workerId });
});

// GET /sites/:id/available-workers — workers NOT yet assigned to this site (for "Add Worker" picker)
router.get('/:id/available-workers', requireAuth, requireRole('manager'), (req, res) => {
  const db = getDb();
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(req.params.id);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const workers = db.prepare(`
    SELECT u.id, u.name, u.email, u.phone
    FROM users u
    WHERE u.role = 'worker'
      AND u.id NOT IN (
        SELECT worker_id FROM site_workers WHERE site_id = ?
      )
    ORDER BY u.name ASC
  `).all(req.params.id);

  res.json(workers);
});

module.exports = router;

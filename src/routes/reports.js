const express  = require('express');
const router   = express.Router();
const path     = require('path');
const fs       = require('fs');
const { v4: uuid } = require('uuid');
const fetch    = require('node-fetch');
const FormData = require('form-data');
const { getDbSync: getDb } = require('../db/schema');
const { requireAuth, requireRole } = require('../middleware/auth');
const { verifyWithClaude } = require('../services/claudeVerify');

const INFERENCE_URL = process.env.INFERENCE_URL || 'http://localhost:5001';
const UPLOAD_DIR    = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────
function parsePhotoUrls(str) {
  try { return JSON.parse(str || '[]'); } catch { return []; }
}

function rowToReport(row) {
  if (!row) return null;
  return {
    ...row,
    photo_urls:   parsePhotoUrls(row.photo_urls),
    ai_all_scores: row.ai_all_scores ? JSON.parse(row.ai_all_scores) : null,
  };
}

/** Call the Python MobileNetV2 inference server (secondary fallback). */
async function callPythonInference(imageBuffer, mimetype) {
  try {
    const form = new FormData();
    form.append('image', imageBuffer, { filename: 'photo.jpg', contentType: mimetype });
    const res = await fetch(`${INFERENCE_URL}/predict`, { method: 'POST', body: form, timeout: 15000 });
    if (!res.ok) throw new Error(`Inference HTTP ${res.status}`);
    const data = await res.json();
    // Reject if Python server is in dummy/random mode
    if (data.modelVersion === 'dummy-random') {
      console.warn('[Inference] Python server returned random dummy scores — ignoring');
      return null;
    }
    return data;
  } catch (err) {
    console.warn('[Inference] Python server unavailable:', err.message);
    return null;
  }
}

/**
 * Run AI verification with priority:
 *   1. Python MobileNetV2 server (your trained model — primary)
 *   2. Claude vision (optional fallback if ANTHROPIC_API_KEY is set and Python server is down)
 *   3. null (report stays 'pending' — never returns random scores)
 */
async function runVerification(imageBuffer, mimetype, reportedStage) {
  // 1. Try the trained MobileNetV2 model (Python inference server)
  const python = await callPythonInference(imageBuffer, mimetype);
  if (python !== null) {
    console.log(`[AI] MobileNetV2 → isConstruction=${python.isConstructionSite}, ` +
      `stage=${python.detectedStage}, confidence=${(python.confidenceScore * 100).toFixed(0)}%`);
    return python;
  }

  // 2. Fall back to Claude vision if API key is configured
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('[AI] Python server unavailable — falling back to Claude vision');
    const claude = await verifyWithClaude(imageBuffer, mimetype, reportedStage);
    if (claude !== null) {
      console.log(`[AI] Claude vision → isConstruction=${claude.isConstructionSite}, ` +
        `stage=${claude.detectedStage}, confidence=${(claude.confidenceScore * 100).toFixed(0)}%`);
      return claude;
    }
  }

  // 3. No AI available — report stays 'pending'
  console.log('[AI] No verification service available — report will stay pending');
  return null;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /reports — list reports
// Query: ?siteId=  ?status=  ?workerId=  ?limit=  ?offset=
router.get('/', requireAuth, (req, res) => {
  const { siteId, status, workerId, limit = 50, offset = 0 } = req.query;
  const db = getDb();

  let sql = 'SELECT * FROM reports WHERE 1=1';
  const params = [];

  if (req.user.role === 'worker') {
    sql += ' AND submitted_by_id = ?';
    params.push(req.user.id);
  }
  if (siteId)   { sql += ' AND site_id = ?';          params.push(siteId); }
  if (status)   { sql += ' AND status = ?';            params.push(status); }
  if (workerId && req.user.role !== 'worker') {
                  sql += ' AND submitted_by_id = ?';   params.push(workerId); }

  sql += ' ORDER BY submitted_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(rowToReport));
});

// GET /reports/:id
router.get('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Report not found' });
  // Worker can only see own reports
  if (req.user.role === 'worker' && row.submitted_by_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your report' });
  }
  res.json(rowToReport(row));
});

// POST /reports — worker submits a new report
// Accepts multipart/form-data with optional "photo" file
router.post('/', requireAuth, requireRole('worker'), async (req, res) => {
  const { site_id, reported_stage, notes, latitude, longitude } = req.body;

  if (!site_id || !reported_stage) {
    return res.status(400).json({ error: 'site_id and reported_stage are required' });
  }

  const db = getDb();
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(site_id);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const reportId = `report-${uuid().slice(0, 8)}`;
  const photoUrls = [];

  // ── Save uploaded photo ───────────────────────────────────────────────────
  let imageBuffer = null;
  let imageMimetype = 'image/jpeg';

  if (req.files && req.files.photo) {
    const file = req.files.photo;
    const ext  = path.extname(file.name) || '.jpg';
    const filename = `${reportId}${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);
    await file.mv(filepath);
    photoUrls.push(`/uploads/${filename}`);
    imageBuffer  = fs.readFileSync(filepath);
    imageMimetype = file.mimetype;
  }

  // ── Create report as pending ──────────────────────────────────────────────
  db.prepare(`
    INSERT INTO reports (id, site_id, site_name, submitted_by_id, reported_stage, status,
                         notes, latitude, longitude, photo_urls)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `).run(
    reportId, site_id, site.name, req.user.id, reported_stage,
    notes ?? null, latitude ?? null, longitude ?? null,
    JSON.stringify(photoUrls)
  );

  // ── Run AI verification async (does not block the 201 response) ─────────
  if (imageBuffer) {
    runVerification(imageBuffer, imageMimetype, reported_stage).then(ai => {
      if (!ai) return; // No AI available — report stays 'pending', no fake data written

      // Determine status from AI result:
      //   flagged  → not a construction site, OR stage mismatch (model disagrees with worker)
      //   verified → construction site confirmed AND detected stage matches reported stage
      const stageMatches = ai.detectedStage === reported_stage;

      const observations = ai.observations
        ?? (ai.isConstructionSite === false
          ? 'Image does not appear to show a construction site.'
          : !stageMatches
            ? `Stage mismatch: worker reported "${reported_stage}" but model detected "${ai.detectedStage}" with ${Math.round(ai.confidenceScore * 100)}% confidence.`
            : `AI confirmed "${ai.detectedStage}" with ${Math.round(ai.confidenceScore * 100)}% confidence.`);
      const newStatus =
        !ai.isConstructionSite || ai.detectedStage === null ? 'flagged'   // not a construction site
        : stageMatches                                       ? 'verified'  // stage confirmed
        :                                                      'flagged';  // stage mismatch

      db.prepare(`
        UPDATE reports
        SET ai_detected_stage = ?, ai_confidence = ?, ai_all_scores = ?,
            ai_model_version = ?, ai_inference_ms = ?, ai_observations = ?,
            status = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        ai.detectedStage ?? null,
        ai.confidenceScore ?? 0,
        JSON.stringify(ai.allScores ?? {}),
        ai.modelVersion ?? 'claude-haiku-vision',
        ai.inferenceMs ?? 0,
        observations,
        newStatus,
        reportId
      );
      console.log(`[AI] report ${reportId} → status=${newStatus}, ` +
        `stage=${ai.detectedStage}, confidence=${Math.round((ai.confidenceScore ?? 0) * 100)}%`);
    }).catch(err => {
      console.error('[AI] Verification error:', err.message);
    });
  }

  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
  res.status(201).json(rowToReport(report));
});

// POST /reports/:id/approve — manager approves a report
router.post('/:id/approve', requireAuth, requireRole('manager', 'owner'), (req, res) => {
  const db = getDb();
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  if (!['pending','verified','flagged'].includes(report.status)) {
    return res.status(409).json({ error: `Cannot approve a ${report.status} report` });
  }

  const { comment } = req.body;
  db.prepare(`
    UPDATE reports
    SET status = 'approved', reviewed_by_id = ?, reviewed_at = datetime('now'),
        notes = CASE WHEN ? IS NOT NULL THEN ? ELSE notes END,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(req.user.id, comment ?? null, comment ? `[Approved] ${comment}` : null, req.params.id);

  res.json(rowToReport(db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id)));
});

// POST /reports/:id/reject — manager rejects with required comment
router.post('/:id/reject', requireAuth, requireRole('manager', 'owner'), (req, res) => {
  const { comment } = req.body;
  if (!comment || comment.trim().length < 3) {
    return res.status(400).json({ error: 'A comment is required when rejecting a report' });
  }

  const db = getDb();
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  if (!['pending','verified','flagged'].includes(report.status)) {
    return res.status(409).json({ error: `Cannot reject a ${report.status} report` });
  }

  db.prepare(`
    UPDATE reports
    SET status = 'rejected', reviewed_by_id = ?, reviewed_at = datetime('now'),
        notes = ?, rejection_reason = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(req.user.id, `[Rejected] ${comment}`, comment, req.params.id);

  res.json(rowToReport(db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id)));
});

// POST /reports/:id/flag — manager flags for follow-up
router.post('/:id/flag', requireAuth, requireRole('manager', 'owner'), (req, res) => {
  const { comment } = req.body;
  const db = getDb();
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found' });

  db.prepare(`
    UPDATE reports
    SET status = 'flagged', reviewed_by_id = ?, reviewed_at = datetime('now'),
        notes = CASE WHEN ? IS NOT NULL THEN ? ELSE notes END,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(req.user.id, comment ?? null, comment ? `[Flagged] ${comment}` : null, req.params.id);

  res.json(rowToReport(db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id)));
});

// DELETE /reports/:id — worker deletes their own report (only if not yet approved/rejected)
router.delete('/:id', requireAuth, requireRole('worker'), (req, res) => {
  const db = getDb();
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found' });

  // Workers can only delete their own reports
  if (report.submitted_by_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only delete your own reports' });
  }

  // Cannot delete once a manager has made a final decision
  if (['approved', 'rejected'].includes(report.status)) {
    return res.status(409).json({
      error: `Cannot delete a report that has already been ${report.status}`,
    });
  }

  db.prepare('DELETE FROM reports WHERE id = ?').run(req.params.id);
  res.json({ deleted: true, id: req.params.id });
});

module.exports = router;

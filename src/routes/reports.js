const express  = require('express');
const router   = express.Router();
const path     = require('path');
const fs       = require('fs');
const { v4: uuid } = require('uuid');
const fetch    = require('node-fetch');
const FormData = require('form-data');
const { getDbSync: getDb } = require('../db/schema');
const { requireAuth, requireRole } = require('../middleware/auth');

const INFERENCE_URL = process.env.INFERENCE_URL || 'http://localhost:5001';
const UPLOAD_DIR    = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────
function parsePhotoUrls(str) {
  try { return JSON.parse(str || '[]'); } catch { return []; }
}

/**
 * SQLite datetime('now') returns 'YYYY-MM-DD HH:MM:SS' — UTC but with no Z marker.
 * Append 'Z' so JavaScript clients parse it correctly as UTC and convert to local time.
 */
function toIso(ts) {
  if (!ts) return ts;
  return ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
}

function rowToReport(row) {
  if (!row) return null;
  return {
    ...row,
    submitted_at:         toIso(row.submitted_at),
    reviewed_at:          toIso(row.reviewed_at),
    updated_at:           toIso(row.updated_at),
    photo_urls:           parsePhotoUrls(row.photo_urls),
    ai_all_scores:        row.ai_all_scores ? JSON.parse(row.ai_all_scores) : null,
    progress_stagnant:    row.progress_stagnant === 1,
    reference_similarity: row.reference_similarity ?? null,
    reference_label:      row.reference_label ?? null,
    upi_number:           row.upi_number ?? null,
    submitted_by_name:    row.submitted_by_name ?? row.submitted_by_id,
  };
}

async function callInference(imageBuffer, mimetype) {
  try {
    const form = new FormData();
    form.append('image', imageBuffer, { filename: 'photo.jpg', contentType: mimetype });
    const res = await fetch(`${INFERENCE_URL}/predict`, { method: 'POST', body: form, timeout: 15000 });
    if (!res.ok) throw new Error(`Inference HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[Inference] Failed:', err.message, '— returning null');
    return null;
  }
}

// Sections that support progress tracking via image comparison
const TRACKED_SECTIONS = ['beams_columns'];

async function callCompare(bufferA, bufferB, mimetype) {
  try {
    const form = new FormData();
    form.append('image_a', bufferA, { filename: 'prev.jpg', contentType: mimetype });
    form.append('image_b', bufferB, { filename: 'curr.jpg', contentType: mimetype });
    const res = await fetch(`${INFERENCE_URL}/compare`, { method: 'POST', body: form, timeout: 20000 });
    if (!res.ok) throw new Error(`Compare HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[Compare] Failed:', err.message, '— skipping progress delta');
    return null;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /reports — list reports
// Query: ?siteId=  ?status=  ?workerId=  ?limit=  ?offset=
router.get('/', requireAuth, (req, res) => {
  const { siteId, status, workerId, limit = 50, offset = 0 } = req.query;
  const db = getDb();

  let sql = 'SELECT r.*, u.name AS submitted_by_name FROM reports r LEFT JOIN users u ON r.submitted_by_id = u.id WHERE 1=1';
  const params = [];

  if (req.user.role === 'worker') {
    sql += ' AND r.submitted_by_id = ?';
    params.push(req.user.id);
  }
  if (siteId)   { sql += ' AND r.site_id = ?';          params.push(siteId); }
  if (status)   { sql += ' AND r.status = ?';            params.push(status); }
  if (workerId && req.user.role !== 'worker') {
                  sql += ' AND r.submitted_by_id = ?';   params.push(workerId); }

  sql += ' ORDER BY submitted_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(rowToReport));
});

// GET /reports/:id
router.get('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const row = db.prepare(
    'SELECT r.*, u.name AS submitted_by_name FROM reports r LEFT JOIN users u ON r.submitted_by_id = u.id WHERE r.id = ?'
  ).get(req.params.id);
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
  const { site_id, reported_stage, section = 'general', notes, latitude, longitude, upi_number } = req.body;

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
  let savedFilepath = null;

  if (req.files && req.files.photo) {
    const file = req.files.photo;
    const ext  = path.extname(file.name) || '.jpg';
    const filename = `${reportId}${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);
    await file.mv(filepath);
    photoUrls.push(`/uploads/${filename}`);
    imageBuffer   = fs.readFileSync(filepath);
    imageMimetype = file.mimetype;
    savedFilepath = filepath;
  }

  // ── Create report as pending ──────────────────────────────────────────────
  db.prepare(`
    INSERT INTO reports (id, site_id, site_name, submitted_by_id, reported_stage, section, status,
                         notes, latitude, longitude, photo_urls, upi_number)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
  `).run(
    reportId, site_id, site.name, req.user.id, reported_stage, section,
    notes ?? null, latitude ?? null, longitude ?? null,
    JSON.stringify(photoUrls), upi_number ?? null
  );

  // ── Async AI pipeline (doesn't block the 201 response) ───────────────────
  if (imageBuffer) {
    (async () => {
      // 1. Classification — what stage is this photo?
      const ai = await callInference(imageBuffer, imageMimetype);
      if (ai) {
        // Flag when: (a) not a construction image, or (b) detected stage doesn't match reported stage
        const isNotConstruction = !ai.detectedStage || ai.detectedStage === 'not_construction';
        const isMismatch        = !isNotConstruction && ai.detectedStage !== reported_stage;
        const aiStatus          = (isNotConstruction || isMismatch) ? 'flagged' : 'verified';

        const observation = isNotConstruction
          ? `AI could not identify a construction stage in this photo — manual review required.`
          : isMismatch
            ? `AI detected ${ai.detectedStage} but worker reported ${reported_stage} — stage mismatch.`
            : `AI detected ${ai.detectedStage} with ${Math.round(ai.confidenceScore * 100)}% confidence.`;

        db.prepare(`
          UPDATE reports
          SET ai_detected_stage = ?, ai_confidence = ?, ai_all_scores = ?,
              ai_model_version = ?, ai_inference_ms = ?, ai_observations = ?,
              status = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(
          ai.detectedStage, ai.confidenceScore, JSON.stringify(ai.allScores),
          ai.modelVersion || 'mobilenetv2-v1', ai.inferenceMs || 0,
          observation, aiStatus,
          reportId
        );
        console.log(`[AI] report ${reportId} → ${ai.detectedStage} (${(ai.confidenceScore*100).toFixed(0)}%) status=${aiStatus}`);
      }

      // 2. Progress comparison — only for tracked sections (beams & columns)
      if (TRACKED_SECTIONS.includes(section) && savedFilepath) {
        // Find the most recent approved or verified report for the same site + section
        const prevReport = db.prepare(`
          SELECT * FROM reports
          WHERE site_id = ? AND section = ? AND id != ?
            AND status IN ('approved', 'verified')
            AND photo_urls != '[]' AND photo_urls IS NOT NULL
          ORDER BY submitted_at DESC
          LIMIT 1
        `).get(site_id, section, reportId);

        if (prevReport) {
          const prevPhotoUrls = parsePhotoUrls(prevReport.photo_urls);
          if (prevPhotoUrls.length > 0) {
            // Resolve path from the URL stored in DB (/uploads/filename)
            const prevFilename = path.basename(prevPhotoUrls[0]);
            const prevFilepath = path.join(UPLOAD_DIR, prevFilename);

            if (fs.existsSync(prevFilepath)) {
              const prevBuffer = fs.readFileSync(prevFilepath);
              const cmp = await callCompare(prevBuffer, imageBuffer, imageMimetype);

              if (cmp) {
                db.prepare(`
                  UPDATE reports
                  SET progress_delta = ?, progress_label = ?, progress_stagnant = ?,
                      compared_to_report_id = ?, updated_at = datetime('now')
                  WHERE id = ?
                `).run(
                  cmp.progressDelta, cmp.progressLabel,
                  cmp.stagnant ? 1 : 0,
                  prevReport.id,
                  reportId
                );

                // Auto-flag if stagnant (no visible progress vs last report)
                if (cmp.stagnant) {
                  db.prepare(`
                    UPDATE reports SET status = 'flagged', updated_at = datetime('now')
                    WHERE id = ?
                  `).run(reportId);
                  console.log(`[Compare] report ${reportId} STAGNANT — auto-flagged`);
                } else {
                  console.log(`[Compare] report ${reportId} delta=${cmp.progressDelta} — ${cmp.progressLabel}`);
                }
              }
            }
          }
        } else {
          // First report for this section — no previous to compare against
          console.log(`[Compare] report ${reportId} — first ${section} report for site ${site_id}, no comparison`);
        }
      }

      // 3. Reference comparison — compare against site's design reference image (any section)
      if (site.reference_photo_url) {
        const refFilename = path.basename(site.reference_photo_url);
        const refFilepath = path.join(UPLOAD_DIR, refFilename);

        if (fs.existsSync(refFilepath)) {
          const refBuffer = fs.readFileSync(refFilepath);
          const ref = await callCompare(refBuffer, imageBuffer, imageMimetype);

          if (ref) {
            // Use similarityScore (0–1, higher = more similar to reference)
            const similarity = ref.similarityScore ?? (1 - ref.progressDelta);
            const refLabel =
              similarity >= 0.85 ? 'Strong match to reference design' :
              similarity >= 0.65 ? 'Moderate match to reference design' :
              similarity >= 0.40 ? 'Partial match to reference design' :
                                   'Low match to reference design';

            db.prepare(`
              UPDATE reports
              SET reference_similarity = ?, reference_label = ?, updated_at = datetime('now')
              WHERE id = ?
            `).run(similarity, refLabel, reportId);

            console.log(`[Reference] report ${reportId} similarity=${similarity.toFixed(2)} — ${refLabel}`);
          }
        }
      }
    })();
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

module.exports = router;

// Valid construction stages accepted in the reported_stage field
const VALID_STAGES = [
  'formwork_erected', 'reinforcement_placed',
  'concrete_poured',  'structure_complete',
];

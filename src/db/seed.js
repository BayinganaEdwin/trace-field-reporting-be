/**
 * Seed demo data
 * Run: node src/db/seed.js
 *
 * Default sites (site-default-1, site-default-2) are created by initSchema() with
 * a 'system' placeholder. This script reassigns them to the demo manager/owner
 * and assigns workers via the site_workers junction table.
 *
 * Worker assignments:
 *   site-default-1  (Kacyiru Housing Block A)    → Amara (w1), Jean (w2)
 *   site-default-2  (Kimironko Commercial Plaza)  → Jean (w2), Grace (w3)
 *   site-nyarutarama-1 (Nyarutarama Office Tower) → Amara (w1), Grace (w3)
 *   site-gisozi-1   (Gisozi Residential Estate)   → Jean (w2)
 *   site-remera-1   (Remera Mixed-Use Development) → Amara (w1), Grace (w3)
 */
const { v4: uuid } = require('uuid');
const { initSchema, getDbSync, DB_FILE } = require('./schema');
const fs = require('fs');

async function main() {
  if (fs.existsSync(DB_FILE)) { fs.unlinkSync(DB_FILE); console.log('[Seed] Removed old database'); }

  await initSchema();
  const db = getDbSync();

  // ── Users ─────────────────────────────────────────────────────────────────
  const users = [
    { id: 'user-worker-1',  name: 'Amara Diallo',     email: 'amara@sitelog.rw',    role: 'worker',  phone: '+250789001001' },
    { id: 'user-worker-2',  name: 'Jean Mugisha',      email: 'jean@sitelog.rw',     role: 'worker',  phone: '+250789001002' },
    { id: 'user-worker-3',  name: 'Grace Uwimana',     email: 'grace@sitelog.rw',    role: 'worker',  phone: '+250789001003' },
    { id: 'user-manager-1', name: 'Fatima Nkusi',      email: 'fatima@sitelog.rw',   role: 'manager', phone: '+250789002001' },
    { id: 'user-owner-1',   name: 'Patrick Habimana',  email: 'patrick@sitelog.rw',  role: 'owner',   phone: '+250789003001' },
  ];
  for (const u of users) {
    db.prepare(`INSERT INTO users (id, name, email, role, phone) VALUES (?, ?, ?, ?, ?)`)
      .run(u.id, u.name, u.email, u.role, u.phone);
  }
  console.log(`[Seed] ${users.length} users`);

  // ── Reassign default sites to demo manager/owner ──────────────────────────
  // initSchema() created these with manager_id = 'system'. Assign to real users.
  db.prepare(`
    UPDATE sites SET manager_id = ?, owner_id = ?, updated_at = datetime('now')
    WHERE id IN ('site-default-1', 'site-default-2')
  `).run('user-manager-1', 'user-owner-1');

  // ── Additional demo sites (3 more beyond the 2 defaults) ──────────────────
  const extraSites = [
    {
      id: 'site-nyarutarama-1',
      name: 'Nyarutarama Office Tower',
      address: 'KG 2 Rd, Nyarutarama, Kigali',
      lat: -1.9212, lng: 30.1100,
      targetStage: 'structure_complete',
      startDate: '2024-10-01',
    },
    {
      id: 'site-gisozi-1',
      name: 'Gisozi Residential Estate',
      address: 'KG 1 Ave, Gisozi, Kigali',
      lat: -1.9100, lng: 30.0700,
      targetStage: 'reinforcement_placed',
      startDate: '2025-01-10',
    },
    {
      id: 'site-remera-1',
      name: 'Remera Mixed-Use Development',
      address: 'KG 11 Ave, Remera, Kigali',
      lat: -1.9550, lng: 30.1200,
      targetStage: 'concrete_poured',
      startDate: '2024-11-20',
    },
  ];

  for (const s of extraSites) {
    db.prepare(`
      INSERT INTO sites (id, name, address, latitude, longitude, manager_id, owner_id, target_stage, start_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(s.id, s.name, s.address, s.lat, s.lng, 'user-manager-1', 'user-owner-1', s.targetStage, s.startDate);
  }
  console.log(`[Seed] 2 default + ${extraSites.length} extra sites (5 total)`);

  // ── Worker assignments (site_workers junction table) ──────────────────────
  // Each worker is assigned to specific sites — not all sites.
  const assignments = [
    { siteId: 'site-default-1',      workerId: 'user-worker-1' }, // Amara → Kacyiru
    { siteId: 'site-default-1',      workerId: 'user-worker-2' }, // Jean  → Kacyiru
    { siteId: 'site-default-2',      workerId: 'user-worker-2' }, // Jean  → Kimironko
    { siteId: 'site-default-2',      workerId: 'user-worker-3' }, // Grace → Kimironko
    { siteId: 'site-nyarutarama-1',  workerId: 'user-worker-1' }, // Amara → Nyarutarama
    { siteId: 'site-nyarutarama-1',  workerId: 'user-worker-3' }, // Grace → Nyarutarama
    { siteId: 'site-gisozi-1',       workerId: 'user-worker-2' }, // Jean  → Gisozi
    { siteId: 'site-remera-1',       workerId: 'user-worker-1' }, // Amara → Remera
    { siteId: 'site-remera-1',       workerId: 'user-worker-3' }, // Grace → Remera
  ];

  for (const a of assignments) {
    db.prepare(`
      INSERT OR IGNORE INTO site_workers (site_id, worker_id, assigned_by)
      VALUES (?, ?, ?)
    `).run(a.siteId, a.workerId, 'user-manager-1');
  }
  console.log(`[Seed] ${assignments.length} worker-site assignments`);

  // ── Reports ───────────────────────────────────────────────────────────────
  const now = new Date();
  function daysAgo(n) {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return d.toISOString();
  }

  const aiStages = ['formwork_erected', 'reinforcement_placed', 'concrete_poured', 'structure_complete'];

  function fakeAi(stage) {
    const match = Math.random() > 0.15;
    const det = match ? stage : aiStages[Math.floor(Math.random() * 4)];
    const conf = parseFloat((match ? 0.78 + Math.random() * 0.20 : 0.40 + Math.random() * 0.35).toFixed(3));
    const scores = {};
    let rem = 1 - conf;
    aiStages.forEach((s, i) => {
      if (s === det) { scores[s] = conf; return; }
      const v = i < aiStages.length - 2
        ? parseFloat((rem * Math.random()).toFixed(3))
        : parseFloat(rem.toFixed(3));
      scores[s] = Math.max(0, v);
      rem -= v;
    });
    return { det, conf, scores };
  }

  const rpts = [
    // Kacyiru Housing Block A (default-1) — Amara (w1) + Jean (w2)
    { sid: 'site-default-1', sname: 'Kacyiru Housing Block A',     wid: 'user-worker-1', stage: 'formwork_erected',    status: 'approved', da: 30 },
    { sid: 'site-default-1', sname: 'Kacyiru Housing Block A',     wid: 'user-worker-2', stage: 'formwork_erected',    status: 'approved', da: 25 },
    { sid: 'site-default-1', sname: 'Kacyiru Housing Block A',     wid: 'user-worker-1', stage: 'reinforcement_placed', status: 'approved', da: 18 },
    { sid: 'site-default-1', sname: 'Kacyiru Housing Block A',     wid: 'user-worker-2', stage: 'reinforcement_placed', status: 'approved', da: 14 },
    { sid: 'site-default-1', sname: 'Kacyiru Housing Block A',     wid: 'user-worker-1', stage: 'concrete_poured',     status: 'approved', da: 8  },
    { sid: 'site-default-1', sname: 'Kacyiru Housing Block A',     wid: 'user-worker-2', stage: 'concrete_poured',     status: 'flagged',  da: 4  },
    { sid: 'site-default-1', sname: 'Kacyiru Housing Block A',     wid: 'user-worker-1', stage: 'concrete_poured',     status: 'pending',  da: 1  },

    // Kimironko Commercial Plaza (default-2) — Jean (w2) + Grace (w3)
    { sid: 'site-default-2', sname: 'Kimironko Commercial Plaza',  wid: 'user-worker-2', stage: 'formwork_erected',    status: 'approved', da: 45 },
    { sid: 'site-default-2', sname: 'Kimironko Commercial Plaza',  wid: 'user-worker-3', stage: 'reinforcement_placed', status: 'approved', da: 35 },
    { sid: 'site-default-2', sname: 'Kimironko Commercial Plaza',  wid: 'user-worker-2', stage: 'concrete_poured',     status: 'approved', da: 22 },
    { sid: 'site-default-2', sname: 'Kimironko Commercial Plaza',  wid: 'user-worker-3', stage: 'concrete_poured',     status: 'approved', da: 15 },
    { sid: 'site-default-2', sname: 'Kimironko Commercial Plaza',  wid: 'user-worker-2', stage: 'structure_complete',  status: 'approved', da: 6  },
    { sid: 'site-default-2', sname: 'Kimironko Commercial Plaza',  wid: 'user-worker-3', stage: 'structure_complete',  status: 'pending',  da: 0  },

    // Nyarutarama Office Tower — Amara (w1) + Grace (w3)
    { sid: 'site-nyarutarama-1', sname: 'Nyarutarama Office Tower',  wid: 'user-worker-1', stage: 'formwork_erected',    status: 'approved', da: 20 },
    { sid: 'site-nyarutarama-1', sname: 'Nyarutarama Office Tower',  wid: 'user-worker-3', stage: 'reinforcement_placed', status: 'approved', da: 12 },
    { sid: 'site-nyarutarama-1', sname: 'Nyarutarama Office Tower',  wid: 'user-worker-1', stage: 'reinforcement_placed', status: 'flagged',  da: 5  },
    { sid: 'site-nyarutarama-1', sname: 'Nyarutarama Office Tower',  wid: 'user-worker-3', stage: 'concrete_poured',     status: 'pending',  da: 1  },

    // Gisozi Residential Estate — Jean (w2) only
    { sid: 'site-gisozi-1', sname: 'Gisozi Residential Estate',    wid: 'user-worker-2', stage: 'formwork_erected',    status: 'approved', da: 10 },
    { sid: 'site-gisozi-1', sname: 'Gisozi Residential Estate',    wid: 'user-worker-2', stage: 'formwork_erected',    status: 'approved', da: 7  },
    { sid: 'site-gisozi-1', sname: 'Gisozi Residential Estate',    wid: 'user-worker-2', stage: 'reinforcement_placed', status: 'pending',  da: 2  },

    // Remera Mixed-Use Development — Amara (w1) + Grace (w3)
    { sid: 'site-remera-1', sname: 'Remera Mixed-Use Development', wid: 'user-worker-3', stage: 'formwork_erected',    status: 'approved', da: 16 },
    { sid: 'site-remera-1', sname: 'Remera Mixed-Use Development', wid: 'user-worker-1', stage: 'reinforcement_placed', status: 'approved', da: 10 },
    { sid: 'site-remera-1', sname: 'Remera Mixed-Use Development', wid: 'user-worker-3', stage: 'concrete_poured',     status: 'rejected', da: 6  },
    { sid: 'site-remera-1', sname: 'Remera Mixed-Use Development', wid: 'user-worker-1', stage: 'concrete_poured',     status: 'flagged',  da: 3  },
    { sid: 'site-remera-1', sname: 'Remera Mixed-Use Development', wid: 'user-worker-1', stage: 'concrete_poured',     status: 'pending',  da: 0  },
  ];

  for (const r of rpts) {
    const ai = fakeAi(r.stage);
    const reviewed = ['approved', 'rejected', 'flagged'].includes(r.status);
    const notes = r.status === 'rejected'
      ? 'Photo is blurry and does not clearly show the reported stage. Please retake.'
      : r.status === 'flagged'
      ? 'Stage reported does not match what is visible in the photo.'
      : null;

    db.prepare(`
      INSERT INTO reports (
        id, site_id, site_name, submitted_by_id, submitted_at, reported_stage, status, notes,
        ai_detected_stage, ai_confidence, ai_all_scores, ai_model_version, ai_inference_ms,
        ai_observations, reviewed_by_id, reviewed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `report-${uuid().slice(0, 8)}`,
      r.sid, r.sname, r.wid,
      daysAgo(r.da),
      r.stage, r.status, notes,
      ai.det, ai.conf, JSON.stringify(ai.scores),
      'mobilenetv2-v1',
      Math.floor(30 + Math.random() * 80),
      `AI detected ${ai.det} with ${Math.round(ai.conf * 100)}% confidence.`,
      reviewed ? 'user-manager-1' : null,
      reviewed ? daysAgo(Math.max(0, r.da - 1)) : null,
    );
  }
  console.log(`[Seed] ${rpts.length} reports`);

  console.log('\n[Seed] Database ready');
  console.log('  Workers:  user-worker-1 (Amara)  user-worker-2 (Jean)  user-worker-3 (Grace)');
  console.log('  Manager:  user-manager-1 (Fatima)');
  console.log('  Owner:    user-owner-1 (Patrick)');
  console.log('  Sites:    5 (2 default + 3 demo)');
  console.log('  Assignments:');
  console.log('    Kacyiru (default-1):    Amara, Jean');
  console.log('    Kimironko (default-2):  Jean, Grace');
  console.log('    Nyarutarama:            Amara, Grace');
  console.log('    Gisozi:                 Jean');
  console.log('    Remera:                 Amara, Grace');
}

main().catch(e => { console.error(e); process.exit(1); });

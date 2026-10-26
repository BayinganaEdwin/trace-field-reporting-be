/**
 * Seed demo data
 * Run: node src/db/seed.js
 */
const { v4: uuid } = require('uuid');
const { initSchema, getDbSync, DB_FILE } = require('./schema');
const fs = require('fs');

async function main() {
  // Delete existing DB file so we start fresh
  if (fs.existsSync(DB_FILE)) { fs.unlinkSync(DB_FILE); console.log('[Seed] Removed old database'); }

  await initSchema();
  const db = getDbSync();

  // ── Users ─────────────────────────────────────────────────────────────────
  const users = [
    { id: 'user-worker-1',  name: 'Amara Diallo',     email: 'amara@sitelog.rw',   role: 'worker',  phone: '+250789001001' },
    { id: 'user-worker-2',  name: 'Jean Mugisha',      email: 'jean@sitelog.rw',    role: 'worker',  phone: '+250789001002' },
    { id: 'user-manager-1', name: 'Fatima Nkusi',      email: 'fatima@sitelog.rw',  role: 'manager', phone: '+250789002001' },
    { id: 'user-owner-1',   name: 'Patrick Habimana',  email: 'patrick@sitelog.rw', role: 'owner',   phone: '+250789003001' },
  ];
  for (const u of users) {
    db.prepare(`INSERT INTO users (id, name, email, role, phone) VALUES (?, ?, ?, ?, ?)`)
      .run(u.id, u.name, u.email, u.role, u.phone);
  }
  console.log(`[Seed] ${users.length} users`);

  // ── Sites ─────────────────────────────────────────────────────────────────
  const sites = [
    { id: 'site-kacyiru-1',   name: 'Kacyiru Housing Block A',    address: 'KG 9 Ave, Kacyiru, Kigali',    lat: -1.9441, lng: 30.0619, managerId: 'user-manager-1', ownerId: 'user-owner-1', targetStage: 'concrete_poured',     startDate: '2024-09-01' },
    { id: 'site-kimironko-1', name: 'Kimironko Commercial Plaza',  address: 'KG 15 Ave, Kimironko, Kigali', lat: -1.9348, lng: 30.1076, managerId: 'user-manager-1', ownerId: 'user-owner-1', targetStage: 'structure_complete',  startDate: '2024-07-15' },
  ];
  for (const s of sites) {
    db.prepare(`INSERT INTO sites (id, name, address, latitude, longitude, manager_id, owner_id, target_stage, start_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(s.id, s.name, s.address, s.lat, s.lng, s.managerId, s.ownerId, s.targetStage, s.startDate);
  }
  console.log(`[Seed] ${sites.length} sites`);

  // ── Reports ───────────────────────────────────────────────────────────────
  const now = new Date();
  function daysAgo(n) {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return d.toISOString();
  }
  const aiStages = ['formwork_erected','reinforcement_placed','concrete_poured','structure_complete'];
  function fakeAi(stage) {
    const match = Math.random() > 0.15;
    const det = match ? stage : aiStages[Math.floor(Math.random() * 4)];
    const conf = parseFloat((match ? 0.75 + Math.random() * 0.24 : 0.40 + Math.random() * 0.35).toFixed(3));
    const scores = {};
    let rem = 1 - conf;
    aiStages.forEach((s, i) => {
      if (s === det) { scores[s] = conf; return; }
      const v = i < 3 ? parseFloat((rem * Math.random()).toFixed(3)) : parseFloat(rem.toFixed(3));
      scores[s] = v; rem -= v;
    });
    return { det, conf, scores };
  }

  const rpts = [
    { sid: 'site-kacyiru-1',   sname: 'Kacyiru Housing Block A',    wid: 'user-worker-1', stage: 'formwork_erected',    status: 'approved',  da: 14 },
    { sid: 'site-kacyiru-1',   sname: 'Kacyiru Housing Block A',    wid: 'user-worker-1', stage: 'reinforcement_placed', status: 'approved',  da: 10 },
    { sid: 'site-kacyiru-1',   sname: 'Kacyiru Housing Block A',    wid: 'user-worker-2', stage: 'concrete_poured',     status: 'flagged',   da: 6  },
    { sid: 'site-kacyiru-1',   sname: 'Kacyiru Housing Block A',    wid: 'user-worker-1', stage: 'concrete_poured',     status: 'pending',   da: 1  },
    { sid: 'site-kimironko-1', sname: 'Kimironko Commercial Plaza', wid: 'user-worker-2', stage: 'concrete_poured',     status: 'approved',  da: 20 },
    { sid: 'site-kimironko-1', sname: 'Kimironko Commercial Plaza', wid: 'user-worker-2', stage: 'concrete_poured',     status: 'approved',  da: 12 },
    { sid: 'site-kimironko-1', sname: 'Kimironko Commercial Plaza', wid: 'user-worker-1', stage: 'structure_complete',  status: 'rejected',  da: 5  },
    { sid: 'site-kimironko-1', sname: 'Kimironko Commercial Plaza', wid: 'user-worker-2', stage: 'structure_complete',  status: 'pending',   da: 0  },
  ];

  for (const r of rpts) {
    const ai = fakeAi(r.stage);
    const reviewed = ['approved','rejected','flagged'].includes(r.status);
    db.prepare(`
      INSERT INTO reports (id, site_id, site_name, submitted_by_id, submitted_at, reported_stage, status, notes,
        ai_detected_stage, ai_confidence, ai_all_scores, ai_model_version, ai_inference_ms, ai_observations,
        reviewed_by_id, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `report-${uuid().slice(0,8)}`,
      r.sid, r.sname, r.wid, daysAgo(r.da), r.stage, r.status,
      r.status === 'rejected' ? 'Photo unclear, retake required' : null,
      ai.det, ai.conf, JSON.stringify(ai.scores), 'mobilenetv2-v1',
      Math.floor(30 + Math.random() * 80),
      `AI detected ${ai.det} with ${Math.round(ai.conf * 100)}% confidence.`,
      reviewed ? 'user-manager-1' : null,
      reviewed ? daysAgo(r.da - 1) : null,
    );
  }
  console.log(`[Seed] ${rpts.length} reports`);

  console.log('\n[Seed] ✓ Database ready');
  console.log('  worker:  user-worker-1 / user-worker-2');
  console.log('  manager: user-manager-1');
  console.log('  owner:   user-owner-1');
}

main().catch(e => { console.error(e); process.exit(1); });

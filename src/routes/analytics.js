/**
 * GET /analytics/summary — aggregate stats for the manager dashboard
 *
 * Returns:
 *  {
 *    totalSites, activeSites,
 *    totalReports, pendingReports, approvedReports, flaggedReports,
 *    overallRei,
 *    stageDistribution: { formwork_erected: N, … },
 *    reiTrend: [ { date, rei }, … ] (last 7 days)
 *  }
 */
const express = require('express');
const router  = express.Router();
const { getDbSync: getDb } = require('../db/schema');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/summary', requireAuth, requireRole('manager', 'owner'), (req, res) => {
  const db = getDb();

  const sites   = db.prepare('SELECT * FROM sites').all();
  const reports = db.prepare('SELECT * FROM reports').all();

  const totalSites    = sites.length;
  const activeSites   = sites.filter(s => s.status === 'active').length;
  const totalReports  = reports.length;
  const pendingReports  = reports.filter(r => r.status === 'pending' || r.status === 'verified').length;
  const approvedReports = reports.filter(r => r.status === 'approved').length;
  const flaggedReports  = reports.filter(r => r.status === 'flagged').length;

  const reviewable = reports.filter(r => !['uploading','pending'].includes(r.status)).length;
  const overallRei = reviewable > 0 ? Math.round((approvedReports / reviewable) * 100) : 0;

  // Stage distribution (most recent approved per site)
  const stageDist = { formwork_erected: 0, reinforcement_placed: 0, concrete_poured: 0, structure_complete: 0 };
  for (const s of sites) {
    const approved = reports
      .filter(r => r.site_id === s.id && r.status === 'approved')
      .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
    if (approved.length > 0) {
      const stage = approved[0].reported_stage;
      if (stage in stageDist) stageDist[stage]++;
    }
  }

  // REI trend: last 7 days
  const reiTrend = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayReports = reports.filter(r => r.submitted_at.startsWith(dateStr));
    const dayApproved = dayReports.filter(r => r.status === 'approved').length;
    const dayReviewable = dayReports.filter(r => !['uploading','pending'].includes(r.status)).length;
    reiTrend.push({
      date: dateStr,
      rei: dayReviewable > 0 ? Math.round((dayApproved / dayReviewable) * 100) : null,
      count: dayReports.length,
    });
  }

  res.json({
    totalSites,
    activeSites,
    totalReports,
    pendingReports,
    approvedReports,
    flaggedReports,
    overallRei,
    stageDistribution: stageDist,
    reiTrend,
  });
});

module.exports = router;

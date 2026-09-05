const { Router } = require('express');
const db = require('../db');
const { logActivity } = require('../lib/activity');
const { SECTIONS, VILLA_ITEMS, sanitizeIssues, sanitizeVillas, sanitizeGuests, validate } = require('../lib/modReportShared');
const { modReportSubmitLimiter } = require('../middleware/rateLimit');

const router = Router();

// The public submission link — write-only, no login required. Identifies
// the checklist form itself (one token on mod_report_settings), not any one
// report, since a submitter has no reason to browse past reports.
function getModReportSettingsByToken(token) {
  const settings = db.prepare('SELECT * FROM mod_report_settings WHERE id = 1').get();
  if (!settings || !settings.submission_token || settings.submission_token !== token) return null;
  return settings;
}

router.get('/mod-reports/:token/meta', (req, res) => {
  const settings = getModReportSettingsByToken(req.params.token);
  if (!settings) return res.status(404).json({ error: 'This submission link is invalid or has been disabled.' });
  res.json({
    sections: SECTIONS,
    villaItems: VILLA_ITEMS,
    businessName: settings.business_name,
    logoImage: settings.logo_image,
  });
});

router.post('/mod-reports/:token', modReportSubmitLimiter, (req, res) => {
  const settings = getModReportSettingsByToken(req.params.token);
  if (!settings) return res.status(404).json({ error: 'This submission link is invalid or has been disabled.' });

  const error = validate(req.body);
  if (error) return res.status(400).json({ error });

  const { mod_name, report_date, weather = '', time_started = '', occupancy_percent, sections = {}, signature = '' } = req.body;
  const villas = sanitizeVillas(req.body.villas);
  const guestInteractions = sanitizeGuests(req.body.guestInteractions);
  const issues = sanitizeIssues(req.body.issues);
  const occupancy = occupancy_percent === '' || occupancy_percent === undefined || occupancy_percent === null ? null : Number(occupancy_percent);

  const result = db
    .prepare(
      `INSERT INTO mod_reports (mod_name, report_date, weather, time_started, occupancy_percent, sections_json, villas_json, guest_interactions_json, issues_json, signature, submitted_by_user_id, submitted_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(
      mod_name.trim(),
      report_date,
      weather,
      time_started,
      occupancy,
      JSON.stringify(sections && typeof sections === 'object' ? sections : {}),
      JSON.stringify(villas),
      JSON.stringify(guestInteractions),
      JSON.stringify(issues),
      signature,
      mod_name.trim(),
    );

  logActivity({
    userName: mod_name.trim(),
    action: 'submitted (public link)',
    entityType: 'mod_report',
    entityId: result.lastInsertRowid,
    entityLabel: `MOD checklist — ${mod_name.trim()} (${report_date})`,
  });

  res.status(201).json({ ok: true });
});

module.exports = router;

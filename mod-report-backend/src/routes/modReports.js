const crypto = require('crypto');
const { Router } = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');
const { renderModReportPdf } = require('../lib/modReportPdf');
const {
  SECTIONS, VILLA_ITEMS, sanitizeIssues, sanitizeVillas, sanitizeGuests, validate, reportTally,
} = require('../lib/modReportShared');

const router = Router();
// Every route below just needs a valid login — this standalone app has no
// role tiers to further gate against (see db/index.js's own note; the main
// EduSolution app this was split out of gated the equivalent routes to its
// super_admin role, which has no equivalent here).
router.use(requireAuth);

const PAGE_SIZE = 20;

router.get('/meta', (req, res) => {
  res.json({ sections: SECTIONS, villaItems: VILLA_ITEMS });
});

const IMAGE_DATA_URI_RE = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/]+=*)$/;
const MAX_LOGO_BYTES = 400 * 1024;

function validateLogoImage(value) {
  if (!value) return '';
  const match = IMAGE_DATA_URI_RE.exec(value);
  if (!match) throw new Error('Logo must be a PNG or JPEG image');
  const decodedBytes = Math.ceil((match[2].length * 3) / 4);
  if (decodedBytes > MAX_LOGO_BYTES) throw new Error('Logo must be smaller than 400KB');
  return value;
}

router.get('/settings', (req, res) => {
  const settings = db.prepare('SELECT * FROM mod_report_settings WHERE id = 1').get();
  res.json({ settings });
});

router.put('/settings', (req, res) => {
  const { business_name = '' } = req.body;
  let logoImage;
  try {
    logoImage = validateLogoImage(req.body.logo_image || '');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  db.prepare('UPDATE mod_report_settings SET business_name = ?, logo_image = ? WHERE id = 1').run(business_name.trim(), logoImage);
  const settings = db.prepare('SELECT * FROM mod_report_settings WHERE id = 1').get();
  logActivity({ userName: req.user.name, action: 'updated MOD report settings', entityType: 'mod_report_settings', entityId: 1, entityLabel: business_name.trim() || '(no name set)' });
  res.json({ settings });
});

// The public submission link — a random 16-byte hex token stored on this
// single-row settings table (see routes/public.js's own note on why
// there's no per-report identity to attach a link to before one exists).
router.post('/settings/regenerate-token', (req, res) => {
  const submissionToken = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE mod_report_settings SET submission_token = ? WHERE id = 1').run(submissionToken);
  const settings = db.prepare('SELECT * FROM mod_report_settings WHERE id = 1').get();
  logActivity({ userName: req.user.name, action: 'generated a new MOD report public submission link', entityType: 'mod_report_settings', entityId: 1, entityLabel: '' });
  res.json({ settings });
});

router.delete('/settings/token', (req, res) => {
  db.prepare('UPDATE mod_report_settings SET submission_token = NULL WHERE id = 1').run();
  const settings = db.prepare('SELECT * FROM mod_report_settings WHERE id = 1').get();
  logActivity({ userName: req.user.name, action: 'disabled the MOD report public submission link', entityType: 'mod_report_settings', entityId: 1, entityLabel: '' });
  res.json({ settings });
});

function parseRow(row) {
  let sections = {}, villas = [], guestInteractions = [], issues = [];
  try { sections = JSON.parse(row.sections_json); } catch (e) { /* corrupt/empty defaults to {} */ }
  try { villas = JSON.parse(row.villas_json); } catch (e) { /* defaults to [] */ }
  try { guestInteractions = JSON.parse(row.guest_interactions_json); } catch (e) { /* defaults to [] */ }
  try { issues = JSON.parse(row.issues_json); } catch (e) { /* defaults to [] */ }
  return {
    id: row.id,
    mod_name: row.mod_name,
    report_date: row.report_date,
    weather: row.weather,
    time_started: row.time_started,
    occupancy_percent: row.occupancy_percent,
    sections,
    villas,
    guestInteractions,
    issues,
    signature: row.signature,
    submitted_by_name: row.submitted_by_name,
    submitted_at: row.submitted_at,
    edited_at: row.edited_at,
  };
}

router.get('/', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM mod_reports').get();
  const rows = db
    .prepare('SELECT * FROM mod_reports ORDER BY submitted_at DESC, id DESC LIMIT ? OFFSET ?')
    .all(PAGE_SIZE, offset);

  const reports = rows.map((row) => {
    let sections = {}, villas = [], issues = [];
    try { sections = JSON.parse(row.sections_json); } catch (e) { /* defaults to {} */ }
    try { villas = JSON.parse(row.villas_json); } catch (e) { /* defaults to [] */ }
    try { issues = JSON.parse(row.issues_json); } catch (e) { /* defaults to [] */ }
    const t = reportTally(sections, villas);
    return {
      id: row.id,
      mod_name: row.mod_name,
      report_date: row.report_date,
      weather: row.weather,
      time_started: row.time_started,
      submitted_by_name: row.submitted_by_name,
      submitted_at: row.submitted_at,
      edited_at: row.edited_at,
      photo_count: issues.filter((i) => i.photo).length,
      tally: t,
    };
  });

  res.json({ reports, page, pageSize: PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM mod_reports WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Report not found' });
  const report = parseRow(row);
  res.json({ report, tally: reportTally(report.sections, report.villas) });
});

router.post('/', (req, res) => {
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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      req.user.id,
      req.user.name,
    );

  const row = db.prepare('SELECT * FROM mod_reports WHERE id = ?').get(result.lastInsertRowid);
  const report = parseRow(row);
  logActivity({ userName: req.user.name, action: 'submitted', entityType: 'mod_report', entityId: report.id, entityLabel: `MOD checklist — ${report.mod_name} (${report.report_date})` });
  res.status(201).json({ report, tally: reportTally(report.sections, report.villas) });
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM mod_reports WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Report not found' });

  const error = validate(req.body);
  if (error) return res.status(400).json({ error });

  const { mod_name, report_date, weather = '', time_started = '', occupancy_percent, sections = {}, signature = '' } = req.body;
  const villas = sanitizeVillas(req.body.villas);
  const guestInteractions = sanitizeGuests(req.body.guestInteractions);
  const issues = sanitizeIssues(req.body.issues);
  const occupancy = occupancy_percent === '' || occupancy_percent === undefined || occupancy_percent === null ? null : Number(occupancy_percent);

  db.prepare(
    `UPDATE mod_reports SET mod_name = ?, report_date = ?, weather = ?, time_started = ?, occupancy_percent = ?,
       sections_json = ?, villas_json = ?, guest_interactions_json = ?, issues_json = ?, signature = ?, edited_at = datetime('now')
     WHERE id = ?`,
  ).run(
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
    req.params.id,
  );

  const row = db.prepare('SELECT * FROM mod_reports WHERE id = ?').get(req.params.id);
  const report = parseRow(row);
  logActivity({ userName: req.user.name, action: 'corrected', entityType: 'mod_report', entityId: report.id, entityLabel: `MOD checklist — ${report.mod_name} (${report.report_date})` });
  res.json({ report, tally: reportTally(report.sections, report.villas) });
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM mod_reports WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Report not found' });
  db.prepare('DELETE FROM mod_reports WHERE id = ?').run(req.params.id);
  logActivity({ userName: req.user.name, action: 'deleted', entityType: 'mod_report', entityId: existing.id, entityLabel: `MOD checklist — ${existing.mod_name} (${existing.report_date})` });
  res.status(204).end();
});

router.get('/:id/pdf', (req, res) => {
  const row = db.prepare('SELECT * FROM mod_reports WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Report not found' });
  const parsed = parseRow(row);
  const modSettings = db.prepare('SELECT * FROM mod_report_settings WHERE id = 1').get();

  const report = {
    ...parsed,
    sections: SECTIONS,
    sections_answers: parsed.sections,
    villaItemLabels: VILLA_ITEMS,
  };

  renderModReportPdf({ report, modSettings })
    .then((buffer) => {
      const filename = `mod-report-${row.report_date}-${(row.mod_name || 'report').replace(/[^a-z0-9]+/gi, '-')}.pdf`;
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"` });
      res.send(buffer);
    })
    .catch((err) => {
      console.error('MOD report PDF generation failed:', err);
      res.status(500).json({ error: 'Failed to generate PDF' });
    });
});

module.exports = router;

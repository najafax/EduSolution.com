const { Router } = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');
const { renderModReportPdf } = require('../lib/modReportPdf');

const router = Router();
// Admin-only, same requireAdmin pattern as routes/dataReset.js/
// routes/emailCenter.js — this is a resort operations report, unrelated to
// the billing/CRM data the rest of this app's permission system (per-module
// user_permissions grants) governs, so it bypasses that system entirely
// rather than adding a new gatable module. No staff, however permissioned,
// can see or submit one — only an account with role: 'admin'.
router.use(requireAuth);
router.use(requireAdmin);

// The checklist's own shape — which sections exist, and what each item
// says — is fixed and code-defined, not something an admin configures in
// the app. Kept here as the single source of truth and served to the
// frontend via GET /meta, rather than duplicated in the React source, so
// there's exactly one place to edit if the checklist itself ever changes.
const SECTIONS = [
  { key: 'shift', title: 'Shift Handover', items: [
    'VIPs Checked-In',
    'VIPs Checked-Out',
    'Reception at the start of the shift',
    'Meet FO Shift Leader/Receptionist to collect Villa key/Inhouse list',
  ] },
  { key: 'reception', title: 'Reception', items: [
    'Staff on duty are well groomed, with name tag, proper uniform',
    'Staff on duty are well informed events happening on the island',
    'Reception Desk and Lobby Appearance',
    'Lobby and Back office and Luggage room are tidy and clean',
    'Arrival Jetty Pavilion',
    'Any Issue/concern/complaint',
  ] },
  { key: 'doctor', title: 'Resort Doctor & Emergency', items: [
    'Check with resort doctor for any issues/incidents',
  ] },
  { key: 'security', title: 'Security', items: [
    'Staff on duty are well groomed, with name tag, proper uniform',
    'Check cleanliness of Security area (pavilion and supply jetty area)',
    'Check security officers on duty at the resort',
    'Security office is clean',
    'Check the CCTV monitor for all in working condition',
    'Check the Fire Alarm panel (existing system)',
    'Any Issue/concern/complaint',
  ] },
  { key: 'walkaround', title: 'General Walk Around', items: [
    'Staff on duty are well groomed, with name tag, proper uniform, greet the guests',
    'Check cleanliness of all public areas (inc. toilets)',
    'All pathway lights are in good working condition',
    'WiFi status in the guests area (speed test)',
    'Report any defects or safety hazards observed',
    'All jetties are clean and tidy',
    'Boats are clean and properly docked',
  ] },
  { key: 'fnb', title: 'Restaurants and Bars', items: [
    'Executive Chef / Exe Sous Chef / FB Senior / Manager on duty',
    'Staff on duty are well groomed, with name tag, proper uniform',
    'Observe service staff on attentiveness and guest interaction',
    'Reef Restaurant set up and cleanliness / team members on duty',
    'Suan Bua set up and cleanliness / team members on duty',
    'Mare Azzuro set up and cleanliness / team members on duty',
    'Coral Bar set up and cleanliness / team members on duty',
    'Aqua Bar set up and cleanliness / team members on duty',
    'The Club set up and cleanliness / team members on duty',
    'In-Villa Dining set up and cleanliness / team members on duty',
    'Check if Food & Beverages are delivered to guests on time (esp. IVD)',
    'Any Private Dining / Special Dinners?',
    'Evening entertainment',
    'Any Issue/concern/complaint',
  ] },
  { key: 'spa', title: 'Spa', items: [
    'Staff on duty are well groomed, with name tag, proper uniform',
    'All areas clean and tidy, A/C and lights off where not in use',
    'Any Issue/concern/complaint',
  ] },
  { key: 'gym', title: 'Gym / Diving Center', items: [
    'Staff on duty are well groomed, with name tag, proper uniform',
    'Gym appearance and cleanliness',
    'Check condition of the gym equipment',
    'Dive centre area appearance and cleanliness',
    'Toilets areas appearance and cleanliness',
    'Any Issue/concern/complaint',
  ] },
  { key: 'ezone', title: 'E Zone / Library / Swimming Pool / Coral Bar', items: [
    'Check cleanliness of the E-zone & Library',
    'Check cleanliness of the toilets',
    'Check status of E-Zone upstairs (lights/cleaning)',
    'Check status of all lights and TV at the Library',
    'Pool deck appearance (sun lounges/tables arranged, no used towels or empty plates/glasses)',
    'Is the "Swimming Pool Closed" signage in place?',
    'Any Issue/concern/complaint',
  ] },
  { key: 'chill', title: 'Chill Lounge (Day Use Room)', items: [
    'Check status & appearance',
    'Check if any leftover food, empty cans, bottles, etc. in the seating areas',
    'Check TV, lights & AC status of lounge area',
    'Check toilet/shower area status',
    'Check if water bottles are tagged with the correct sticker color',
    'Any Issue/concern/complaint',
  ] },
  { key: 'remember', title: 'Something to Remember', items: [
    'Staff on duty are well groomed, with name tag & proper uniform',
    'Appearance (cleanliness, lights & AC status)',
    'Any Issue/concern/complaint',
  ] },
  { key: 'engineering', title: 'Engineering', items: [
    'Staff on duty are well groomed, with name tag & proper uniform',
    'Check the response of the Duty Engineer in charge',
    'Electricity & water comments',
    'Engineering workshop & carpentry areas appearance',
    'Power House',
    'Wet Garbage Room',
    'Dry Garbage Room',
    'Landscape lights in working order',
    'Public area cleanliness',
  ] },
  { key: 'boh', title: 'Back of the House', items: [
    'HR Office status',
    'Engineering Office status',
    'Housekeeping Office status',
    'General store locked',
    'F&B store locked',
    'Receiving area appearance',
    'Grand Café cleanliness',
    'Grand Café food comments/complaints',
    'Staff smoking / staff gym / stage / badminton court / football areas clean and tidy',
    'Staff bar / café appearance and cleanliness',
    'Staff laundry',
    'Staff housing check (room number and comments)',
    'Any Issue/concern/complaint',
  ] },
  { key: 'admin', title: 'Admin Building', items: [
    'Check lights on washroom (male/female)',
    'Reservation office (status of A/C & lights)',
    'Accounting office (status of A/C & lights)',
    'Other offices (status of A/C & lights)',
    'Upper floor – receiving & kitchen area (status of A/C & lights)',
    "Upper floor – manager's lounge (status of A/C & lights)",
    'Any Issue/concern/complaint',
  ] },
  { key: 'hk', title: 'HK Huts and Other Areas', items: [
    'Pantry inspection',
    'Laundry room',
    'Linen room',
  ] },
];

const VILLA_ITEMS = [
  'Walkway is clean and tidy, walkway lights in working condition',
  'Doorbell & DND sign in working condition',
  'Randomly check the light switches',
  'AC and remote is in good working condition',
  'Check internet / WiFi condition',
  'Check the bed & curtain for any creases and stains',
  'Check veranda furniture and the surroundings',
  'Check TV channels and speaker systems for proper working condition',
  'Check the luggage rack and wardrobe',
  'Check the minibar fridge for cleanliness and supplies; randomly check expiry dates',
  'Check if water bottles are tagged with the correct sticker color',
  'Check if Safety Deposit box is in good working condition',
  'Laundry list and laundry bag (01 bag & 02 list) in place',
  'Torch light in the drawer is in working condition',
  'All towels and bathroom amenities complete',
  'Check the WC area for cleanliness',
  'All glass doors and mirrors are clean',
  'Outdoor deck area is clean / sunbeds + table + terrace condition',
  'Swimming pool is clean and well maintained (pool villas only)',
  'Check the cleanliness of faucets and shower heads',
  'Check the toilet tiles / drainage area / floor cleanliness',
  'Any Issue/concern/complaint',
];

const SECTIONS_BY_KEY = new Map(SECTIONS.map((s) => [s.key, s]));
const PHOTO_TYPE_RE = /^data:image\/(png|jpe?g|webp);base64,/;
const PAGE_SIZE = 20;

router.get('/meta', (req, res) => {
  res.json({ sections: SECTIONS, villaItems: VILLA_ITEMS });
});

function tally(itemMap, count) {
  let yes = 0, no = 0, na = 0, answered = 0;
  for (let i = 0; i < count; i++) {
    const v = itemMap && itemMap[i] && itemMap[i].value;
    if (v === 'yes') { yes++; answered++; }
    else if (v === 'no') { no++; answered++; }
    else if (v === 'na') { na++; answered++; }
  }
  return { yes, no, na, answered, total: count };
}

function reportTally(sections, villas) {
  let yes = 0, no = 0, na = 0, answered = 0, total = 0;
  SECTIONS.forEach((s) => {
    const t = tally((sections || {})[s.key], s.items.length);
    yes += t.yes; no += t.no; na += t.na; answered += t.answered; total += t.total;
  });
  (villas || []).forEach((v) => {
    const t = tally(v.items, VILLA_ITEMS.length);
    yes += t.yes; no += t.no; na += t.na; answered += t.answered; total += t.total;
  });
  const denom = yes + no;
  const score = denom > 0 ? Math.round((yes / denom) * 100) : null;
  return { yes, no, na, answered, total, score };
}

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

// Photos are trusted only as far as their declared data-URI type — the
// same shallow check routes/clientPortal.js's payment-proof upload applies
// to file_type, not a full image-content sniff. A caption/villaGuest/etc.
// with no length cap is fine here (this is an internal, admin-only tool,
// not a public-facing upload surface).
function sanitizeIssues(issues) {
  if (!Array.isArray(issues)) return [];
  return issues.slice(0, 30).map((iss) => ({
    photo: typeof iss.photo === 'string' && PHOTO_TYPE_RE.test(iss.photo) ? iss.photo : '',
    caption: typeof iss.caption === 'string' ? iss.caption.slice(0, 2000) : '',
  }));
}

function sanitizeVillas(villas) {
  if (!Array.isArray(villas)) return [];
  return villas.slice(0, 60).map((v) => ({
    villaNumber: typeof v.villaNumber === 'string' ? v.villaNumber.slice(0, 40) : '',
    items: v.items && typeof v.items === 'object' ? v.items : {},
  }));
}

function sanitizeGuests(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 60).map((g) => ({
    villaGuest: typeof g.villaGuest === 'string' ? g.villaGuest.slice(0, 200) : '',
    comment: typeof g.comment === 'string' ? g.comment.slice(0, 2000) : '',
  }));
}

function validate(body) {
  if (!body || !String(body.mod_name || '').trim()) return 'mod_name is required';
  if (!body.report_date) return 'report_date is required';
  return null;
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

  const report = {
    ...parsed,
    sections: SECTIONS,
    sections_answers: parsed.sections,
    villaItemLabels: VILLA_ITEMS,
  };

  renderModReportPdf({ report })
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

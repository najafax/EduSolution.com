// The checklist's own shape (which sections exist, what each item says) and
// the row-shaping/validation logic around it — shared between
// routes/modReports.js (the authenticated, super-admin-only CRUD) and
// routes/public.js's own unauthenticated MOD report submission endpoint
// (see that file's own note on the public submission link). Kept as the
// single source of truth here rather than duplicated across the two route
// files, so the public submission path can never validate/sanitize a
// submission more loosely than the authenticated one does.
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

const PHOTO_TYPE_RE = /^data:image\/(png|jpe?g|webp);base64,/;

// Photos are trusted only as far as their declared data-URI type — the
// same shallow check routes/clientPortal.js's payment-proof upload applies
// to file_type, not a full image-content sniff. A caption/villaGuest/etc.
// with no length cap is fine for the authenticated caller (an internal,
// admin-only tool), and the same slice()-based caps here are what keep the
// public submission path (routes/public.js) from accepting an unbounded
// payload despite having no login gate of its own.
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

module.exports = {
  SECTIONS,
  VILLA_ITEMS,
  PHOTO_TYPE_RE,
  sanitizeIssues,
  sanitizeVillas,
  sanitizeGuests,
  validate,
  tally,
  reportTally,
};

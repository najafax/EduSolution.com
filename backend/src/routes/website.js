const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');

// The staff-side CMS behind the public marketing site (see routes/public.js's
// GET /site) — six small resources (posts, testimonials, services, team,
// gallery, videos), all gated on the same 'website' module rather than six
// separate MODULES entries, since they're all "who can edit the marketing site" at
// the identical sensitivity level (same "reuse when the sensitivity level
// already matches" call routes/reports.js/routes/capitalContributions.js
// already make elsewhere). None of these lists paginate — a marketing
// site's own content is inherently small (a handful of services, a
// double-digit number of posts/testimonials at most), the same "don't
// build it until needed" call routes/licenses.js's own GET /:id/renewals
// already makes for a comparably small list.
const router = Router();
router.use(requireAuth);
const view = requirePermission('website', 'view');
const manage = requirePermission('website', 'manage');

// Same base64-data-URI-inline-image approach business_settings' own
// logo/signature/stamp fields use (see routes/settings.js) — this app has
// no separate file storage, and a headshot or gallery photo is small enough
// to store alongside the row itself. webp is accepted here (unlike
// settings.js's logo, which only needs to satisfy PDFKit) since these
// images only ever render in a browser.
const IMAGE_DATA_URI_RE = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/]+=*)$/;
const MAX_IMAGE_BYTES = 400 * 1024;

function validateImageField(value, label) {
  if (!value) return '';
  const match = IMAGE_DATA_URI_RE.exec(value);
  if (!match) throw new Error(`${label} must be a PNG, JPEG or WEBP image`);
  const decodedBytes = Math.ceil((match[2].length * 3) / 4);
  if (decodedBytes > MAX_IMAGE_BYTES) throw new Error(`${label} must be smaller than 400KB`);
  return value;
}

// Matches the file id out of every real Google Drive share-link shape
// (/file/d/<id>/..., ?id=<id>) — this is what routes/public.js's own
// video read and the admin list both need to build a thumbnail URL
// (https://drive.google.com/thumbnail?id=<id>) without re-deriving the
// regex in two places, and what write-time validation below uses to
// reject a URL that isn't actually a Drive link before it's ever saved.
const DRIVE_FILE_ID_RE = /(?:\/file\/d\/|[?&]id=)([\w-]{10,})/;
function extractDriveFileId(url) {
  const match = DRIVE_FILE_ID_RE.exec(url || '');
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// News & announcements
// ---------------------------------------------------------------------------

router.get('/posts', view, (req, res) => {
  const posts = db.prepare('SELECT * FROM website_posts ORDER BY created_at DESC, id DESC').all();
  res.json({ posts });
});

function validatePost(body) {
  const { title } = body || {};
  if (!title || !title.trim()) return 'title is required';
  return null;
}

router.post('/posts', manage, (req, res) => {
  const error = validatePost(req.body);
  if (error) return res.status(400).json({ error });

  const { title, body = '', category = '', status = 'draft' } = req.body;
  const publishedAt = status === 'published' ? "datetime('now')" : 'NULL';
  const result = db
    .prepare(
      `INSERT INTO website_posts (title, body, category, status, published_at, created_by_name) VALUES (?, ?, ?, ?, ${publishedAt}, ?)`,
    )
    .run(title.trim(), body, category, status, req.user.name);

  const post = db.prepare('SELECT * FROM website_posts WHERE id = ?').get(result.lastInsertRowid);
  logActivity({ userName: req.user.name, action: 'created website post', entityType: 'website_post', entityId: post.id, entityLabel: post.title });
  res.status(201).json({ post });
});

router.put('/posts/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM website_posts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Post not found' });

  const error = validatePost(req.body);
  if (error) return res.status(400).json({ error });

  const { title, body = '', category = '', status = 'draft' } = req.body;
  // Stamp published_at the moment a post first goes live; a post that was
  // already published (or is still a draft) keeps whatever it already had —
  // re-saving a published post shouldn't bump its publish date.
  const publishedAtClause = status === 'published' && !existing.published_at ? "datetime('now')" : 'published_at';
  db.prepare(
    `UPDATE website_posts SET title = ?, body = ?, category = ?, status = ?, published_at = ${publishedAtClause}, updated_at = datetime('now') WHERE id = ?`,
  ).run(title.trim(), body, category, status, req.params.id);

  const post = db.prepare('SELECT * FROM website_posts WHERE id = ?').get(req.params.id);
  logActivity({ userName: req.user.name, action: 'updated website post', entityType: 'website_post', entityId: post.id, entityLabel: post.title });
  res.json({ post });
});

router.delete('/posts/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM website_posts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Post not found' });

  db.prepare('DELETE FROM website_posts WHERE id = ?').run(req.params.id);
  logActivity({ userName: req.user.name, action: 'deleted website post', entityType: 'website_post', entityId: existing.id, entityLabel: existing.title });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Testimonials
// ---------------------------------------------------------------------------

router.get('/testimonials', view, (req, res) => {
  const testimonials = db.prepare('SELECT * FROM website_testimonials ORDER BY display_order ASC, id DESC').all();
  res.json({ testimonials });
});

function validateTestimonial(body) {
  const { quote } = body || {};
  if (!quote || !quote.trim()) return 'quote is required';
  return null;
}

router.post('/testimonials', manage, (req, res) => {
  const error = validateTestimonial(req.body);
  if (error) return res.status(400).json({ error });

  const { quote, author_name = '', author_role = '', category = '', status = 'draft', display_order = 0 } = req.body;
  const result = db
    .prepare(
      'INSERT INTO website_testimonials (quote, author_name, author_role, category, status, display_order, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(quote.trim(), author_name, author_role, category, status, Number(display_order) || 0, req.user.name);

  const testimonial = db.prepare('SELECT * FROM website_testimonials WHERE id = ?').get(result.lastInsertRowid);
  logActivity({
    userName: req.user.name,
    action: 'added website testimonial from',
    entityType: 'website_testimonial',
    entityId: testimonial.id,
    entityLabel: testimonial.author_name || testimonial.quote.slice(0, 40),
  });
  res.status(201).json({ testimonial });
});

router.put('/testimonials/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM website_testimonials WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Testimonial not found' });

  const error = validateTestimonial(req.body);
  if (error) return res.status(400).json({ error });

  const { quote, author_name = '', author_role = '', category = '', status = 'draft', display_order = 0 } = req.body;
  db.prepare(
    `UPDATE website_testimonials SET quote = ?, author_name = ?, author_role = ?, category = ?, status = ?, display_order = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(quote.trim(), author_name, author_role, category, status, Number(display_order) || 0, req.params.id);

  const testimonial = db.prepare('SELECT * FROM website_testimonials WHERE id = ?').get(req.params.id);
  logActivity({
    userName: req.user.name,
    action: 'updated website testimonial from',
    entityType: 'website_testimonial',
    entityId: testimonial.id,
    entityLabel: testimonial.author_name || testimonial.quote.slice(0, 40),
  });
  res.json({ testimonial });
});

router.delete('/testimonials/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM website_testimonials WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Testimonial not found' });

  db.prepare('DELETE FROM website_testimonials WHERE id = ?').run(req.params.id);
  logActivity({
    userName: req.user.name,
    action: 'deleted website testimonial from',
    entityType: 'website_testimonial',
    entityId: existing.id,
    entityLabel: existing.author_name || existing.quote.slice(0, 40),
  });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Services / products (marketing copy — distinct from the billing catalog
// in routes/products.js, which prices what an invoice/quote can bill for;
// these are the cards shown on the public Services page)
// ---------------------------------------------------------------------------

router.get('/services', view, (req, res) => {
  const services = db.prepare('SELECT * FROM website_services ORDER BY display_order ASC, id ASC').all();
  res.json({ services });
});

function validateService(body) {
  const { title } = body || {};
  if (!title || !title.trim()) return 'title is required';
  return null;
}

router.post('/services', manage, (req, res) => {
  const error = validateService(req.body);
  if (error) return res.status(400).json({ error });

  const { title, description = '', icon = 'service', visible = true, display_order = 0 } = req.body;
  const result = db
    .prepare('INSERT INTO website_services (title, description, icon, visible, display_order) VALUES (?, ?, ?, ?, ?)')
    .run(title.trim(), description, icon, visible ? 1 : 0, Number(display_order) || 0);

  const service = db.prepare('SELECT * FROM website_services WHERE id = ?').get(result.lastInsertRowid);
  logActivity({ userName: req.user.name, action: 'added website service', entityType: 'website_service', entityId: service.id, entityLabel: service.title });
  res.status(201).json({ service });
});

router.put('/services/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM website_services WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Service not found' });

  const error = validateService(req.body);
  if (error) return res.status(400).json({ error });

  const { title, description = '', icon = 'service', visible = true, display_order = 0 } = req.body;
  db.prepare(
    `UPDATE website_services SET title = ?, description = ?, icon = ?, visible = ?, display_order = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(title.trim(), description, icon, visible ? 1 : 0, Number(display_order) || 0, req.params.id);

  const service = db.prepare('SELECT * FROM website_services WHERE id = ?').get(req.params.id);
  logActivity({ userName: req.user.name, action: 'updated website service', entityType: 'website_service', entityId: service.id, entityLabel: service.title });
  res.json({ service });
});

router.delete('/services/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM website_services WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Service not found' });

  db.prepare('DELETE FROM website_services WHERE id = ?').run(req.params.id);
  logActivity({ userName: req.user.name, action: 'deleted website service', entityType: 'website_service', entityId: existing.id, entityLabel: existing.title });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

router.get('/team', view, (req, res) => {
  const team = db.prepare('SELECT * FROM website_team_members ORDER BY display_order ASC, id ASC').all();
  res.json({ team });
});

function validateTeamMember(body) {
  const { name } = body || {};
  if (!name || !name.trim()) return 'name is required';
  return null;
}

router.post('/team', manage, (req, res) => {
  const error = validateTeamMember(req.body);
  if (error) return res.status(400).json({ error });

  let photo;
  try {
    photo = validateImageField(req.body.photo || '', 'Photo');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const { name, role = '', visible = true, display_order = 0 } = req.body;
  const result = db
    .prepare('INSERT INTO website_team_members (name, role, photo, visible, display_order) VALUES (?, ?, ?, ?, ?)')
    .run(name.trim(), role, photo, visible ? 1 : 0, Number(display_order) || 0);

  const member = db.prepare('SELECT * FROM website_team_members WHERE id = ?').get(result.lastInsertRowid);
  logActivity({ userName: req.user.name, action: 'added website team member', entityType: 'website_team_member', entityId: member.id, entityLabel: member.name });
  res.status(201).json({ member });
});

router.put('/team/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM website_team_members WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Team member not found' });

  const error = validateTeamMember(req.body);
  if (error) return res.status(400).json({ error });

  let photo;
  try {
    photo = validateImageField(req.body.photo || '', 'Photo');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const { name, role = '', visible = true, display_order = 0 } = req.body;
  db.prepare('UPDATE website_team_members SET name = ?, role = ?, photo = ?, visible = ?, display_order = ? WHERE id = ?').run(
    name.trim(),
    role,
    photo,
    visible ? 1 : 0,
    Number(display_order) || 0,
    req.params.id,
  );

  const member = db.prepare('SELECT * FROM website_team_members WHERE id = ?').get(req.params.id);
  logActivity({ userName: req.user.name, action: 'updated website team member', entityType: 'website_team_member', entityId: member.id, entityLabel: member.name });
  res.json({ member });
});

router.delete('/team/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM website_team_members WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Team member not found' });

  db.prepare('DELETE FROM website_team_members WHERE id = ?').run(req.params.id);
  logActivity({ userName: req.user.name, action: 'deleted website team member', entityType: 'website_team_member', entityId: existing.id, entityLabel: existing.name });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

router.get('/gallery', view, (req, res) => {
  const gallery = db.prepare('SELECT * FROM website_gallery ORDER BY display_order ASC, id ASC').all();
  res.json({ gallery });
});

router.post('/gallery', manage, (req, res) => {
  let image;
  try {
    image = validateImageField(req.body.image || '', 'Image');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!image) return res.status(400).json({ error: 'image is required' });

  const { caption = '', visible = true, display_order = 0 } = req.body;
  const result = db
    .prepare('INSERT INTO website_gallery (image, caption, visible, display_order) VALUES (?, ?, ?, ?)')
    .run(image, caption, visible ? 1 : 0, Number(display_order) || 0);

  const item = db.prepare('SELECT * FROM website_gallery WHERE id = ?').get(result.lastInsertRowid);
  logActivity({ userName: req.user.name, action: 'added website gallery image', entityType: 'website_gallery', entityId: item.id, entityLabel: item.caption || `Image #${item.id}` });
  res.status(201).json({ item });
});

router.put('/gallery/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM website_gallery WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Gallery image not found' });

  const { caption = '', visible = true, display_order = 0 } = req.body;
  // A gallery image's own photo is write-once at upload — editing here only
  // ever touches caption/visibility/order, never re-uploads a new image
  // (delete and re-add for that), so there's no image validation to repeat.
  db.prepare('UPDATE website_gallery SET caption = ?, visible = ?, display_order = ? WHERE id = ?').run(
    caption,
    visible ? 1 : 0,
    Number(display_order) || 0,
    req.params.id,
  );

  const item = db.prepare('SELECT * FROM website_gallery WHERE id = ?').get(req.params.id);
  logActivity({ userName: req.user.name, action: 'updated website gallery image', entityType: 'website_gallery', entityId: item.id, entityLabel: item.caption || `Image #${item.id}` });
  res.json({ item });
});

router.delete('/gallery/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM website_gallery WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Gallery image not found' });

  db.prepare('DELETE FROM website_gallery WHERE id = ?').run(req.params.id);
  logActivity({ userName: req.user.name, action: 'deleted website gallery image', entityType: 'website_gallery', entityId: existing.id, entityLabel: existing.caption || `Image #${existing.id}` });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Video tutorials (e.g. EduPage walkthroughs) — hosted on Google Drive, not
// this app; video_url is the Drive share link itself, and the public site
// derives a thumbnail from it rather than needing a separate uploaded image
// (see extractDriveFileId above).
// ---------------------------------------------------------------------------

router.get('/videos', view, (req, res) => {
  const videos = db.prepare('SELECT * FROM website_videos ORDER BY display_order ASC, id ASC').all();
  res.json({ videos });
});

function validateVideo(body) {
  const { title, video_url } = body || {};
  if (!title || !title.trim()) return 'title is required';
  if (!video_url || !video_url.trim()) return 'video_url is required';
  if (!extractDriveFileId(video_url)) return 'video_url must be a Google Drive share link';
  return null;
}

router.post('/videos', manage, (req, res) => {
  const error = validateVideo(req.body);
  if (error) return res.status(400).json({ error });

  const { title, description = '', video_url, category = '', visible = true, display_order = 0 } = req.body;
  const result = db
    .prepare('INSERT INTO website_videos (title, description, video_url, category, visible, display_order) VALUES (?, ?, ?, ?, ?, ?)')
    .run(title.trim(), description, video_url.trim(), category, visible ? 1 : 0, Number(display_order) || 0);

  const video = db.prepare('SELECT * FROM website_videos WHERE id = ?').get(result.lastInsertRowid);
  logActivity({ userName: req.user.name, action: 'added website video', entityType: 'website_video', entityId: video.id, entityLabel: video.title });
  res.status(201).json({ video });
});

router.put('/videos/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM website_videos WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Video not found' });

  const error = validateVideo(req.body);
  if (error) return res.status(400).json({ error });

  const { title, description = '', video_url, category = '', visible = true, display_order = 0 } = req.body;
  db.prepare(
    `UPDATE website_videos SET title = ?, description = ?, video_url = ?, category = ?, visible = ?, display_order = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(title.trim(), description, video_url.trim(), category, visible ? 1 : 0, Number(display_order) || 0, req.params.id);

  const video = db.prepare('SELECT * FROM website_videos WHERE id = ?').get(req.params.id);
  logActivity({ userName: req.user.name, action: 'updated website video', entityType: 'website_video', entityId: video.id, entityLabel: video.title });
  res.json({ video });
});

router.delete('/videos/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM website_videos WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Video not found' });

  db.prepare('DELETE FROM website_videos WHERE id = ?').run(req.params.id);
  logActivity({ userName: req.user.name, action: 'deleted website video', entityType: 'website_video', entityId: existing.id, entityLabel: existing.title });
  res.status(204).end();
});

module.exports = router;

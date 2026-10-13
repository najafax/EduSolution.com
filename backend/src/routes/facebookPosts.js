const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');
const { generateDraftPost } = require('../lib/facebookPostDraft');
const facebook = require('../lib/facebook');

// Weekly Facebook Page post drafts — AI-drafted (optionally seeded from this
// app's own website CMS content, see lib/facebookPostDraft.js), always
// reviewed/edited/approved by a human before anything actually reaches
// Facebook (see routes/facebookPosts.js's own POST /:id/publish — there is
// no auto-publish path anywhere in this app, not even from the weekly cron
// job in lib/scheduler.js). Gated on its own 'facebook' module rather than
// reusing an existing one — this is a standalone marketing-automation
// feature with no sensitivity overlap with any other module.
const router = Router();
router.use(requireAuth);
const view = requirePermission('facebook', 'view');
const manage = requirePermission('facebook', 'manage');

const PAGE_SIZE = 20;

// Always paginated, newest first — same convention as routes/campaigns.js's
// own history feed (a chronological log of drafts/posts, not a pickable
// list, so it doesn't need the business list routes' opt-in ?page=
// convention).
router.get('/', view, (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM facebook_posts').get();
  const posts = db
    .prepare('SELECT * FROM facebook_posts ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
    .all(PAGE_SIZE, offset);
  res.json({ posts, page, pageSize: PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
});

// On-demand draft generation — the same function the weekly cron job
// (lib/scheduler.js's generateWeeklyFacebookDraft()) calls, just attributed
// to the staff member who clicked the button instead of 'Automated'.
router.post('/generate', manage, async (req, res) => {
  let draft;
  try {
    draft = await generateDraftPost();
  } catch (err) {
    if (err.code === 'AI_NOT_CONFIGURED') return res.status(503).json({ error: err.message });
    console.error('[facebook] draft generation failed:', err);
    return res.status(500).json({ error: 'Failed to generate a draft — please try again.' });
  }

  const result = db
    .prepare(
      `INSERT INTO facebook_posts (content, source_note, status, generated_by_name) VALUES (?, ?, 'draft', ?)`,
    )
    .run(draft.content, draft.sourceNote, req.user.name);

  const post = db.prepare('SELECT * FROM facebook_posts WHERE id = ?').get(result.lastInsertRowid);
  logActivity({
    userName: req.user.name,
    action: 'generated a Facebook post draft',
    entityType: 'facebook_post',
    entityId: post.id,
    entityLabel: post.content.slice(0, 60),
  });
  res.status(201).json({ post });
});

// Editing is only meaningful while a draft hasn't gone out yet — a posted
// record is historical from here on, same "once real money/action has
// moved, locked" precedent a sent invoice or a distributed deal already
// follow elsewhere in this app.
router.put('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM facebook_posts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Post not found' });
  if (existing.status !== 'draft') {
    return res.status(409).json({ error: 'This post has already been posted or discarded and can no longer be edited.' });
  }

  const content = (req.body?.content || '').trim();
  if (!content) return res.status(400).json({ error: 'content is required' });

  db.prepare(`UPDATE facebook_posts SET content = ?, updated_at = datetime('now') WHERE id = ?`).run(content, req.params.id);

  const post = db.prepare('SELECT * FROM facebook_posts WHERE id = ?').get(req.params.id);
  logActivity({
    userName: req.user.name,
    action: 'edited Facebook post draft',
    entityType: 'facebook_post',
    entityId: post.id,
    entityLabel: post.content.slice(0, 60),
  });
  res.json({ post });
});

// The one real action — actually publishes to the configured Facebook
// Page's feed via lib/facebook.js. A staff member reviewing/editing the
// draft first (PUT /:id above) and then clicking this is the entire
// "review before send" workflow this feature was built around; there is no
// path that reaches lib/facebook.js's publishPost() without this explicit
// click.
router.post('/:id/publish', manage, async (req, res) => {
  const existing = db.prepare('SELECT * FROM facebook_posts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Post not found' });
  if (existing.status !== 'draft') {
    return res.status(409).json({ error: 'This post has already been posted or discarded.' });
  }

  let fbPostId;
  try {
    fbPostId = await facebook.publishPost(existing.content);
  } catch (err) {
    if (err.code === 'FACEBOOK_NOT_CONFIGURED') return res.status(503).json({ error: err.message });
    console.error('[facebook] publish failed:', err);
    return res.status(502).json({ error: err.message || 'Facebook rejected this post.' });
  }

  db.prepare(
    `UPDATE facebook_posts SET status = 'posted', fb_post_id = ?, posted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
  ).run(fbPostId, req.params.id);

  const post = db.prepare('SELECT * FROM facebook_posts WHERE id = ?').get(req.params.id);
  logActivity({
    userName: req.user.name,
    action: 'published a Facebook post',
    entityType: 'facebook_post',
    entityId: post.id,
    entityLabel: post.content.slice(0, 60),
  });
  res.json({ post });
});

// Discarding a draft the review step rejected — a posted record stays
// permanent (same "once it's real, it's locked" rule PUT /:id above
// already enforces), so this only ever removes a 'draft' or already-
// 'discarded' row.
router.delete('/:id', manage, (req, res) => {
  const existing = db.prepare('SELECT * FROM facebook_posts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Post not found' });
  if (existing.status === 'posted') {
    return res.status(409).json({ error: 'A post that has already gone out to Facebook cannot be deleted.' });
  }

  db.prepare('DELETE FROM facebook_posts WHERE id = ?').run(req.params.id);
  logActivity({
    userName: req.user.name,
    action: 'discarded Facebook post draft',
    entityType: 'facebook_post',
    entityId: existing.id,
    entityLabel: existing.content.slice(0, 60),
  });
  res.status(204).end();
});

module.exports = router;

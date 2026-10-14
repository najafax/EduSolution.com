const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../lib/activity');
const { createDraft, listOptions } = require('../lib/facebookPostDraft');
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
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_DATA_URI_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

// Always paginated, newest first — same convention as routes/campaigns.js's
// own history feed (a chronological log of drafts/posts, not a pickable
// list, so it doesn't need the business list routes' opt-in ?page=
// convention).
// Pictures are base64 data URIs and can be large, so only a draft (the thing
// being reviewed) carries its image in the list response; a posted row just
// says whether it had one.
function shapePost(row) {
  const { image_data: imageData, ...rest } = row;
  return { ...rest, has_image: Boolean(imageData), image: row.status === 'draft' ? imageData || null : null };
}

router.get('/', view, (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM facebook_posts').get();
  const posts = db
    .prepare('SELECT * FROM facebook_posts ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
    .all(PAGE_SIZE, offset)
    .map(shapePost);
  res.json({ posts, page, pageSize: PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
});

// The choices offered next to "Generate draft": post types (and whether each
// has anything to write about yet) and the tutorials that can be spotlighted.
router.get('/options', view, (req, res) => {
  res.json(listOptions());
});

// On-demand draft generation — the same function the weekly cron job
// (lib/scheduler.js's generateWeeklyFacebookDraft()) calls, just attributed
// to the staff member who clicked the button instead of 'Automated'.
router.post('/generate', manage, async (req, res) => {
  const postType = typeof req.body?.postType === 'string' && req.body.postType ? req.body.postType : undefined;
  const videoId = req.body?.videoId ? Number(req.body.videoId) : undefined;
  if (req.body?.videoId && !Number.isInteger(videoId)) return res.status(400).json({ error: 'Invalid tutorial.' });

  let post;
  try {
    post = await createDraft({ postType, videoId }, req.user.name);
  } catch (err) {
    if (err.code === 'AI_NOT_CONFIGURED') return res.status(503).json({ error: err.message });
    if (err.code === 'BAD_OPTION') return res.status(400).json({ error: err.message });
    console.error('[facebook] draft generation failed:', err);
    return res.status(500).json({ error: 'Failed to generate a draft — please try again.' });
  }

  logActivity({
    userName: req.user.name,
    action: 'generated a Facebook post draft',
    entityType: 'facebook_post',
    entityId: post.id,
    entityLabel: post.content.slice(0, 60),
  });
  res.status(201).json({ post: shapePost(post) });
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

  // `image` left out = keep the current picture; null = remove it; a data URI
  // = replace it. Same decoded-size check every other image upload here uses.
  let imageData = existing.image_data;
  if (req.body && 'image' in req.body) {
    const image = req.body.image;
    if (image === null) {
      imageData = null;
    } else {
      const match = typeof image === 'string' ? IMAGE_DATA_URI_RE.exec(image) : null;
      if (!match) return res.status(400).json({ error: 'The picture must be a PNG, JPEG or WEBP image.' });
      if (Math.ceil((match[2].length * 3) / 4) > MAX_IMAGE_BYTES) {
        return res.status(400).json({ error: 'The picture is too large (3MB maximum).' });
      }
      imageData = image;
    }
  }

  db.prepare(`UPDATE facebook_posts SET content = ?, image_data = ?, updated_at = datetime('now') WHERE id = ?`).run(
    content,
    imageData,
    req.params.id,
  );

  const post = db.prepare('SELECT * FROM facebook_posts WHERE id = ?').get(req.params.id);
  logActivity({
    userName: req.user.name,
    action: 'edited Facebook post draft',
    entityType: 'facebook_post',
    entityId: post.id,
    entityLabel: post.content.slice(0, 60),
  });
  res.json({ post: shapePost(post) });
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
    fbPostId = existing.image_data
      ? await facebook.publishPhoto(existing.content, existing.image_data)
      : await facebook.publishPost(existing.content);
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
  res.json({ post: shapePost(post) });
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

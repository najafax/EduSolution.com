const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');

// Resolves ANTHROPIC_API_KEY from the environment automatically (same
// "default, don't hardcode a key" convention this app already follows for
// Resend/SMTP in lib/mailer.js) — constructing this with no key set never
// throws on its own, only an actual API call would, so isConfigured() below
// is what gives this feature the same "not configured" graceful-degradation
// shape as lib/mailer.js's own EMAIL_NOT_CONFIGURED.
const client = new Anthropic();

function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Where "Watch the tutorial" links point. The marketing site is a
// single-page app with no per-page <meta> tags, so Facebook can't build a
// rich link card from it — the tutorial's thumbnail is attached to the post
// as a real photo instead and this link just goes in the text.
const LINK_BASE = (process.env.FACEBOOK_LINK_BASE || 'https://www.edusolutionsmaldives.com').replace(/\/+$/, '');

// Each draft is written from one of these angles. Rotating through them
// (see pickPostType) is what stops every click of "Generate draft" from
// producing the same post — before this, every draft was seeded from the
// same newest-3-of-everything CMS rows and told to write about "the most
// interesting" one, so the model picked the same item every time.
const POST_TYPES = {
  tutorial: { label: 'Tutorial spotlight', needs: 'videos' },
  feature_tip: { label: 'EduPage tip' },
  testimonial: { label: 'Client testimonial', needs: 'testimonials' },
  business_tip: { label: 'Business software tip' },
  engage_question: { label: 'Question for followers' },
  announcement: { label: 'News / announcement', needs: 'news' },
};

// Tutorials appear more than once per cycle on purpose: they are the only
// post type that comes with a real EduPage picture attached automatically.
const ROTATION = [
  'tutorial',
  'feature_tip',
  'tutorial',
  'testimonial',
  'tutorial',
  'business_tip',
  'engage_question',
  'tutorial',
  'announcement',
];

const RECENT_POSTS_FOR_CONTEXT = 8;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Same file-id extraction as routes/website.js's extractDriveFileId and
// frontend/src/lib/googleDrive.js — a third small duplicated copy, same
// acceptable-duplication precedent this app already follows elsewhere.
const DRIVE_FILE_ID_RE = /(?:\/file\/d\/|[?&]id=)([\w-]{10,})/;
function extractDriveFileId(url) {
  const match = DRIVE_FILE_ID_RE.exec(url || '');
  return match ? match[1] : null;
}

function availableContent() {
  const videos = db
    .prepare(
      `SELECT v.id, v.title, v.description, v.category, v.video_url,
              (SELECT COUNT(*) FROM facebook_posts p WHERE p.video_id = v.id) AS times_featured,
              (SELECT MAX(p.created_at) FROM facebook_posts p WHERE p.video_id = v.id) AS last_featured
       FROM website_videos v
       WHERE v.visible = 1
       ORDER BY times_featured ASC, COALESCE(last_featured, '') ASC, v.display_order ASC, v.id ASC`,
    )
    .all()
    .filter((v) => extractDriveFileId(v.video_url));
  const testimonials = db
    .prepare(`SELECT quote, author_name FROM website_testimonials WHERE status = 'published' ORDER BY RANDOM() LIMIT 5`)
    .all();
  const news = db
    .prepare(`SELECT title, body FROM website_posts WHERE status = 'published' ORDER BY published_at DESC, id DESC LIMIT 5`)
    .all();
  return { videos, testimonials, news };
}

function isEligible(type, content) {
  const needs = POST_TYPES[type]?.needs;
  if (!needs) return true;
  return content[needs].length > 0;
}

// Automatic choice: walk the rotation by how many typed drafts exist so far,
// skipping any type with nothing to write about (e.g. no testimonials yet).
function pickPostType(content) {
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM facebook_posts WHERE post_type != ''`).get();
  for (let i = 0; i < ROTATION.length; i++) {
    const type = ROTATION[(n + i) % ROTATION.length];
    if (isEligible(type, content)) return type;
  }
  return 'feature_tip';
}

function recentPostsText() {
  const rows = db
    .prepare('SELECT content FROM facebook_posts ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(RECENT_POSTS_FOR_CONTEXT);
  if (!rows.length) return '';
  return rows.map((r, i) => `${i + 1}. ${r.content.slice(0, 350).replace(/\s+/g, ' ')}`).join('\n');
}

const SYSTEM_PROMPT = `You write short, friendly Facebook posts for Edu Solutions, a Maldives-based business that (1) is an authorized EduPage distributor (school management software) and (2) sells its own business-management software (invoicing, quotes, licenses, financials) to small/medium businesses.

Write ONE Facebook post only. Rules:
- Plain text only — no markdown, no headings. At most 2-3 hashtags, and only if natural.
- 2-4 short paragraphs or a few short lines, friendly and professional, never salesy or hype-y.
- Never invent facts: no made-up statistics, prices, customer names, dates, awards or product features. Only describe capabilities that are common knowledge for school management software, or that are stated in the material you are given.
- Do not include any web links or say "link in comments" — a link is added separately when needed.
- Make the post clearly different from the recent posts listed (different topic, opening line and wording). Never start with the same words as a recent post.
- End with a soft, natural call to action (for example inviting people to get in touch), not a hard sell.
- Output ONLY the post text itself — no preamble, no quotes around it, no "Here's a draft:".`;

const FEATURE_TOPICS = [
  'timetable creation and changes',
  'daily attendance',
  'grades and report cards',
  'communicating with parents',
  'substitution / cover management',
  'exams and assessment scheduling',
  'saving teachers time on admin',
  'giving parents and students one place to check information',
];
const BUSINESS_TOPICS = [
  'sending professional quotes quickly',
  'tracking unpaid invoices and payment reminders',
  'knowing your cash position at a glance',
  'recording expenses without spreadsheets',
  'keeping licenses and subscription renewals from lapsing',
  'recurring invoices for regular clients',
];

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function buildUserMessage(type, chosen) {
  switch (type) {
    case 'tutorial':
      return `Write a post that spotlights this tutorial video from our website. The video is attached to the post as a picture, and people can watch it on our tutorials page.\n\nTutorial title: ${chosen.video.title}\nCategory: ${chosen.video.category || 'EduPage'}\nDescription: ${(chosen.video.description || '(none given)').slice(0, 500)}\n\nExplain, in plain words, who it helps and what they will learn, based only on the title and description above. Invite people to watch it.`;
    case 'testimonial':
      return `Write a post built around this real client testimonial. Keep the quote accurate and attribute it.\n\n"${chosen.testimonial.quote.slice(0, 400)}" — ${chosen.testimonial.author_name || 'a client'}`;
    case 'announcement':
      return `Write a post announcing or sharing this news item from our website.\n\nTitle: ${chosen.news.title}\n${(chosen.news.body || '').slice(0, 600)}`;
    case 'business_tip':
      return `Write a helpful tip post for Maldives small-business owners about: ${chosen.topic}. Position our business-management software as a natural way to do this, without hard selling.`;
    case 'engage_question':
      return `Write a short post that asks our followers (school administrators, teachers, or small-business owners in the Maldives) one genuine, easy-to-answer question to start a conversation, for example about a challenge they face with ${chosen.topic}. Keep it warm and short.`;
    case 'feature_tip':
    default:
      return `Write a helpful tip post for school administrators and teachers in the Maldives about: ${chosen.topic}, and how EduPage can help. Keep it general and accurate.`;
  }
}

// Fetches the tutorial's Drive thumbnail server-side so it can be stored
// with the draft and uploaded to Facebook as a real photo. Returns null for
// anything that isn't a plain image (a file that isn't shared "anyone with
// the link" returns an HTML sign-in page, not an image) — the draft is still
// created, just without a picture, and staff can attach one by hand.
async function fetchDriveThumbnail(fileId) {
  try {
    const res = await fetch(`https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`, {
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!IMAGE_TYPES.includes(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_IMAGE_BYTES) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch (err) {
    console.error('[facebook] could not fetch tutorial thumbnail:', err.message);
    return null;
  }
}

// Options for the "Generate draft" controls on Facebook Posts.
function listOptions() {
  const content = availableContent();
  return {
    postTypes: Object.entries(POST_TYPES).map(([value, t]) => ({
      value,
      label: t.label,
      available: isEligible(value, content),
    })),
    videos: content.videos.map((v) => ({ id: v.id, title: v.title, category: v.category })),
  };
}

// Generates a single draft post. `options` is optional:
//   { postType, videoId } — both left out means "pick automatically".
// Returns { content, sourceNote, postType, videoId, image } where `image` is a
// data URI or null.
async function generateDraftPost(options = {}) {
  if (!isConfigured()) {
    const error = new Error('AI drafting is not configured. Set ANTHROPIC_API_KEY in backend/.env.');
    error.code = 'AI_NOT_CONFIGURED';
    throw error;
  }

  const content = availableContent();
  let type = options.postType || pickPostType(content);
  if (!POST_TYPES[type]) {
    const error = new Error('Unknown post type.');
    error.code = 'BAD_OPTION';
    throw error;
  }
  if (!isEligible(type, content)) {
    const error = new Error(`There is nothing to write a "${POST_TYPES[type].label}" post about yet — add content on the Website content page first.`);
    error.code = 'BAD_OPTION';
    throw error;
  }

  const chosen = {};
  let videoId = null;
  let sourceNote = POST_TYPES[type].label;
  if (type === 'tutorial') {
    const wanted = options.videoId ? content.videos.find((v) => v.id === Number(options.videoId)) : null;
    if (options.videoId && !wanted) {
      const error = new Error('That tutorial is not available (it may be hidden or its link is not a Google Drive link).');
      error.code = 'BAD_OPTION';
      throw error;
    }
    chosen.video = wanted || content.videos[0];
    videoId = chosen.video.id;
    sourceNote = `Tutorial spotlight: ${chosen.video.title}`;
  } else if (type === 'testimonial') {
    chosen.testimonial = pickRandom(content.testimonials);
    sourceNote = `Testimonial from ${chosen.testimonial.author_name || 'a client'}`;
  } else if (type === 'announcement') {
    chosen.news = pickRandom(content.news);
    sourceNote = `News: ${chosen.news.title}`;
  } else if (type === 'business_tip') {
    chosen.topic = pickRandom(BUSINESS_TOPICS);
    sourceNote = `Business software tip: ${chosen.topic}`;
  } else if (type === 'engage_question') {
    chosen.topic = pickRandom([...FEATURE_TOPICS, ...BUSINESS_TOPICS]);
    sourceNote = `Question for followers: ${chosen.topic}`;
  } else {
    chosen.topic = pickRandom(FEATURE_TOPICS);
    sourceNote = `EduPage tip: ${chosen.topic}`;
  }

  const recent = recentPostsText();
  const userMessage = `${buildUserMessage(type, chosen)}${
    recent ? `\n\nOur most recent posts (do NOT repeat their topics, openings or wording):\n${recent}` : ''
  }`;

  const response = await client.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  let text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  if (!text) {
    throw new Error('The AI returned an empty draft — try generating again.');
  }

  let image = null;
  if (type === 'tutorial') {
    text = `${text}\n\nWatch the tutorial: ${LINK_BASE}/tutorials`;
    image = await fetchDriveThumbnail(extractDriveFileId(chosen.video.video_url));
    if (!image) sourceNote += ' (picture could not be fetched — attach one by hand)';
  }

  return { content: text, sourceNote, postType: type, videoId, image };
}

// Generates a draft and saves it. Shared by routes/facebookPosts.js's
// POST /generate and lib/scheduler.js's weekly job so a cron-made draft and
// an on-demand one are stored identically.
async function createDraft(options, generatedByName) {
  const draft = await generateDraftPost(options);
  const result = db
    .prepare(
      `INSERT INTO facebook_posts (content, source_note, status, generated_by_name, post_type, video_id, image_data)
       VALUES (?, ?, 'draft', ?, ?, ?, ?)`,
    )
    .run(draft.content, draft.sourceNote, generatedByName, draft.postType, draft.videoId, draft.image);
  return db.prepare('SELECT * FROM facebook_posts WHERE id = ?').get(result.lastInsertRowid);
}

module.exports = { isConfigured, generateDraftPost, createDraft, listOptions, POST_TYPES };

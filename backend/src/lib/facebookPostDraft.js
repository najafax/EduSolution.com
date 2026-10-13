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

const MAX_ITEMS_PER_SOURCE = 3;

// Pulls a small amount of the business's own already-public content —
// published news posts, visible services, and published testimonials, the
// same tables routes/public.js's GET /site already serves to the real
// marketing site — as a seed for the AI draft below, rather than asking the
// model to write about this specific Maldives EduPage/business-software
// distributor from nothing. Each source is capped at a handful of rows
// (newest/highest-priority first) — this is a seed for one short post, not
// a full content dump the model has to wade through.
function gatherContentSeed() {
  const posts = db
    .prepare(
      `SELECT title, body FROM website_posts WHERE status = 'published' ORDER BY published_at DESC, id DESC LIMIT ?`,
    )
    .all(MAX_ITEMS_PER_SOURCE);
  const services = db
    .prepare(`SELECT title, description FROM website_services WHERE visible = 1 ORDER BY display_order ASC, id ASC LIMIT ?`)
    .all(MAX_ITEMS_PER_SOURCE);
  const testimonials = db
    .prepare(
      `SELECT quote, author_name FROM website_testimonials WHERE status = 'published' ORDER BY display_order ASC, id DESC LIMIT ?`,
    )
    .all(MAX_ITEMS_PER_SOURCE);

  const lines = [];
  if (posts.length) {
    lines.push('Recent news/announcements:');
    posts.forEach((p) => lines.push(`- "${p.title}": ${(p.body || '').slice(0, 300)}`));
  }
  if (services.length) {
    lines.push('Services offered:');
    services.forEach((s) => lines.push(`- "${s.title}": ${(s.description || '').slice(0, 200)}`));
  }
  if (testimonials.length) {
    lines.push('Client testimonials:');
    testimonials.forEach((t) => lines.push(`- "${t.quote.slice(0, 200)}" — ${t.author_name || 'a client'}`));
  }

  return { seedText: lines.join('\n'), hasContent: lines.length > 0 };
}

const SYSTEM_PROMPT = `You write short, friendly Facebook posts for Edu Solutions, a Maldives-based business that (1) is an authorized EduPage distributor (school management software) and (2) sells its own business-management software (invoicing, quotes, licenses, financials) to small/medium businesses.

Write ONE Facebook post only. Rules:
- Plain text only — no markdown, no headings, no hashtags unless truly natural (max 2-3).
- 2-4 short paragraphs or a few short lines, friendly and professional, never salesy or hype-y.
- If given real content to draw from (a news item, a service, a testimonial), build the post around it naturally. If no content is given, write a general, warm post about Edu Solutions' work (EduPage for schools, or business software for Maldives businesses) — vary the angle each time.
- End with a soft, natural call to action (e.g. inviting people to get in touch), not a hard sell.
- Output ONLY the post text itself — no preamble, no quotes around it, no "Here's a draft:".`;

// generate a single draft post. Returns { content, sourceNote } — sourceNote
// is a short human-readable summary of what the draft was seeded from (shown
// on the review page so staff know what prompted it, see
// routes/facebookPosts.js).
async function generateDraftPost() {
  if (!isConfigured()) {
    const error = new Error('AI drafting is not configured. Set ANTHROPIC_API_KEY in backend/.env.');
    error.code = 'AI_NOT_CONFIGURED';
    throw error;
  }

  const { seedText, hasContent } = gatherContentSeed();
  const userMessage = hasContent
    ? `Here is some real, current content from our own website/CMS to draw inspiration from for this week's post:\n\n${seedText}\n\nWrite one Facebook post based on the most interesting item above.`
    : 'We have no fresh news/service/testimonial content on file right now — write one general, warm Facebook post about Edu Solutions.';

  const response = await client.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const content = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  if (!content) {
    throw new Error('The AI returned an empty draft — try generating again.');
  }

  return { content, sourceNote: hasContent ? seedText.split('\n')[0] : 'General post (no fresh CMS content on file)' };
}

module.exports = { isConfigured, generateDraftPost, gatherContentSeed };

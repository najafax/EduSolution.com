// A thin wrapper around the Facebook Graph API's Page feed endpoint — the
// one real action this feature needs (publish a text post to the
// business's own Facebook Page). Mirrors lib/mailer.js's own
// isConfigured()/*_NOT_CONFIGURED error shape: nothing here is required for
// the rest of the app to work, and every other part of this feature
// (drafting, editing, listing) functions with no Facebook credentials at
// all — only the actual publish step needs them.
const PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const PAGE_ID = process.env.FACEBOOK_PAGE_ID;
const GRAPH_API_VERSION = 'v21.0';

function isConfigured() {
  return Boolean(PAGE_ACCESS_TOKEN && PAGE_ID);
}

// Publishes plain-text `message` to the configured Page's own feed and
// returns the new post's id (Graph API's own `{ id: "<page-id>_<post-id>" }`
// shape). Throws FACEBOOK_NOT_CONFIGURED when the two env vars above aren't
// set — routes/facebookPosts.js catches this and returns a 503, same
// convention every email-sending route in this app already follows for
// EMAIL_NOT_CONFIGURED.
async function publishPost(message) {
  if (!isConfigured()) {
    const error = new Error(
      'Facebook is not configured. Set FACEBOOK_PAGE_ACCESS_TOKEN and FACEBOOK_PAGE_ID in backend/.env.',
    );
    error.code = 'FACEBOOK_NOT_CONFIGURED';
    throw error;
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${PAGE_ID}/feed`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ message, access_token: PAGE_ACCESS_TOKEN }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const apiMessage = data?.error?.message || `Facebook API request failed with status ${res.status}`;
    const error = new Error(apiMessage);
    error.code = 'FACEBOOK_API_ERROR';
    throw error;
  }

  return data.id;
}

module.exports = { isConfigured, publishPost };

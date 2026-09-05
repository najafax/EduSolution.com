const rateLimit = require('express-rate-limit');

function jsonHandler(message) {
  return (req, res) => res.status(429).json({ error: message });
}

const base = {
  standardHeaders: true,
  legacyHeaders: false,
};

const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  handler: jsonHandler('Too many login attempts. Please try again in 15 minutes.'),
});

// Guards POST /public/mod-reports/:token — a leaked (or guessed) link could
// otherwise flood mod_reports with junk submissions. Same 30/hour budget
// the main app's own limiter used for this endpoint before the split.
const modReportSubmitLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 30,
  handler: jsonHandler('Too many submissions from this connection. Please try again later.'),
});

module.exports = { loginLimiter, modReportSubmitLimiter };

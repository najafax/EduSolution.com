const rateLimit = require('express-rate-limit');

// Shared shape so throttled responses look like every other error the API
// returns ({ error }), rather than express-rate-limit's plain-text default.
function jsonHandler(message) {
  return (req, res) => res.status(429).json({ error: message });
}

const base = {
  standardHeaders: true,
  legacyHeaders: false,
};

// Brute-force protection on password checking. Counts every attempt, not
// just failures — a client hammering login is unusual regardless of outcome.
const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  handler: jsonHandler('Too many login attempts. Please try again in 15 minutes.'),
});

// Tighter, because each accepted request sends an email — this is the one
// endpoint an abuser can use to generate outbound mail from your SMTP account.
const forgotPasswordLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 5,
  handler: jsonHandler('Too many password reset requests. Please try again later.'),
});

// Guards against brute-forcing the 32-byte reset token.
const resetPasswordLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 10,
  handler: jsonHandler('Too many attempts. Please request a new reset link.'),
});

module.exports = { loginLimiter, forgotPasswordLimiter, resetPasswordLimiter };

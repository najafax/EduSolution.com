const db = require('../db');

// Lightweight audit trail: who did what to which report. Same shape as the
// main EduSolution app's lib/activity.js — no viewer page for it yet in
// this smaller app, but it's cheap to keep recording from day one.
function logActivity({ userName, action, entityType, entityId, entityLabel = '' }) {
  db.prepare(
    'INSERT INTO activity_log (user_name, action, entity_type, entity_id, entity_label) VALUES (?, ?, ?, ?, ?)',
  ).run(userName, action, entityType, entityId ?? null, entityLabel);
}

module.exports = { logActivity };

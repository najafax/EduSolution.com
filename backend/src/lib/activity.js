const db = require('../db');

// Lightweight audit trail: who did what to which record. Shared data model
// has no per-user ownership, so this is the only record of who touched what.
function logActivity({ userName, action, entityType, entityId, entityLabel = '' }) {
  db.prepare(
    'INSERT INTO activity_log (user_name, action, entity_type, entity_id, entity_label) VALUES (?, ?, ?, ?, ?)',
  ).run(userName, action, entityType, entityId ?? null, entityLabel);
}

module.exports = { logActivity };

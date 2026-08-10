const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = Router();
router.use(requireAuth);

const PAGE_SIZE = 30;

router.get('/', requirePermission('activity', 'view'), (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const { total } = db.prepare('SELECT COUNT(*) AS total FROM activity_log').get();
  const entries = db
    .prepare('SELECT * FROM activity_log ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
    .all(PAGE_SIZE, offset);

  res.json({ entries, page, pageSize: PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
});

module.exports = router;

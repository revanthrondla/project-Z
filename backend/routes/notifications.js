const express = require('express');
const { authenticate, injectTenantDb } = require('../middleware/auth');

const router = express.Router();

// Helper: create a notification (used by other route files)
async function createNotification(db, userId, type, title, message, referenceId = null, referenceType = null) {
  try {
    await db.prepare(`
      INSERT INTO notifications (user_id, type, title, message, reference_id, reference_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, type, title, message, referenceId || null, referenceType || null);
  } catch (err) {
    console.error('Failed to create notification:', err.message);
  }
}

// GET /api/notifications — get current user's notifications (paginated)
// Query params: ?page=1&limit=50 (limit capped at 200)
router.get('/', authenticate, injectTenantDb, async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const totalRow = await req.db.prepare(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ?'
    ).get(req.user.id);

    const notifications = await req.db.prepare(`
      SELECT * FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(req.user.id, limit, offset);

    // Set standard pagination headers (backward-compat: body still returns array)
    res.set('X-Total-Count', String(totalRow.count));
    res.set('X-Page',        String(page));
    res.set('X-Limit',       String(limit));
    res.set('X-Total-Pages', String(Math.ceil(totalRow.count / limit)));
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/notifications/unread-count
router.get('/unread-count', authenticate, injectTenantDb, async (req, res) => {
  try {
    const result = await req.db.prepare(`
      SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0
    `).get(req.user.id);
    res.json({ count: result.count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/notifications/:id/read — mark single notification as read
router.put('/:id/read', authenticate, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await req.db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(id, req.user.id);
    res.json({ message: 'Marked as read' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/notifications/mark-all-read — mark all as read
router.put('/mark-all-read', authenticate, injectTenantDb, async (req, res) => {
  try {
    await req.db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/notifications/:id — delete a notification
router.delete('/:id', authenticate, injectTenantDb, async (req, res) => {
  try {
    await req.db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(parseInt(req.params.id), req.user.id);
    res.json({ message: 'Notification deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.createNotification = createNotification;

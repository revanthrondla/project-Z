/**
 * Tenant Support Routes — Employees & Clients submit tickets; Admins manage them
 *
 * POST   /api/support/tickets              — employee or client creates ticket
 * GET    /api/support/tickets              — admin: all tickets; others: own tickets
 * GET    /api/support/tickets/:id          — ticket + messages (access-controlled)
 * PUT    /api/support/tickets/:id          — admin: update status/priority/category
 * DELETE /api/support/tickets/:id          — admin: delete ticket
 * POST   /api/support/tickets/:id/messages — add message + notify counterpart
 * GET    /api/support/stats                — admin: summary counts
 */
const express = require('express');
const { authenticate, requireAdmin, injectTenantDb, requireModule } = require('../middleware/auth');
const { createNotification } = require('./notifications');

const router = express.Router();
// Authenticate + inject tenant DB + enforce hr_support module subscription
router.use(authenticate, injectTenantDb, requireModule('hr_support'));

// ── POST /api/support/tickets ─────────────────────────────────────────────────
router.post('/tickets', (req, res) => {
  const { id: userId, role } = req.user;
  if (!['admin', 'candidate', 'client'].includes(role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { subject, description, category = 'general', priority = 'medium' } = req.body;
  if (!subject?.trim() || !description?.trim()) {
    return res.status(400).json({ error: 'Subject and description are required' });
  }

  const result = req.db.prepare(`
    INSERT INTO support_tickets (user_id, subject, description, category, priority)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, subject.trim(), description.trim(), category, priority);

  const ticket = req.db.prepare(`
    SELECT t.*, u.name as submitter_name, u.email as submitter_email, u.role as submitter_role
    FROM support_tickets t
    JOIN users u ON u.id = t.user_id
    WHERE t.id = ?
  `).get(result.lastInsertRowid);

  // Notify all admins of new ticket
  const admins = req.db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
  for (const a of admins) {
    if (a.id !== userId) {
      createNotification(
        req.db, a.id, 'support_new',
        `New support ticket: ${subject.trim()}`,
        `${req.user.name} submitted a support request`,
        ticket.id, 'support_ticket'
      );
    }
  }

  res.status(201).json(ticket);
});

// ── GET /api/support/tickets ──────────────────────────────────────────────────
router.get('/tickets', (req, res) => {
  const { id: userId, role } = req.user;
  const { status, priority, category, page = 1, limit = 50 } = req.query;
  const offset = (Math.max(1, parseInt(page)) - 1) * Math.min(100, parseInt(limit) || 50);

  let where = role === 'admin' ? 'WHERE 1=1' : 'WHERE t.user_id = ?';
  const params = role === 'admin' ? [] : [userId];

  if (status)   { where += ' AND t.status = ?';   params.push(status); }
  if (priority) { where += ' AND t.priority = ?'; params.push(priority); }
  if (category) { where += ' AND t.category = ?'; params.push(category); }

  const total = req.db.prepare(
    `SELECT COUNT(*) as c FROM support_tickets t ${where}`
  ).get(...params);

  const tickets = req.db.prepare(`
    SELECT t.*, u.name as submitter_name, u.email as submitter_email, u.role as submitter_role,
           (SELECT COUNT(*) FROM support_ticket_messages WHERE ticket_id = t.id) as message_count,
           (SELECT COUNT(*) FROM support_ticket_messages WHERE ticket_id = t.id AND is_staff = CASE WHEN '${role}' = 'admin' THEN 0 ELSE 1 END AND
            created_at > COALESCE((SELECT MAX(created_at) FROM support_ticket_messages WHERE ticket_id = t.id AND is_staff = CASE WHEN '${role}' = 'admin' THEN 1 ELSE 0 END), '1970-01-01')) as unread_count
    FROM support_tickets t
    JOIN users u ON u.id = t.user_id
    ${where}
    ORDER BY
      CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      t.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, Math.min(100, parseInt(limit) || 50), offset);

  res.json({ tickets, total: total.c, page: parseInt(page) });
});

// ── GET /api/support/tickets/:id ─────────────────────────────────────────────
router.get('/tickets/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { id: userId, role } = req.user;

  const ticket = req.db.prepare(`
    SELECT t.*, u.name as submitter_name, u.email as submitter_email, u.role as submitter_role
    FROM support_tickets t
    JOIN users u ON u.id = t.user_id
    WHERE t.id = ?
  `).get(id);

  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  if (role !== 'admin' && ticket.user_id !== userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const messages = req.db.prepare(`
    SELECT m.*, u.name as sender_name, u.role as sender_role
    FROM support_ticket_messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.ticket_id = ?
    ORDER BY m.created_at ASC
  `).all(id);

  res.json({ ...ticket, messages });
});

// ── PUT /api/support/tickets/:id ─────────────────────────────────────────────
router.put('/tickets/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const ticket = req.db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  const { status, priority, category } = req.body;
  const newStatus   = status   || ticket.status;
  const newPriority = priority || ticket.priority;
  const newCategory = category || ticket.category;

  req.db.prepare(`
    UPDATE support_tickets SET status = ?, priority = ?, category = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(newStatus, newPriority, newCategory, id);

  // Notify the submitter
  const statusLabels = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed' };
  if (status && status !== ticket.status) {
    createNotification(
      req.db, ticket.user_id, 'support_update',
      `Your ticket status updated: ${ticket.subject}`,
      `Status changed to "${statusLabels[newStatus] || newStatus}"`,
      id, 'support_ticket'
    );
  }

  const updated = req.db.prepare(`
    SELECT t.*, u.name as submitter_name, u.email as submitter_email, u.role as submitter_role
    FROM support_tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ?
  `).get(id);
  res.json(updated);
});

// ── DELETE /api/support/tickets/:id ──────────────────────────────────────────
router.delete('/tickets/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const ticket = req.db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  req.db.prepare('DELETE FROM support_tickets WHERE id = ?').run(id);
  res.json({ message: 'Ticket deleted' });
});

// ── POST /api/support/tickets/:id/messages ────────────────────────────────────
router.post('/tickets/:id/messages', (req, res) => {
  const id = parseInt(req.params.id);
  const { id: userId, role } = req.user;

  const ticket = req.db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  const isAdmin = role === 'admin';
  if (!isAdmin && ticket.user_id !== userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });

  req.db.prepare(`
    INSERT INTO support_ticket_messages (ticket_id, user_id, message, is_staff) VALUES (?, ?, ?, ?)
  `).run(id, userId, message.trim(), isAdmin ? 1 : 0);

  req.db.prepare('UPDATE support_tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);

  if (isAdmin) {
    // Notify submitter
    createNotification(
      req.db, ticket.user_id, 'support_reply',
      `Reply on your ticket: ${ticket.subject}`,
      'Support team has responded to your ticket',
      id, 'support_ticket'
    );
  } else {
    // Notify all admins
    const admins = req.db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
    for (const a of admins) {
      createNotification(
        req.db, a.id, 'support_reply',
        `New reply on ticket: ${ticket.subject}`,
        `${req.user.name} replied to support ticket #${id}`,
        id, 'support_ticket'
      );
    }
  }

  const messages = req.db.prepare(`
    SELECT m.*, u.name as sender_name, u.role as sender_role
    FROM support_ticket_messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.ticket_id = ?
    ORDER BY m.created_at ASC
  `).all(id);

  res.status(201).json({ messages });
});

// ── GET /api/support/stats ───────────────────────────────────────────────────
router.get('/stats', requireAdmin, (req, res) => {
  const stats = req.db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
      SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
      SUM(CASE WHEN priority = 'urgent' THEN 1 ELSE 0 END) as urgent,
      SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as high_priority
    FROM support_tickets
  `).get();
  res.json(stats);
});

module.exports = router;

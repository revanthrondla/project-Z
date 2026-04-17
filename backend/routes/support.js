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
router.post('/tickets', async (req, res) => {
  const { id: userId, role } = req.user;
  if (!['admin', 'candidate', 'client'].includes(role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { subject, description, category = 'general', priority = 'medium' } = req.body;
  if (!subject?.trim() || !description?.trim()) {
    return res.status(400).json({ error: 'Subject and description are required' });
  }

  const resultInsert = await req.db.query(`
    INSERT INTO support_tickets (user_id, subject, description, category, priority)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `, [userId, subject.trim(), description.trim(), category, priority]);
  const ticketId = resultInsert.rows[0].id;

  const ticketResult = await req.db.query(`
    SELECT t.*, u.name as submitter_name, u.email as submitter_email, u.role as submitter_role
    FROM support_tickets t
    JOIN users u ON u.id = t.user_id
    WHERE t.id = $1
  `, [ticketId]);
  const ticket = ticketResult.rows[0];

  // Notify all admins of new ticket
  const adminsResult = await req.db.query("SELECT id FROM users WHERE role = 'admin'");
  const admins = adminsResult.rows;
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
router.get('/tickets', async (req, res) => {
  const { id: userId, role } = req.user;
  const { status, priority, category, page = 1, limit = 50 } = req.query;
  const offset = (Math.max(1, parseInt(page)) - 1) * Math.min(100, parseInt(limit) || 50);

  let where = role === 'admin' ? 'WHERE 1=1' : 'WHERE t.user_id = $1';
  const params = role === 'admin' ? [] : [userId];
  let paramIndex = role === 'admin' ? 1 : 2;

  if (status)   { where += ` AND t.status = $${paramIndex++}`; params.push(status); }
  if (priority) { where += ` AND t.priority = $${paramIndex++}`; params.push(priority); }
  if (category) { where += ` AND t.category = $${paramIndex++}`; params.push(category); }

  const totalResult = await req.db.query(
    `SELECT COUNT(*) as c FROM support_tickets t ${where}`,
    params
  );
  const total = totalResult.rows[0];

  const ticketsParams = [...params, Math.min(100, parseInt(limit) || 50), offset];
  const ticketsResult = await req.db.query(`
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
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `, ticketsParams);
  const tickets = ticketsResult.rows;

  res.json({ tickets, total: total.c, page: parseInt(page) });
});

// ── GET /api/support/tickets/:id ─────────────────────────────────────────────
router.get('/tickets/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { id: userId, role } = req.user;

  const ticketResult = await req.db.query(`
    SELECT t.*, u.name as submitter_name, u.email as submitter_email, u.role as submitter_role
    FROM support_tickets t
    JOIN users u ON u.id = t.user_id
    WHERE t.id = $1
  `, [id]);
  const ticket = ticketResult.rows[0];

  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  if (role !== 'admin' && ticket.user_id !== userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const messagesResult = await req.db.query(`
    SELECT m.*, u.name as sender_name, u.role as sender_role
    FROM support_ticket_messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.ticket_id = $1
    ORDER BY m.created_at ASC
  `, [id]);
  const messages = messagesResult.rows;

  res.json({ ...ticket, messages });
});

// ── PUT /api/support/tickets/:id ─────────────────────────────────────────────
router.put('/tickets/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const ticketResult = await req.db.query('SELECT * FROM support_tickets WHERE id = $1', [id]);
  const ticket = ticketResult.rows[0];
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  const { status, priority, category } = req.body;
  const newStatus   = status   || ticket.status;
  const newPriority = priority || ticket.priority;
  const newCategory = category || ticket.category;

  await req.db.query(`
    UPDATE support_tickets SET status = $1, priority = $2, category = $3, updated_at = NOW() WHERE id = $4
  `, [newStatus, newPriority, newCategory, id]);

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

  const updatedResult = await req.db.query(`
    SELECT t.*, u.name as submitter_name, u.email as submitter_email, u.role as submitter_role
    FROM support_tickets t JOIN users u ON u.id = t.user_id WHERE t.id = $1
  `, [id]);
  const updated = updatedResult.rows[0];
  res.json(updated);
});

// ── DELETE /api/support/tickets/:id ──────────────────────────────────────────
router.delete('/tickets/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const ticketResult = await req.db.query('SELECT * FROM support_tickets WHERE id = $1', [id]);
  const ticket = ticketResult.rows[0];
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  await req.db.query('DELETE FROM support_tickets WHERE id = $1', [id]);
  res.json({ message: 'Ticket deleted' });
});

// ── POST /api/support/tickets/:id/messages ────────────────────────────────────
router.post('/tickets/:id/messages', async (req, res) => {
  const id = parseInt(req.params.id);
  const { id: userId, role } = req.user;

  const ticketResult = await req.db.query('SELECT * FROM support_tickets WHERE id = $1', [id]);
  const ticket = ticketResult.rows[0];
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  const isAdmin = role === 'admin';
  if (!isAdmin && ticket.user_id !== userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });

  await req.db.query(`
    INSERT INTO support_ticket_messages (ticket_id, user_id, message, is_staff) VALUES ($1, $2, $3, $4)
  `, [id, userId, message.trim(), isAdmin ? 1 : 0]);

  await req.db.query('UPDATE support_tickets SET updated_at = NOW() WHERE id = $1', [id]);

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
    const adminsResult = await req.db.query("SELECT id FROM users WHERE role = 'admin'");
    const admins = adminsResult.rows;
    for (const a of admins) {
      createNotification(
        req.db, a.id, 'support_reply',
        `New reply on ticket: ${ticket.subject}`,
        `${req.user.name} replied to support ticket #${id}`,
        id, 'support_ticket'
      );
    }
  }

  const messagesResult = await req.db.query(`
    SELECT m.*, u.name as sender_name, u.role as sender_role
    FROM support_ticket_messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.ticket_id = $1
    ORDER BY m.created_at ASC
  `, [id]);
  const messages = messagesResult.rows;

  res.status(201).json({ messages });
});

// ── GET /api/support/stats ───────────────────────────────────────────────────
router.get('/stats', requireAdmin, async (req, res) => {
  const statsResult = await req.db.query(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
      SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
      SUM(CASE WHEN priority = 'urgent' THEN 1 ELSE 0 END) as urgent,
      SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as high_priority
    FROM support_tickets
  `);
  const stats = statsResult.rows[0];
  res.json(stats);
});

module.exports = router;

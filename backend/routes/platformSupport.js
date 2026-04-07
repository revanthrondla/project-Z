/**
 * Platform Support Routes — Super-Admin handles tickets from tenant admins/clients
 *
 * POST   /api/platform-support/tickets            — tenant admin/client submits ticket
 * GET    /api/platform-support/tickets            — super-admin: list all tickets
 * GET    /api/platform-support/tickets/mine       — tenant user: list own tickets
 * GET    /api/platform-support/tickets/:id        — get ticket + messages
 * PUT    /api/platform-support/tickets/:id        — super-admin: update status/priority
 * POST   /api/platform-support/tickets/:id/messages — add message (super-admin or submitter)
 */
const express = require('express');
const { authenticate, requireSuperAdmin, injectTenantDb } = require('../middleware/auth');
const { masterDb } = require('../masterDatabase');
const { getTenantDb } = require('../database');
const { createNotification } = require('./notifications');

const router = express.Router();
router.use(authenticate);

// ── Helper: notify all admins of a tenant via their tenant DB ─────────────────
function notifyTenantAdmins(tenantSlug, type, title, message, refId) {
  try {
    const tdb = getTenantDb(tenantSlug);
    const admins = tdb.prepare("SELECT id FROM users WHERE role = 'admin'").all();
    for (const a of admins) {
      createNotification(tdb, a.id, type, title, message, refId, 'platform_support_ticket');
    }
  } catch (err) {
    console.error('[PlatformSupport] notify error:', err.message);
  }
}

// ── Helper: notify a specific user in a tenant by email ───────────────────────
function notifyTenantUserByEmail(tenantSlug, email, type, title, message, refId) {
  try {
    const tdb = getTenantDb(tenantSlug);
    const user = tdb.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (user) createNotification(tdb, user.id, type, title, message, refId, 'platform_support_ticket');
  } catch (err) {
    console.error('[PlatformSupport] notify-user error:', err.message);
  }
}

// ── POST /api/platform-support/tickets ───────────────────────────────────────
// Tenant admin or client submits a platform-level ticket
router.post('/tickets', injectTenantDb, async (req, res) => {
  const { role, email, tenantSlug } = req.user;
  if (!['admin', 'client', 'candidate'].includes(role)) {
    return res.status(403).json({ error: 'Only tenant users can submit platform support tickets' });
  }
  const { subject, description, priority = 'medium' } = req.body;
  if (!subject?.trim() || !description?.trim()) {
    return res.status(400).json({ error: 'Subject and description are required' });
  }

  const result = await masterDb.prepare(`
    INSERT INTO platform_support_tickets (tenant_slug, submitted_by, submitter_role, subject, description, priority)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tenantSlug, email, role, subject.trim(), description.trim(), priority);

  const ticket = await masterDb.prepare('SELECT * FROM platform_support_tickets WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(ticket);
});

// ── GET /api/platform-support/tickets ─────────────────────────────────────────
// Super-admin: list all tickets (with filters)
router.get('/tickets', requireSuperAdmin, async (req, res) => {
  const { status, priority, tenant, page = 1, limit = 50 } = req.query;
  const offset = (Math.max(1, parseInt(page)) - 1) * Math.min(100, parseInt(limit) || 50);

  let where = 'WHERE 1=1';
  const params = [];
  if (status)   { where += ' AND t.status = ?';      params.push(status); }
  if (priority) { where += ' AND t.priority = ?';    params.push(priority); }
  if (tenant)   { where += ' AND t.tenant_slug = ?'; params.push(tenant); }

  const total = await masterDb.prepare(`SELECT COUNT(*) as c FROM platform_support_tickets t ${where}`).get(...params);
  const tickets = await masterDb.prepare(`
    SELECT t.*,
           (SELECT COUNT(*) FROM platform_support_messages WHERE ticket_id = t.id) as message_count
    FROM platform_support_tickets t
    ${where}
    ORDER BY
      CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      t.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, Math.min(100, parseInt(limit) || 50), offset);

  res.json({ tickets, total: total.c, page: parseInt(page) });
});

// ── GET /api/platform-support/tickets/mine ────────────────────────────────────
// Tenant user: list their own tickets
router.get('/tickets/mine', injectTenantDb, async (req, res) => {
  const { email, tenantSlug } = req.user;
  const tickets = await masterDb.prepare(`
    SELECT t.*,
           (SELECT COUNT(*) FROM platform_support_messages WHERE ticket_id = t.id) as message_count
    FROM platform_support_tickets t
    WHERE t.tenant_slug = ? AND t.submitted_by = ?
    ORDER BY t.created_at DESC
  `).all(tenantSlug, email);
  res.json(tickets);
});

// ── GET /api/platform-support/tickets/:id ─────────────────────────────────────
router.get('/tickets/:id', injectTenantDb, async (req, res) => {
  const id = parseInt(req.params.id);
  const ticket = await masterDb.prepare('SELECT * FROM platform_support_tickets WHERE id = ?').get(id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  // Access: super-admin sees all; tenant users see only their tenant's tickets
  if (req.user.role !== 'super_admin' && ticket.tenant_slug !== req.user.tenantSlug) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const messages = await masterDb.prepare(
    'SELECT * FROM platform_support_messages WHERE ticket_id = ? ORDER BY created_at ASC'
  ).all(id);

  res.json({ ...ticket, messages });
});

// ── PUT /api/platform-support/tickets/:id ─────────────────────────────────────
// Super-admin updates status / priority
router.put('/tickets/:id', requireSuperAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const ticket = await masterDb.prepare('SELECT * FROM platform_support_tickets WHERE id = ?').get(id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  const { status, priority } = req.body;
  const newStatus   = status   || ticket.status;
  const newPriority = priority || ticket.priority;

  await masterDb.prepare(`
    UPDATE platform_support_tickets SET status = ?, priority = ?, updated_at = NOW() WHERE id = ?
  `).run(newStatus, newPriority, id);

  // Notify submitter in tenant DB
  const statusLabels = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed' };
  notifyTenantUserByEmail(
    ticket.tenant_slug,
    ticket.submitted_by,
    'support_update',
    `Support ticket updated: ${ticket.subject}`,
    `Your ticket status has been updated to "${statusLabels[newStatus] || newStatus}"`,
    id
  );

  res.json(await masterDb.prepare('SELECT * FROM platform_support_tickets WHERE id = ?').get(id));
});

// ── POST /api/platform-support/tickets/:id/messages ──────────────────────────
// Super-admin or original submitter adds a message
router.post('/tickets/:id/messages', injectTenantDb, async (req, res) => {
  const id = parseInt(req.params.id);
  const ticket = await masterDb.prepare('SELECT * FROM platform_support_tickets WHERE id = ?').get(id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  const { role, email, tenantSlug } = req.user;
  const isSuperAdmin = role === 'super_admin';

  // Tenant users can only message on their own tickets
  if (!isSuperAdmin && (ticket.tenant_slug !== tenantSlug || ticket.submitted_by !== email)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });

  await masterDb.prepare(`
    INSERT INTO platform_support_messages (ticket_id, sender, sender_role, message)
    VALUES (?, ?, ?, ?)
  `).run(id, email, role, message.trim());

  // Update ticket timestamp
  await masterDb.prepare('UPDATE platform_support_tickets SET updated_at = NOW() WHERE id = ?').run(id);

  if (isSuperAdmin) {
    // Notify submitter
    notifyTenantUserByEmail(
      ticket.tenant_slug, ticket.submitted_by,
      'support_reply',
      `New reply on: ${ticket.subject}`,
      'Support team has replied to your ticket',
      id
    );
  } else {
    // Notify super-admins (best-effort: just log, no master-level notification table yet)
    console.log(`[PlatformSupport] Tenant ${tenantSlug} replied to ticket #${id}`);
  }

  const msgs = await masterDb.prepare(
    'SELECT * FROM platform_support_messages WHERE ticket_id = ? ORDER BY created_at ASC'
  ).all(id);
  res.status(201).json({ messages: msgs });
});

// ── GET /api/platform-support/stats ─────────────────────────────────────────
// Super-admin: summary counts
router.get('/stats', requireSuperAdmin, async (req, res) => {
  const stats = await masterDb.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
      SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
      SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
      SUM(CASE WHEN priority = 'urgent' THEN 1 ELSE 0 END) as urgent,
      SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as high_priority
    FROM platform_support_tickets
  `).get();
  res.json(stats);
});

module.exports = router;

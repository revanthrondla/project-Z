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
// Fire-and-forget — callers do not await this. getTenantDb is async so this
// function must be async; connection is always released in finally.
async function notifyTenantAdmins(tenantSlug, type, title, message, refId) {
  let rel;
  try {
    const { wrapper: tdb, release } = await getTenantDb(tenantSlug);
    rel = release;
    const adminsResult = await tdb.query("SELECT id FROM users WHERE role = 'admin'");
    const admins = adminsResult.rows;
    for (const a of admins) {
      createNotification(tdb, a.id, type, title, message, refId, 'platform_support_ticket');
    }
  } catch (err) {
    console.error('[PlatformSupport] notify error:', err.message);
  } finally {
    if (rel) rel();
  }
}

// ── Helper: notify a specific user in a tenant by email ───────────────────────
async function notifyTenantUserByEmail(tenantSlug, email, type, title, message, refId) {
  let rel;
  try {
    const { wrapper: tdb, release } = await getTenantDb(tenantSlug);
    rel = release;
    const userResult = await tdb.query('SELECT id FROM users WHERE email = $1', [email]);
    const user = userResult.rows[0];
    if (user) createNotification(tdb, user.id, type, title, message, refId, 'platform_support_ticket');
  } catch (err) {
    console.error('[PlatformSupport] notify-user error:', err.message);
  } finally {
    if (rel) rel();
  }
}

// ── POST /api/platform-support/tickets ───────────────────────────────────────
// Only tenant admins can raise platform-level support tickets to super-admin
router.post('/tickets', injectTenantDb, async (req, res) => {
  const { role, email, tenantSlug } = req.user;
  if (role !== 'admin') {
    return res.status(403).json({ error: 'Only tenant admins can submit platform support tickets' });
  }
  const { subject, description, priority = 'medium' } = req.body;
  if (!subject?.trim() || !description?.trim()) {
    return res.status(400).json({ error: 'Subject and description are required' });
  }

  const resultInsert = await masterDb.query(`
    INSERT INTO platform_support_tickets (tenant_slug, submitted_by, submitter_role, subject, description, priority)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
  `, [tenantSlug, email, role, subject.trim(), description.trim(), priority]);
  const ticketId = resultInsert.rows[0].id;

  const ticketResult = await masterDb.query('SELECT * FROM platform_support_tickets WHERE id = $1', [ticketId]);
  const ticket = ticketResult.rows[0];
  res.status(201).json(ticket);
});

// ── GET /api/platform-support/tickets ─────────────────────────────────────────
// Super-admin: list tickets raised by tenant admins only (submitter_role = 'admin')
router.get('/tickets', requireSuperAdmin, async (req, res) => {
  const { status, priority, tenant, page = 1, limit = 50 } = req.query;
  const offset = (Math.max(1, parseInt(page)) - 1) * Math.min(100, parseInt(limit) || 50);

  // Always restrict to tickets submitted by tenant admins
  let where = "WHERE t.submitter_role = 'admin'";
  const params = [];
  let paramIndex = 1;
  if (status)   { where += ` AND t.status = $${paramIndex++}`; params.push(status); }
  if (priority) { where += ` AND t.priority = $${paramIndex++}`; params.push(priority); }
  if (tenant)   { where += ` AND t.tenant_slug = $${paramIndex++}`; params.push(tenant); }

  const totalResult = await masterDb.query(`SELECT COUNT(*) as c FROM platform_support_tickets t ${where}`, params);
  const total = totalResult.rows[0];

  const ticketsParams = [...params, Math.min(100, parseInt(limit) || 50), offset];
  const ticketsResult = await masterDb.query(`
    SELECT t.*,
           (SELECT COUNT(*) FROM platform_support_messages WHERE ticket_id = t.id) as message_count
    FROM platform_support_tickets t
    ${where}
    ORDER BY
      CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      t.updated_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `, ticketsParams);
  const tickets = ticketsResult.rows;

  res.json({ tickets, total: total.c, page: parseInt(page) });
});

// ── GET /api/platform-support/tickets/mine ────────────────────────────────────
// Tenant user: list their own tickets
router.get('/tickets/mine', injectTenantDb, async (req, res) => {
  const { email, tenantSlug } = req.user;
  const ticketsResult = await masterDb.query(`
    SELECT t.*,
           (SELECT COUNT(*) FROM platform_support_messages WHERE ticket_id = t.id) as message_count
    FROM platform_support_tickets t
    WHERE t.tenant_slug = $1 AND t.submitted_by = $2
    ORDER BY t.created_at DESC
  `, [tenantSlug, email]);
  const tickets = ticketsResult.rows;
  res.json(tickets);
});

// ── GET /api/platform-support/tickets/:id ─────────────────────────────────────
router.get('/tickets/:id', injectTenantDb, async (req, res) => {
  const id = parseInt(req.params.id);
  const ticketResult = await masterDb.query('SELECT * FROM platform_support_tickets WHERE id = $1', [id]);
  const ticket = ticketResult.rows[0];
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  // Access: super-admin sees all; tenant users see only their tenant's tickets
  if (req.user.role !== 'super_admin' && ticket.tenant_slug !== req.user.tenantSlug) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const messagesResult = await masterDb.query(
    'SELECT * FROM platform_support_messages WHERE ticket_id = $1 ORDER BY created_at ASC',
    [id]
  );
  const messages = messagesResult.rows;

  res.json({ ...ticket, messages });
});

// ── PUT /api/platform-support/tickets/:id ─────────────────────────────────────
// Super-admin updates status / priority
router.put('/tickets/:id', requireSuperAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const ticketResult = await masterDb.query('SELECT * FROM platform_support_tickets WHERE id = $1', [id]);
  const ticket = ticketResult.rows[0];
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  const { status, priority } = req.body;
  const newStatus   = status   || ticket.status;
  const newPriority = priority || ticket.priority;

  await masterDb.query(`
    UPDATE platform_support_tickets SET status = $1, priority = $2, updated_at = NOW() WHERE id = $3
  `, [newStatus, newPriority, id]);

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

  const updatedResult = await masterDb.query('SELECT * FROM platform_support_tickets WHERE id = $1', [id]);
  const updated = updatedResult.rows[0];
  res.json(updated);
});

// ── POST /api/platform-support/tickets/:id/messages ──────────────────────────
// Super-admin or original submitter adds a message
router.post('/tickets/:id/messages', injectTenantDb, async (req, res) => {
  const id = parseInt(req.params.id);
  const ticketResult = await masterDb.query('SELECT * FROM platform_support_tickets WHERE id = $1', [id]);
  const ticket = ticketResult.rows[0];
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  const { role, email, tenantSlug } = req.user;
  const isSuperAdmin = role === 'super_admin';

  // Tenant users can only message on their own tickets
  if (!isSuperAdmin && (ticket.tenant_slug !== tenantSlug || ticket.submitted_by !== email)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });

  await masterDb.query(`
    INSERT INTO platform_support_messages (ticket_id, sender, sender_role, message)
    VALUES ($1, $2, $3, $4)
  `, [id, email, role, message.trim()]);

  // Update ticket timestamp
  await masterDb.query('UPDATE platform_support_tickets SET updated_at = NOW() WHERE id = $1', [id]);

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

  const msgsResult = await masterDb.query(
    'SELECT * FROM platform_support_messages WHERE ticket_id = $1 ORDER BY created_at ASC',
    [id]
  );
  const msgs = msgsResult.rows;
  res.status(201).json({ messages: msgs });
});

// ── GET /api/platform-support/stats ─────────────────────────────────────────
// Super-admin: summary counts — scoped to tenant-admin-submitted tickets only
router.get('/stats', requireSuperAdmin, async (req, res) => {
  const statsResult = await masterDb.query(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
      SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
      SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
      SUM(CASE WHEN priority = 'urgent' THEN 1 ELSE 0 END) as urgent,
      SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as high_priority
    FROM platform_support_tickets
    WHERE submitter_role = 'admin'
  `);
  const stats = statsResult.rows[0];
  res.json(stats);
});

module.exports = router;

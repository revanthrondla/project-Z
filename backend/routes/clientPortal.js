const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { authenticate, requireAdmin, injectTenantDb, JWT_SECRET } = require('../middleware/auth');

// ── Middleware: client role only ───────────────────────────────────────────
function requireClient(req, res, next) {
  if (req.user.role !== 'client') {
    return res.status(403).json({ error: 'Client access required' });
  }
  next();
}

// ── Admin: create a login for a client ───────────────────────────────────
// POST /api/client-portal/admin/clients/:id/create-login
router.post('/admin/clients/:id/create-login', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  const clientId = parseInt(req.params.id);
  const { email, name, password } = req.body;

  if (!email || !name || !password) {
    return res.status(400).json({ error: 'email, name, and password are required' });
  }

  const client = await req.db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  // Check not already linked
  if (client.user_id) {
    return res.status(400).json({ error: 'This client already has a login account' });
  }

  // Check email unique
  const existing = await req.db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(400).json({ error: 'Email already in use' });

  const hash = await bcrypt.hash(password, 10);
  const userResult = await req.db.prepare(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'client')"
  ).run(name.trim(), email.toLowerCase(), hash);

  await req.db.prepare('UPDATE clients SET user_id = ? WHERE id = ?').run(userResult.lastInsertRowid, clientId);

  res.json({ message: 'Client login created', userId: userResult.lastInsertRowid });
});

// ── Admin: remove client login ────────────────────────────────────────────
router.delete('/admin/clients/:id/remove-login', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  const clientId = parseInt(req.params.id);
  const client = await req.db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!client.user_id) return res.status(400).json({ error: 'No login to remove' });

  await req.db.prepare('DELETE FROM users WHERE id = ?').run(client.user_id);
  await req.db.prepare('UPDATE clients SET user_id = NULL WHERE id = ?').run(clientId);

  res.json({ message: 'Client login removed' });
});

// ── Client: get own profile + client record ───────────────────────────────
// GET /api/client-portal/me
router.get('/me', authenticate, requireClient, injectTenantDb, async (req, res) => {
  const client = await req.db.prepare('SELECT * FROM clients WHERE user_id = ?').get(req.user.id);
  if (!client) return res.status(404).json({ error: 'No client record linked to this account' });
  res.json({ user: req.user, client });
});

// ── Client: dashboard — candidates working for this client ───────────────
// GET /api/client-portal/dashboard
router.get('/dashboard', authenticate, requireClient, injectTenantDb, async (req, res) => {
  const client = await req.db.prepare('SELECT * FROM clients WHERE user_id = ?').get(req.user.id);
  if (!client) return res.status(404).json({ error: 'No client record found' });

  const candidates = await req.db.prepare(`
    SELECT
      c.id, c.name, c.email, c.phone, c.role, c.hourly_rate,
      c.start_date, c.end_date, c.status, c.contract_type,
      COALESCE(SUM(CASE WHEN te.status = 'approved' THEN te.hours ELSE 0 END), 0) AS approved_hours,
      COALESCE(SUM(CASE WHEN te.status = 'pending'  THEN te.hours ELSE 0 END), 0) AS pending_hours,
      COALESCE(SUM(CASE WHEN te.status = 'approved' THEN te.hours * c.hourly_rate ELSE 0 END), 0) AS approved_amount
    FROM candidates c
    LEFT JOIN time_entries te ON te.candidate_id = c.id
    WHERE c.client_id = ?
    GROUP BY c.id
    ORDER BY c.name
  `).all(client.id);

  const recentTimesheets = await req.db.prepare(`
    SELECT te.*, cand.name AS candidate_name
    FROM time_entries te
    JOIN candidates cand ON te.candidate_id = cand.id
    WHERE cand.client_id = ?
    ORDER BY te.date DESC
    LIMIT 20
  `).all(client.id);

  const kpis = await req.db.prepare(`
    SELECT
      COUNT(DISTINCT c.id) AS total_candidates,
      COALESCE(SUM(CASE WHEN te.status='approved' THEN te.hours ELSE 0 END), 0) AS total_approved_hours,
      COALESCE(SUM(CASE WHEN te.status='pending'  THEN te.hours ELSE 0 END), 0) AS total_pending_hours,
      COALESCE(SUM(CASE WHEN te.status='approved' THEN te.hours * c.hourly_rate ELSE 0 END), 0) AS total_cost
    FROM candidates c
    LEFT JOIN time_entries te ON te.candidate_id = c.id
    WHERE c.client_id = ?
  `).get(client.id);

  res.json({ client, candidates, recentTimesheets, kpis });
});

// ── Client: list invoices for this client ─────────────────────────────────
// GET /api/client-portal/invoices
router.get('/invoices', authenticate, requireClient, injectTenantDb, async (req, res) => {
  const client = await req.db.prepare('SELECT * FROM clients WHERE user_id = ?').get(req.user.id);
  if (!client) return res.status(404).json({ error: 'No client record found' });

  const invoices = await req.db.prepare(`
    SELECT i.*, cand.name AS candidate_name, cand.role AS candidate_role
    FROM invoices i
    JOIN candidates cand ON i.candidate_id = cand.id
    WHERE i.client_id = ?
    ORDER BY i.period_start DESC
  `).all(client.id);

  res.json({ invoices });
});

// ── Client: get a single invoice + line items ────────────────────────────
// GET /api/client-portal/invoices/:id
router.get('/invoices/:id', authenticate, requireClient, injectTenantDb, async (req, res) => {
  const client = await req.db.prepare('SELECT * FROM clients WHERE user_id = ?').get(req.user.id);
  if (!client) return res.status(404).json({ error: 'No client record found' });

  const invoice = await req.db.prepare(`
    SELECT i.*, cand.name AS candidate_name, cand.role AS candidate_role, cand.hourly_rate
    FROM invoices i
    JOIN candidates cand ON i.candidate_id = cand.id
    WHERE i.id = ? AND i.client_id = ?
  `).get(req.params.id, client.id);

  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const lineItems = await req.db.prepare(
    'SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY date'
  ).all(invoice.id);

  res.json({ invoice, lineItems });
});

// ── Client: update a line item (date, description, hours) ────────────────
// PUT /api/client-portal/invoices/:id/line-items/:lineId
router.put('/invoices/:id/line-items/:lineId', authenticate, requireClient, injectTenantDb, async (req, res) => {
  const client = await req.db.prepare('SELECT * FROM clients WHERE user_id = ?').get(req.user.id);
  if (!client) return res.status(404).json({ error: 'No client record found' });

  // Verify invoice belongs to this client and is in reviewable state
  const invoice = await req.db.prepare(
    "SELECT * FROM invoices WHERE id = ? AND client_id = ?"
  ).get(req.params.id, client.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const allowedStatuses = ['sent', 'client_approved', 'draft'];
  if (!allowedStatuses.includes(invoice.status)) {
    return res.status(400).json({ error: `Cannot edit line items on a ${invoice.status} invoice` });
  }

  const lineItem = await req.db.prepare(
    'SELECT * FROM invoice_line_items WHERE id = ? AND invoice_id = ?'
  ).get(req.params.lineId, req.params.id);
  if (!lineItem) return res.status(404).json({ error: 'Line item not found' });

  const { date, description, hours } = req.body;
  const newHours = parseFloat(hours);
  if (isNaN(newHours) || newHours <= 0) {
    return res.status(400).json({ error: 'hours must be a positive number' });
  }

  const newAmount = parseFloat((newHours * lineItem.rate).toFixed(2));

  await req.db.prepare(
    'UPDATE invoice_line_items SET date = ?, description = ?, hours = ?, amount = ? WHERE id = ?'
  ).run(date || lineItem.date, description ?? lineItem.description, newHours, newAmount, lineItem.id);

  // Recalculate invoice totals from line items
  const totals = await req.db.prepare(`
    SELECT COALESCE(SUM(hours), 0) AS total_hours, COALESCE(SUM(amount), 0) AS total_amount
    FROM invoice_line_items WHERE invoice_id = ?
  `).get(invoice.id);

  await req.db.prepare(
    "UPDATE invoices SET total_hours = ?, total_amount = ?, updated_at = NOW() WHERE id = ?"
  ).run(totals.total_hours, totals.total_amount, invoice.id);

  const updatedLineItem = await req.db.prepare('SELECT * FROM invoice_line_items WHERE id = ?').get(lineItem.id);
  const updatedInvoice = await req.db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice.id);

  res.json({ lineItem: updatedLineItem, invoice: updatedInvoice });
});

// ── Client: add a note on invoice ────────────────────────────────────────
// PUT /api/client-portal/invoices/:id/notes
router.put('/invoices/:id/notes', authenticate, requireClient, injectTenantDb, async (req, res) => {
  const client = await req.db.prepare('SELECT * FROM clients WHERE user_id = ?').get(req.user.id);
  if (!client) return res.status(404).json({ error: 'No client record found' });

  const invoice = await req.db.prepare(
    'SELECT * FROM invoices WHERE id = ? AND client_id = ?'
  ).get(req.params.id, client.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  await req.db.prepare(
    "UPDATE invoices SET client_notes = ?, updated_at = NOW() WHERE id = ?"
  ).run(req.body.client_notes ?? '', invoice.id);

  res.json({ message: 'Notes saved' });
});

// ── Client: approve invoice ───────────────────────────────────────────────
// POST /api/client-portal/invoices/:id/approve
router.post('/invoices/:id/approve', authenticate, requireClient, injectTenantDb, async (req, res) => {
  const client = await req.db.prepare('SELECT * FROM clients WHERE user_id = ?').get(req.user.id);
  if (!client) return res.status(404).json({ error: 'No client record found' });

  const invoice = await req.db.prepare(
    'SELECT * FROM invoices WHERE id = ? AND client_id = ?'
  ).get(req.params.id, client.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const allowedStatuses = ['sent', 'draft'];
  if (!allowedStatuses.includes(invoice.status)) {
    return res.status(400).json({ error: `Cannot approve an invoice with status: ${invoice.status}` });
  }

  await req.db.prepare(
    "UPDATE invoices SET status = 'client_approved', client_notes = ?, updated_at = NOW() WHERE id = ?"
  ).run(req.body.client_notes ?? invoice.client_notes ?? null, invoice.id);

  const updated = await req.db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice.id);
  res.json({ message: 'Invoice approved by client', invoice: updated });
});

// ── Client: reject / request revision ────────────────────────────────────
// POST /api/client-portal/invoices/:id/reject
router.post('/invoices/:id/reject', authenticate, requireClient, injectTenantDb, async (req, res) => {
  const client = await req.db.prepare('SELECT * FROM clients WHERE user_id = ?').get(req.user.id);
  if (!client) return res.status(404).json({ error: 'No client record found' });

  const invoice = await req.db.prepare(
    'SELECT * FROM invoices WHERE id = ? AND client_id = ?'
  ).get(req.params.id, client.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const allowedStatuses = ['sent', 'client_approved'];
  if (!allowedStatuses.includes(invoice.status)) {
    return res.status(400).json({ error: `Cannot reject an invoice with status: ${invoice.status}` });
  }

  await req.db.prepare(
    "UPDATE invoices SET status = 'sent', client_notes = ?, updated_at = NOW() WHERE id = ?"
  ).run(req.body.client_notes ?? null, invoice.id);

  const updated = await req.db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice.id);
  res.json({ message: 'Invoice sent back for revision', invoice: updated });
});

module.exports = router;

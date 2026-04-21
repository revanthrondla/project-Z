const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { authenticate, requireAdmin, injectTenantDb, JWT_SECRET } = require('../middleware/auth');
const { indexUserEmail } = require('../masterDatabase');

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

  const clientResult = await req.db.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  const client = clientResult.rows[0];
  if (!client) return res.status(404).json({ error: 'Client not found' });

  // Check not already linked
  if (client.user_id) {
    return res.status(400).json({ error: 'This client already has a login account' });
  }

  // Check email unique
  const existingResult = await req.db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  const existing = existingResult.rows[0];
  if (existing) return res.status(400).json({ error: 'Email already in use' });

  const hash = await bcrypt.hash(password, 10);
  const userResult = await req.db.query(
    "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id",
    [name.trim(), email.toLowerCase(), hash, 'client']
  );
  const newUserId = userResult.rows[0].id;

  await req.db.query('UPDATE clients SET user_id = $1 WHERE id = $2', [newUserId, clientId]);

  // Index email → tenant for seamless login
  indexUserEmail(email.toLowerCase(), req.user.tenantSlug).catch(() => {});

  res.json({ message: 'Client login created', userId: newUserId });
});

// ── Admin: remove client login ────────────────────────────────────────────
router.delete('/admin/clients/:id/remove-login', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  const clientId = parseInt(req.params.id);
  const clientResult = await req.db.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  const client = clientResult.rows[0];
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!client.user_id) return res.status(400).json({ error: 'No login to remove' });

  await req.db.query('DELETE FROM users WHERE id = $1', [client.user_id]);
  await req.db.query('UPDATE clients SET user_id = NULL WHERE id = $1', [clientId]);

  res.json({ message: 'Client login removed' });
});

// ── Client: get own profile + client record ───────────────────────────────
// GET /api/client-portal/me
router.get('/me', authenticate, requireClient, injectTenantDb, async (req, res) => {
  const clientResult = await req.db.query('SELECT * FROM clients WHERE user_id = $1', [req.user.id]);
  const client = clientResult.rows[0];
  if (!client) return res.status(404).json({ error: 'No client record linked to this account' });
  res.json({ user: req.user, client });
});

// ── Client: dashboard — candidates working for this client ───────────────
// GET /api/client-portal/dashboard
router.get('/dashboard', authenticate, requireClient, injectTenantDb, async (req, res) => {
  const clientResult = await req.db.query('SELECT * FROM clients WHERE user_id = $1', [req.user.id]);
  const client = clientResult.rows[0];
  if (!client) return res.status(404).json({ error: 'No client record found' });

  const candidatesResult = await req.db.query(`
    SELECT
      c.id, c.name, c.email, c.phone, c.role, c.hourly_rate,
      c.start_date, c.end_date, c.status, c.contract_type,
      COALESCE(SUM(CASE WHEN te.status = 'approved' THEN te.hours ELSE 0 END), 0) AS approved_hours,
      COALESCE(SUM(CASE WHEN te.status = 'pending'  THEN te.hours ELSE 0 END), 0) AS pending_hours,
      COALESCE(SUM(CASE WHEN te.status = 'approved' THEN te.hours * c.hourly_rate ELSE 0 END), 0) AS approved_amount
    FROM candidates c
    LEFT JOIN time_entries te ON te.candidate_id = c.id
    WHERE c.client_id = $1
    GROUP BY c.id
    ORDER BY c.name
  `, [client.id]);
  const candidates = candidatesResult.rows;

  const recentTimesheetsResult = await req.db.query(`
    SELECT te.*, cand.name AS candidate_name
    FROM time_entries te
    JOIN candidates cand ON te.candidate_id = cand.id
    WHERE cand.client_id = $1
    ORDER BY te.date DESC
    LIMIT 20
  `, [client.id]);
  const recentTimesheets = recentTimesheetsResult.rows;

  const kpisResult = await req.db.query(`
    SELECT
      COUNT(DISTINCT c.id) AS total_candidates,
      COALESCE(SUM(CASE WHEN te.status='approved' THEN te.hours ELSE 0 END), 0) AS total_approved_hours,
      COALESCE(SUM(CASE WHEN te.status='pending'  THEN te.hours ELSE 0 END), 0) AS total_pending_hours,
      COALESCE(SUM(CASE WHEN te.status='approved' THEN te.hours * c.hourly_rate ELSE 0 END), 0) AS total_cost
    FROM candidates c
    LEFT JOIN time_entries te ON te.candidate_id = c.id
    WHERE c.client_id = $1
  `, [client.id]);
  const kpis = kpisResult.rows[0];

  res.json({ client, candidates, recentTimesheets, kpis });
});

// ── Client: list invoices for this client ─────────────────────────────────
// GET /api/client-portal/invoices
router.get('/invoices', authenticate, requireClient, injectTenantDb, async (req, res) => {
  const clientResult = await req.db.query('SELECT * FROM clients WHERE user_id = $1', [req.user.id]);
  const client = clientResult.rows[0];
  if (!client) return res.status(404).json({ error: 'No client record found' });

  const invoicesResult = await req.db.query(`
    SELECT i.*, cand.name AS candidate_name, cand.role AS candidate_role
    FROM invoices i
    JOIN candidates cand ON i.candidate_id = cand.id
    WHERE i.client_id = $1
    ORDER BY i.period_start DESC
  `, [client.id]);

  res.json({ invoices: invoicesResult.rows });
});

// ── Client: get a single invoice + line items ────────────────────────────
// GET /api/client-portal/invoices/:id
router.get('/invoices/:id', authenticate, requireClient, injectTenantDb, async (req, res) => {
  const clientResult = await req.db.query('SELECT * FROM clients WHERE user_id = $1', [req.user.id]);
  const client = clientResult.rows[0];
  if (!client) return res.status(404).json({ error: 'No client record found' });

  const invoiceResult = await req.db.query(`
    SELECT i.*, cand.name AS candidate_name, cand.role AS candidate_role, cand.hourly_rate
    FROM invoices i
    JOIN candidates cand ON i.candidate_id = cand.id
    WHERE i.id = $1 AND i.client_id = $2
  `, [req.params.id, client.id]);
  const invoice = invoiceResult.rows[0];

  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const lineItemsResult = await req.db.query(
    'SELECT * FROM invoice_line_items WHERE invoice_id = $1 ORDER BY date',
    [invoice.id]
  );

  res.json({ invoice, lineItems: lineItemsResult.rows });
});

// ── Client: update a line item (date, description, hours) ────────────────
// PUT /api/client-portal/invoices/:id/line-items/:lineId
router.put('/invoices/:id/line-items/:lineId', authenticate, requireClient, injectTenantDb, async (req, res) => {
  const clientResult = await req.db.query('SELECT * FROM clients WHERE user_id = $1', [req.user.id]);
  const client = clientResult.rows[0];
  if (!client) return res.status(404).json({ error: 'No client record found' });

  // Verify invoice belongs to this client and is in reviewable state
  const invoiceResult = await req.db.query(
    "SELECT * FROM invoices WHERE id = $1 AND client_id = $2",
    [req.params.id, client.id]
  );
  const invoice = invoiceResult.rows[0];
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const allowedStatuses = ['sent', 'client_approved', 'draft'];
  if (!allowedStatuses.includes(invoice.status)) {
    return res.status(400).json({ error: `Cannot edit line items on a ${invoice.status} invoice` });
  }

  const lineItemResult = await req.db.query(
    'SELECT * FROM invoice_line_items WHERE id = $1 AND invoice_id = $2',
    [req.params.lineId, req.params.id]
  );
  const lineItem = lineItemResult.rows[0];
  if (!lineItem) return res.status(404).json({ error: 'Line item not found' });

  const { date, description, hours } = req.body;
  const newHours = parseFloat(hours);
  if (isNaN(newHours) || newHours <= 0) {
    return res.status(400).json({ error: 'hours must be a positive number' });
  }

  const newAmount = parseFloat((newHours * lineItem.rate).toFixed(2));

  await req.db.query(
    'UPDATE invoice_line_items SET date = $1, description = $2, hours = $3, amount = $4 WHERE id = $5',
    [date || lineItem.date, description ?? lineItem.description, newHours, newAmount, lineItem.id]
  );

  // Recalculate invoice totals from line items
  const totalsResult = await req.db.query(`
    SELECT COALESCE(SUM(hours), 0) AS total_hours, COALESCE(SUM(amount), 0) AS total_amount
    FROM invoice_line_items WHERE invoice_id = $1
  `, [invoice.id]);
  const totals = totalsResult.rows[0];

  await req.db.query(
    "UPDATE invoices SET total_hours = $1, total_amount = $2, updated_at = NOW() WHERE id = $3",
    [totals.total_hours, totals.total_amount, invoice.id]
  );

  const updatedLineItemResult = await req.db.query('SELECT * FROM invoice_line_items WHERE id = $1', [lineItem.id]);
  const updatedLineItem = updatedLineItemResult.rows[0];

  const updatedInvoiceResult = await req.db.query('SELECT * FROM invoices WHERE id = $1', [invoice.id]);
  const updatedInvoice = updatedInvoiceResult.rows[0];

  res.json({ lineItem: updatedLineItem, invoice: updatedInvoice });
});

// ── Client: add a note on invoice ────────────────────────────────────────
// PUT /api/client-portal/invoices/:id/notes
router.put('/invoices/:id/notes', authenticate, requireClient, injectTenantDb, async (req, res) => {
  const clientResult = await req.db.query('SELECT * FROM clients WHERE user_id = $1', [req.user.id]);
  const client = clientResult.rows[0];
  if (!client) return res.status(404).json({ error: 'No client record found' });

  const invoiceResult = await req.db.query(
    'SELECT * FROM invoices WHERE id = $1 AND client_id = $2',
    [req.params.id, client.id]
  );
  const invoice = invoiceResult.rows[0];
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  await req.db.query(
    "UPDATE invoices SET client_notes = $1, updated_at = NOW() WHERE id = $2",
    [req.body.client_notes ?? '', invoice.id]
  );

  res.json({ message: 'Notes saved' });
});

// ── Client: approve invoice ───────────────────────────────────────────────
// POST /api/client-portal/invoices/:id/approve
router.post('/invoices/:id/approve', authenticate, requireClient, injectTenantDb, async (req, res) => {
  const clientResult = await req.db.query('SELECT * FROM clients WHERE user_id = $1', [req.user.id]);
  const client = clientResult.rows[0];
  if (!client) return res.status(404).json({ error: 'No client record found' });

  const invoiceResult = await req.db.query(
    'SELECT * FROM invoices WHERE id = $1 AND client_id = $2',
    [req.params.id, client.id]
  );
  const invoice = invoiceResult.rows[0];
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const allowedStatuses = ['sent', 'draft'];
  if (!allowedStatuses.includes(invoice.status)) {
    return res.status(400).json({ error: `Cannot approve an invoice with status: ${invoice.status}` });
  }

  await req.db.query(
    "UPDATE invoices SET status = $1, client_notes = $2, updated_at = NOW() WHERE id = $3",
    ['client_approved', req.body.client_notes ?? invoice.client_notes ?? null, invoice.id]
  );

  const updatedResult = await req.db.query('SELECT * FROM invoices WHERE id = $1', [invoice.id]);
  const updated = updatedResult.rows[0];
  res.json({ message: 'Invoice approved by client', invoice: updated });
});

// ── Client: reject / request revision ────────────────────────────────────
// POST /api/client-portal/invoices/:id/reject
router.post('/invoices/:id/reject', authenticate, requireClient, injectTenantDb, async (req, res) => {
  const clientResult = await req.db.query('SELECT * FROM clients WHERE user_id = $1', [req.user.id]);
  const client = clientResult.rows[0];
  if (!client) return res.status(404).json({ error: 'No client record found' });

  const invoiceResult = await req.db.query(
    'SELECT * FROM invoices WHERE id = $1 AND client_id = $2',
    [req.params.id, client.id]
  );
  const invoice = invoiceResult.rows[0];
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const allowedStatuses = ['sent', 'client_approved'];
  if (!allowedStatuses.includes(invoice.status)) {
    return res.status(400).json({ error: `Cannot reject an invoice with status: ${invoice.status}` });
  }

  await req.db.query(
    "UPDATE invoices SET status = $1, client_notes = $2, updated_at = NOW() WHERE id = $3",
    ['sent', req.body.client_notes ?? null, invoice.id]
  );

  const updatedResult = await req.db.query('SELECT * FROM invoices WHERE id = $1', [invoice.id]);
  const updated = updatedResult.rows[0];
  res.json({ message: 'Invoice sent back for revision', invoice: updated });
});

module.exports = router;

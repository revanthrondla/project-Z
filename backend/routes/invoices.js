const express = require('express');
const PDFDocument = require('pdfkit');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');

const router = express.Router();

function generateInvoiceNumber(db) {
  const year = new Date().getFullYear();
  const last = db.prepare("SELECT invoice_number FROM invoices ORDER BY id DESC LIMIT 1").get();
  let seq = 1;
  if (last) {
    const parts = last.invoice_number.split('-');
    seq = parseInt(parts[parts.length - 1]) + 1;
  }
  return `INV-${year}-${String(seq).padStart(3, '0')}`;
}

// GET /api/invoices
router.get('/', authenticate, injectTenantDb, (req, res) => {
  const { candidate_id, status, year } = req.query;
  let query = `
    SELECT i.*, c.name as candidate_name, c.hourly_rate as candidate_rate,
           cl.name as client_name
    FROM invoices i
    JOIN candidates c ON i.candidate_id = c.id
    LEFT JOIN clients cl ON i.client_id = cl.id
    WHERE 1=1
  `;
  const params = [];

  if (req.user.role === 'candidate') {
    // Candidates see only their own invoices
    query += ' AND i.candidate_id = ?';
    params.push(req.user.candidateId);
  } else if (req.user.role === 'client') {
    // Clients see only invoices for their client_id (regardless of query params)
    query += ' AND i.client_id = ?';
    params.push(req.user.clientId);
  } else if (candidate_id) {
    // Admin may filter by candidate
    query += ' AND i.candidate_id = ?';
    params.push(parseInt(candidate_id, 10));
  }

  if (status) { query += ' AND i.status = ?'; params.push(status); }
  if (year) { query += ' AND i.period_start LIKE ?'; params.push(`${year}%`); }

  query += ' ORDER BY i.created_at DESC';

  const invoices = req.db.prepare(query).all(...params);
  res.json(invoices);
});

// GET /api/invoices/:id
router.get('/:id', authenticate, injectTenantDb, (req, res) => {
  const invoice = req.db.prepare(`
    SELECT i.*, c.name as candidate_name, c.email as candidate_email,
           c.role as candidate_role, c.hourly_rate as candidate_rate,
           cl.name as client_name, cl.contact_email as client_email, cl.address as client_address
    FROM invoices i
    JOIN candidates c ON i.candidate_id = c.id
    LEFT JOIN clients cl ON i.client_id = cl.id
    WHERE i.id = ?
  `).get(req.params.id);

  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  // Candidates can only see their own invoices
  if (req.user.role === 'candidate' && invoice.candidate_id !== req.user.candidateId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  // Clients can only see invoices belonging to their client account
  if (req.user.role === 'client' && invoice.client_id !== req.user.clientId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const lineItems = req.db.prepare('SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY date').all(invoice.id);
  res.json({ ...invoice, line_items: lineItems });
});

// GET /api/invoices/:id/pdf — Download invoice as PDF (admin, candidate, client)
router.get('/:id/pdf', authenticate, injectTenantDb, (req, res) => {
  const invoice = req.db.prepare(`
    SELECT i.*,
           c.name  AS candidate_name, c.email AS candidate_email, c.role AS candidate_role,
           c.hourly_rate AS candidate_rate,
           cl.name AS client_name, cl.contact_email AS client_email,
           cl.address AS client_address
    FROM invoices i
    JOIN candidates c  ON i.candidate_id = c.id
    LEFT JOIN clients cl ON i.client_id = cl.id
    WHERE i.id = ?
  `).get(req.params.id);

  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (req.user.role === 'candidate' && invoice.candidate_id !== req.user.candidateId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (req.user.role === 'client' && invoice.client_id !== req.user.clientId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const lineItems = req.db.prepare(
    'SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY date'
  ).all(invoice.id);

  const companyName = req.user.tenantName || 'aGrow';

  // ── Build PDF ──────────────────────────────────────────────────────────────
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const filename = `${invoice.invoice_number}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  const BLUE   = '#1e40af';
  const GREY   = '#6b7280';
  const LIGHT  = '#f3f4f6';
  const BLACK  = '#111827';
  const pageW  = doc.page.width - 100; // usable width

  // ── Header bar ─────────────────────────────────────────────────────────────
  doc.rect(0, 0, doc.page.width, 80).fill(BLUE);
  doc.fillColor('white').fontSize(22).font('Helvetica-Bold').text(companyName, 50, 25);
  doc.fontSize(10).font('Helvetica').text('Time Tracking & Invoice Management', 50, 52);

  // ── Invoice title + number ─────────────────────────────────────────────────
  doc.fillColor(BLACK).fontSize(20).font('Helvetica-Bold').text('INVOICE', 50, 105);
  doc.fillColor(GREY).fontSize(10).font('Helvetica')
     .text(invoice.invoice_number, 50, 130);

  // Status badge (top-right)
  const statusColor = {
    paid: '#16a34a', sent: '#2563eb', draft: '#9ca3af',
    overdue: '#dc2626', cancelled: '#6b7280', client_approved: '#7c3aed'
  }[invoice.status] || GREY;
  doc.roundedRect(doc.page.width - 130, 105, 80, 26, 4).fill(statusColor);
  doc.fillColor('white').fontSize(10).font('Helvetica-Bold')
     .text(invoice.status.toUpperCase().replace('_', ' '), doc.page.width - 126, 113, { width: 72, align: 'center' });

  // ── Two-column meta block ──────────────────────────────────────────────────
  doc.y = 165;
  const col2X = 300;

  const metaLabel = (label, value, x, y) => {
    doc.fillColor(GREY).fontSize(8).font('Helvetica-Bold').text(label.toUpperCase(), x, y);
    doc.fillColor(BLACK).fontSize(10).font('Helvetica').text(value || '—', x, y + 12);
  };

  let metaY = 165;
  metaLabel('Bill To',     invoice.client_name || 'N/A',          50,    metaY);
  metaLabel('Employee',    invoice.candidate_name,                 col2X, metaY);
  metaY += 38;
  metaLabel('Period',      `${invoice.period_start} → ${invoice.period_end}`, 50, metaY);
  metaLabel('Role',        invoice.candidate_role || '—',          col2X, metaY);
  metaY += 38;
  metaLabel('Invoice Date', invoice.period_start,                  50, metaY);
  metaLabel('Due Date',    invoice.due_date || '—',                col2X, metaY);

  // ── Divider ────────────────────────────────────────────────────────────────
  doc.y = metaY + 32;
  doc.moveTo(50, doc.y).lineTo(50 + pageW, doc.y).strokeColor('#e5e7eb').lineWidth(1).stroke();

  // ── Line items table ───────────────────────────────────────────────────────
  const tableTop = doc.y + 12;
  const cols = { date: 50, desc: 140, hours: 380, rate: 440, amount: 500 };

  // Table header
  doc.rect(50, tableTop, pageW, 22).fill(LIGHT);
  doc.fillColor(GREY).fontSize(9).font('Helvetica-Bold');
  doc.text('DATE',        cols.date,   tableTop + 6);
  doc.text('DESCRIPTION', cols.desc,   tableTop + 6);
  doc.text('HOURS',       cols.hours,  tableTop + 6, { width: 50, align: 'right' });
  doc.text('RATE',        cols.rate,   tableTop + 6, { width: 50, align: 'right' });
  doc.text('AMOUNT',      cols.amount, tableTop + 6, { width: 55, align: 'right' });

  // Rows
  let rowY = tableTop + 22;
  doc.font('Helvetica').fontSize(9).fillColor(BLACK);

  for (let i = 0; i < lineItems.length; i++) {
    const li   = lineItems[i];
    const bg   = i % 2 === 1 ? LIGHT : 'white';
    const desc = li.description || 'Work';
    const descLines = Math.ceil(desc.length / 50);
    const rowH = Math.max(18, descLines * 12 + 6);

    doc.rect(50, rowY, pageW, rowH).fill(bg);
    doc.fillColor(BLACK);
    doc.text(li.date,                    cols.date,   rowY + 5, { width: 85 });
    doc.text(desc,                        cols.desc,   rowY + 5, { width: 230 });
    doc.text(Number(li.hours).toFixed(2), cols.hours,  rowY + 5, { width: 50, align: 'right' });
    doc.text(`$${Number(li.rate).toFixed(2)}`, cols.rate, rowY + 5, { width: 50, align: 'right' });
    doc.text(`$${Number(li.amount).toFixed(2)}`, cols.amount, rowY + 5, { width: 55, align: 'right' });

    rowY += rowH;
  }

  // ── Totals block ────────────────────────────────────────────────────────────
  rowY += 8;
  doc.moveTo(50, rowY).lineTo(50 + pageW, rowY).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
  rowY += 10;

  const totLabelX = cols.rate - 60;
  const totValX   = cols.amount;
  const totW      = 55;

  const totRow = (label, value, bold = false) => {
    doc.fillColor(GREY).fontSize(9)
       .font(bold ? 'Helvetica-Bold' : 'Helvetica')
       .text(label, totLabelX, rowY, { width: 110, align: 'right' });
    doc.fillColor(BLACK)
       .font(bold ? 'Helvetica-Bold' : 'Helvetica')
       .text(value, totValX, rowY, { width: totW, align: 'right' });
    rowY += 16;
  };

  totRow('Total Hours:',  `${Number(invoice.total_hours).toFixed(2)} hrs`);
  totRow('Hourly Rate:',  `$${Number(invoice.hourly_rate).toFixed(2)}`);
  rowY += 4;
  doc.rect(totLabelX - 10, rowY - 4, 130, 24).fill('#1e3a8a');
  doc.fillColor('white').font('Helvetica-Bold').fontSize(11)
     .text('TOTAL DUE:', totLabelX - 6, rowY + 3, { width: 110, align: 'right' });
  doc.text(`$${Number(invoice.total_amount).toFixed(2)}`, totValX, rowY + 3, { width: totW, align: 'right' });

  // ── Notes ───────────────────────────────────────────────────────────────────
  if (invoice.notes) {
    rowY += 40;
    doc.fillColor(GREY).fontSize(8).font('Helvetica-Bold').text('NOTES', 50, rowY);
    doc.fillColor(BLACK).fontSize(9).font('Helvetica').text(invoice.notes, 50, rowY + 12, { width: pageW });
  }

  // ── Footer ──────────────────────────────────────────────────────────────────
  const footY = doc.page.height - 50;
  doc.moveTo(50, footY).lineTo(50 + pageW, footY).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
  doc.fillColor(GREY).fontSize(8).font('Helvetica')
     .text(`Generated by ${companyName} · ${new Date().toISOString().split('T')[0]}`, 50, footY + 8, { align: 'center', width: pageW });

  doc.end();
});

// ── Helper: generate one invoice for a single candidate ──────────────────────
function generateOneInvoice(db, candidateId, period_start, period_end, due_date, notes) {
  const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId);
  if (!candidate) return { skipped: true, reason: `Candidate ${candidateId} not found` };

  const entries = db.prepare(`
    SELECT * FROM time_entries
    WHERE candidate_id = ? AND date >= ? AND date <= ? AND status = 'approved'
    ORDER BY date
  `).all(candidateId, period_start, period_end);

  if (entries.length === 0) {
    return { skipped: true, reason: `No approved time entries for ${candidate.name} in this period` };
  }

  const totalHours  = entries.reduce((sum, e) => sum + e.hours, 0);
  const totalAmount = totalHours * candidate.hourly_rate;
  const invoiceNumber = generateInvoiceNumber(db);

  const invoiceId = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO invoices (invoice_number, candidate_id, client_id, period_start, period_end,
                            total_hours, hourly_rate, total_amount, status, due_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
    `).run(invoiceNumber, candidateId, candidate.client_id,
           period_start, period_end, totalHours,
           candidate.hourly_rate, totalAmount, due_date || null, notes || null);

    const iid = result.lastInsertRowid;
    const insertLine = db.prepare(`
      INSERT INTO invoice_line_items (invoice_id, date, description, hours, rate, amount)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const entry of entries) {
      insertLine.run(iid, entry.date,
        entry.description || entry.project || 'Work',
        entry.hours, candidate.hourly_rate,
        entry.hours * candidate.hourly_rate);
    }
    return iid;
  })();

  const invoice = db.prepare(`
    SELECT i.*, c.name AS candidate_name, cl.name AS client_name
    FROM invoices i
    JOIN candidates c ON i.candidate_id = c.id
    LEFT JOIN clients cl ON i.client_id = cl.id
    WHERE i.id = ?
  `).get(invoiceId);

  return { success: true, invoice, candidate_name: candidate.name };
}

// POST /api/invoices/generate — Admin: Generate invoice(s) from approved time entries
// Accepts:
//   { candidate_id, period_start, period_end, due_date, notes }          — single (legacy)
//   { candidate_ids: [1,2,3], period_start, period_end, due_date, notes } — multi-select
//   { client_id, period_start, period_end, due_date, notes }              — all employees of a client
router.post('/generate', authenticate, requireAdmin, injectTenantDb, (req, res) => {
  const { candidate_id, candidate_ids, client_id, period_start, period_end, due_date, notes } = req.body;

  if (!period_start || !period_end) {
    return res.status(400).json({ error: 'period_start and period_end are required' });
  }

  // Resolve the list of candidate IDs to process
  let ids = [];

  if (client_id) {
    // All active candidates belonging to this client
    const clientCandidates = req.db.prepare(
      'SELECT id FROM candidates WHERE client_id = ? AND status = ?'
    ).all(client_id, 'active');
    ids = clientCandidates.map(c => c.id);
    if (ids.length === 0) {
      return res.status(400).json({ error: 'No active employees found for this client' });
    }
  } else if (candidate_ids && Array.isArray(candidate_ids) && candidate_ids.length > 0) {
    ids = candidate_ids.map(Number);
  } else if (candidate_id) {
    ids = [Number(candidate_id)];
  } else {
    return res.status(400).json({ error: 'candidate_id, candidate_ids[], or client_id required' });
  }

  // Single candidate — return legacy format for backwards compatibility
  if (ids.length === 1) {
    try {
      const result = generateOneInvoice(req.db, ids[0], period_start, period_end, due_date, notes);
      if (result.skipped) return res.status(400).json({ error: result.reason });
      const lineItems = req.db.prepare(
        'SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY date'
      ).all(result.invoice.id);
      return res.status(201).json({ ...result.invoice, line_items: lineItems });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Bulk — return per-candidate results
  const results = [];
  let generated = 0, skipped = 0, errors = 0;

  for (const cid of ids) {
    try {
      const result = generateOneInvoice(req.db, cid, period_start, period_end, due_date, notes);
      if (result.skipped) {
        results.push({ candidate_id: cid, status: 'skipped', reason: result.reason });
        skipped++;
      } else {
        results.push({ candidate_id: cid, status: 'generated',
                       candidate_name: result.candidate_name,
                       invoice_number: result.invoice.invoice_number,
                       total_amount:   result.invoice.total_amount,
                       total_hours:    result.invoice.total_hours });
        generated++;
      }
    } catch (err) {
      results.push({ candidate_id: cid, status: 'error', reason: err.message });
      errors++;
    }
  }

  res.status(201).json({ results, generated, skipped, errors });
});

// POST /api/invoices — Manual create (Admin)
router.post('/', authenticate, requireAdmin, injectTenantDb, (req, res) => {
  const { candidate_id, period_start, period_end, total_hours, hourly_rate, total_amount, status, due_date, notes } = req.body;
  if (!candidate_id || !period_start || !period_end) {
    return res.status(400).json({ error: 'candidate_id, period_start, period_end required' });
  }

  const invoiceNumber = generateInvoiceNumber(req.db);
  const candidate = req.db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidate_id);
  const rate = hourly_rate || (candidate ? candidate.hourly_rate : 0);
  const hours = total_hours || 0;
  const amount = total_amount || hours * rate;

  const result = req.db.prepare(`
    INSERT INTO invoices (invoice_number, candidate_id, client_id, period_start, period_end,
                          total_hours, hourly_rate, total_amount, status, due_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(invoiceNumber, candidate_id, candidate?.client_id || null, period_start, period_end, hours, rate, amount, status || 'draft', due_date || null, notes || null);

  const invoice = req.db.prepare('SELECT i.*, c.name as candidate_name, cl.name as client_name FROM invoices i JOIN candidates c ON i.candidate_id = c.id LEFT JOIN clients cl ON i.client_id = cl.id WHERE i.id = ?').get(result.lastInsertRowid);
  res.status(201).json(invoice);
});

// PUT /api/invoices/:id — Update status etc.
router.put('/:id', authenticate, requireAdmin, injectTenantDb, (req, res) => {
  const id = parseInt(req.params.id);
  const invoice = req.db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const { status, due_date, notes } = req.body;
  req.db.prepare(`
    UPDATE invoices SET
      status = COALESCE(?, status),
      due_date = COALESCE(?, due_date),
      notes = COALESCE(?, notes),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status || null, due_date || null, notes !== undefined ? notes : null, id);

  const updated = req.db.prepare('SELECT i.*, c.name as candidate_name, cl.name as client_name FROM invoices i JOIN candidates c ON i.candidate_id = c.id LEFT JOIN clients cl ON i.client_id = cl.id WHERE i.id = ?').get(id);
  res.json(updated);
});

// DELETE /api/invoices/:id — Admin only (draft only)
router.delete('/:id', authenticate, requireAdmin, injectTenantDb, (req, res) => {
  const invoice = req.db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status !== 'draft') return res.status(400).json({ error: 'Only draft invoices can be deleted' });

  req.db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
  res.json({ message: 'Invoice deleted' });
});

// GET /api/invoices/summary/stats — Admin dashboard stats
router.get('/summary/stats', authenticate, requireAdmin, injectTenantDb, (req, res) => {
  const totalRevenue = req.db.prepare("SELECT COALESCE(SUM(total_amount), 0) as total FROM invoices WHERE status = 'paid'").get();
  const pendingRevenue = req.db.prepare("SELECT COALESCE(SUM(total_amount), 0) as total FROM invoices WHERE status IN ('sent', 'draft')").get();
  const overdueCount = req.db.prepare("SELECT COUNT(*) as count FROM invoices WHERE status = 'overdue'").get();
  const byStatus = req.db.prepare("SELECT status, COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total FROM invoices GROUP BY status").all();
  const recentInvoices = req.db.prepare(`
    SELECT i.*, c.name as candidate_name, cl.name as client_name
    FROM invoices i JOIN candidates c ON i.candidate_id = c.id LEFT JOIN clients cl ON i.client_id = cl.id
    ORDER BY i.created_at DESC LIMIT 5
  `).all();

  res.json({ totalRevenue: totalRevenue.total, pendingRevenue: pendingRevenue.total, overdueCount: overdueCount.count, byStatus, recentInvoices });
});

// ─────────────────────────────────────────────────────────────────────────────
// INVOICE PAYMENTS
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/invoices/:id/payments
router.get('/:id/payments', authenticate, injectTenantDb, (req, res) => {
  const invoice = req.db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const payments = req.db.prepare(
    'SELECT p.*, u.name as recorded_by_name FROM invoice_payments p LEFT JOIN users u ON p.recorded_by = u.id WHERE p.invoice_id = ? ORDER BY p.payment_date DESC'
  ).all(req.params.id);

  const totalPaid  = payments.reduce((s, p) => s + p.amount, 0);
  const balance    = invoice.total_amount - totalPaid;

  res.json({ invoice, payments, totalPaid, balance });
});

// POST /api/invoices/:id/payments — Admin only
router.post('/:id/payments', authenticate, requireAdmin, injectTenantDb, (req, res) => {
  const invoice = req.db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const { amount, payment_date, payment_method, reference_number, notes } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount must be positive' });
  if (!payment_date)          return res.status(400).json({ error: 'payment_date is required' });

  const r = req.db.prepare(`
    INSERT INTO invoice_payments (invoice_id, amount, payment_date, payment_method, reference_number, notes, recorded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(invoice.id, parseFloat(amount), payment_date, payment_method || 'bank_transfer',
         reference_number || null, notes || null, req.user.id);

  // Recompute total paid and auto-update invoice status
  const totalPaid = req.db.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM invoice_payments WHERE invoice_id = ?'
  ).get(invoice.id).total;

  let newStatus = invoice.status;
  if (totalPaid >= invoice.total_amount) {
    newStatus = 'paid';
  } else if (totalPaid > 0 && invoice.status === 'sent') {
    newStatus = 'sent'; // partially paid — keep as sent
  }
  req.db.prepare('UPDATE invoices SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(newStatus, invoice.id);

  const payment = req.db.prepare('SELECT * FROM invoice_payments WHERE id = ?').get(r.lastInsertRowid);
  res.status(201).json({ payment, totalPaid, newStatus });
});

// DELETE /api/invoices/:invoiceId/payments/:paymentId — Admin only
router.delete('/:invoiceId/payments/:paymentId', authenticate, requireAdmin, injectTenantDb, (req, res) => {
  req.db.prepare('DELETE FROM invoice_payments WHERE id = ? AND invoice_id = ?')
    .run(req.params.paymentId, req.params.invoiceId);
  res.json({ message: 'Payment record removed' });
});

module.exports = router;

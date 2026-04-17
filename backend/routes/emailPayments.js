/**
 * Email Payment Import Routes
 * GET  /api/email-payments/settings        — fetch current IMAP settings
 * POST /api/email-payments/settings        — save IMAP settings
 * POST /api/email-payments/test            — test IMAP connection
 * POST /api/email-payments/poll            — manually trigger inbox poll
 * GET  /api/email-payments/imports         — list all imports (filter: status)
 * GET  /api/email-payments/imports/:id     — single import detail
 * POST /api/email-payments/imports/:id/confirm — confirm + record as payment
 * POST /api/email-payments/imports/:id/reject  — dismiss/reject
 */
const express = require('express');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');
const { pollInbox, testConnection } = require('../services/emailPaymentService');
const { encrypt, decrypt } = require('../services/cryptoUtils');

const router = express.Router();
router.use(authenticate, requireAdmin, injectTenantDb);

// ── GET settings ─────────────────────────────────────────────────────────────
router.get('/settings', async (req, res) => {
  const result = await req.db.query('SELECT * FROM email_settings WHERE id = 1');
  const s = result.rows[0];
  if (!s) return res.json({ id: 1, provider: 'gmail', imap_host: '', imap_port: 993,
    imap_user: '', imap_folder: 'INBOX', search_subject: 'payment', poll_interval: 30,
    enabled: false, last_polled_at: null, last_uid: 0 });

  // Never expose raw password
  res.json({ ...s, imap_password: s.imap_password ? '••••••••' : '' });
});

// ── POST settings ─────────────────────────────────────────────────────────────
router.post('/settings', async (req, res) => {
  const { provider, imap_host, imap_port, imap_user, imap_password,
          imap_folder, search_subject, poll_interval, enabled } = req.body;

  const existingResult = await req.db.query('SELECT imap_password FROM email_settings WHERE id = 1');
  const existing = existingResult.rows[0];
  const rawPass = imap_password && !imap_password.includes('•')
    ? imap_password                          // new plaintext password from form
    : (existing ? decrypt(existing.imap_password) : null); // keep existing (decrypted)
  const pass = rawPass ? encrypt(rawPass) : null; // encrypt before storing

  // Resolve default host for provider
  const hosts = { gmail: 'imap.gmail.com', outlook: 'outlook.office365.com', imap: imap_host };
  const resolvedHost = imap_host || hosts[provider] || null;

  // PostgreSQL: use INSERT ... ON CONFLICT ... DO UPDATE
  await req.db.query(`
    INSERT INTO email_settings
      (id, provider, imap_host, imap_port, imap_user, imap_password,
       imap_folder, search_subject, poll_interval, enabled, updated_at)
    VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    ON CONFLICT (id) DO UPDATE SET
      provider = $1,
      imap_host = $2,
      imap_port = $3,
      imap_user = $4,
      imap_password = $5,
      imap_folder = $6,
      search_subject = $7,
      poll_interval = $8,
      enabled = $9,
      updated_at = NOW()
  `, [
    provider || 'gmail',
    resolvedHost,
    parseInt(imap_port) || 993,
    imap_user || null,
    pass,
    imap_folder || 'INBOX',
    search_subject || 'payment',
    parseInt(poll_interval) || 30,
    enabled ? true : false
  ]);

  const updatedResult = await req.db.query('SELECT * FROM email_settings WHERE id = 1');
  const updated = updatedResult.rows[0];
  res.json({ ...updated, imap_password: pass ? '••••••••' : '' });
});

/** Return a settings object with the IMAP password decrypted for service use. */
function settingsWithDecryptedPass(s) {
  if (!s) return null;
  return { ...s, imap_password: decrypt(s.imap_password) };
}

// ── POST test connection ───────────────────────────────────────────────────────
router.post('/test', async (req, res) => {
  try {
    const settingsResult = await req.db.query('SELECT * FROM email_settings WHERE id = 1');
    const s = settingsWithDecryptedPass(settingsResult.rows[0]);
    if (!s?.imap_user || !s?.imap_password) {
      return res.status(400).json({ ok: false, message: 'Please save email credentials first.' });
    }
    const result = await testConnection(s);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── POST poll (manual trigger) ────────────────────────────────────────────────
router.post('/poll', async (req, res) => {
  try {
    const settingsResult = await req.db.query('SELECT * FROM email_settings WHERE id = 1');
    const s = settingsWithDecryptedPass(settingsResult.rows[0]);
    if (!s?.imap_user || !s?.imap_password) {
      return res.status(400).json({ error: 'Email credentials not configured.' });
    }
    const result = await pollInbox(s, req.db);
    res.json({ ...result, polled_at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET imports list ──────────────────────────────────────────────────────────
router.get('/imports', async (req, res) => {
  const { status } = req.query;
  let sql = `
    SELECT
      epi.*,
      i.invoice_number,
      i.total_amount   AS invoice_amount,
      i.period_start   AS invoice_period_start,
      i.period_end     AS invoice_period_end,
      i.status         AS invoice_status,
      cl.name          AS invoice_client_name,
      c.name           AS invoice_candidate_name
    FROM email_payment_imports epi
    LEFT JOIN invoices   i  ON epi.matched_invoice_id = i.id
    LEFT JOIN candidates c  ON i.candidate_id = c.id
    LEFT JOIN clients    cl ON i.client_id = cl.id
    WHERE 1=1
  `;
  const params = [];
  let paramIndex = 1;
  if (status) { sql += ` AND epi.status = $${paramIndex}`; params.push(status); paramIndex++; }
  sql += ' ORDER BY epi.created_at DESC';

  const result = await req.db.query(sql, params);
  const rows = result.rows;
  res.json(rows.map(r => ({
    ...r,
    parsed_employee_names: tryParse(r.parsed_employee_names, []),
    mismatch_flags:        tryParse(r.mismatch_flags, []),
  })));
});

// ── GET single import ─────────────────────────────────────────────────────────
router.get('/imports/:id', async (req, res) => {
  const result = await req.db.query(`
    SELECT
      epi.*,
      i.invoice_number,
      i.total_amount   AS invoice_amount,
      i.total_hours    AS invoice_hours,
      i.hourly_rate    AS invoice_rate,
      i.period_start   AS invoice_period_start,
      i.period_end     AS invoice_period_end,
      i.status         AS invoice_status,
      cl.name          AS invoice_client_name,
      c.name           AS invoice_candidate_name
    FROM email_payment_imports epi
    LEFT JOIN invoices   i  ON epi.matched_invoice_id = i.id
    LEFT JOIN candidates c  ON i.candidate_id = c.id
    LEFT JOIN clients    cl ON i.client_id = cl.id
    WHERE epi.id = $1
  `, [req.params.id]);

  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'Import not found' });

  res.json({
    ...row,
    parsed_employee_names: tryParse(row.parsed_employee_names, []),
    mismatch_flags:        tryParse(row.mismatch_flags, []),
  });
});

// ── POST confirm ──────────────────────────────────────────────────────────────
router.post('/imports/:id/confirm', async (req, res) => {
  const impResult = await req.db.query('SELECT * FROM email_payment_imports WHERE id = $1', [req.params.id]);
  const imp = impResult.rows[0];
  if (!imp) return res.status(404).json({ error: 'Import not found' });
  if (imp.status !== 'pending') return res.status(400).json({ error: `Already ${imp.status}` });

  const {
    invoice_id     = imp.matched_invoice_id,
    amount         = imp.parsed_amount,
    payment_date   = imp.parsed_payment_date,
    payment_method = 'bank_transfer',
    reference_number = imp.parsed_reference,
    notes,
  } = req.body;

  if (!invoice_id) return res.status(400).json({ error: 'An invoice must be selected to confirm.' });
  if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ error: 'Valid payment amount required.' });
  if (!payment_date) return res.status(400).json({ error: 'Payment date required.' });

  const client = await req.db.connect();
  try {
    await client.query('BEGIN');

    // 1. Record the invoice payment
    await client.query(`
      INSERT INTO invoice_payments
        (invoice_id, amount, payment_date, payment_method, reference_number, notes, recorded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [invoice_id, parseFloat(amount), payment_date, payment_method,
        reference_number || null,
        notes || `Auto-imported from email: ${imp.email_subject}`,
        req.user.id]);

    // 2. Check if invoice is now fully paid
    const invoiceResult = await client.query('SELECT * FROM invoices WHERE id = $1', [invoice_id]);
    const invoice = invoiceResult.rows[0];

    const paidRowResult = await client.query(
      'SELECT COALESCE(SUM(amount),0) AS total FROM invoice_payments WHERE invoice_id = $1',
      [invoice_id]
    );
    const totalPaid = paidRowResult.rows[0].total;

    if (totalPaid >= invoice.total_amount - 0.01) {
      await client.query("UPDATE invoices SET status = $1, updated_at = NOW() WHERE id = $2", ['paid', invoice_id]);
    }

    // 3. Mark import confirmed
    await client.query(`
      UPDATE email_payment_imports
      SET status = $1, matched_invoice_id = $2, confirmed_by = $3, confirmed_at = NOW()
      WHERE id = $4
    `, ['confirmed', invoice_id, req.user.id, imp.id]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const updatedResult = await req.db.query('SELECT * FROM email_payment_imports WHERE id = $1', [imp.id]);
  const updated = updatedResult.rows[0];

  const invoiceResult = await req.db.query(`
    SELECT i.*, c.name AS candidate_name, cl.name AS client_name
    FROM invoices i JOIN candidates c ON i.candidate_id = c.id
    LEFT JOIN clients cl ON i.client_id = cl.id
    WHERE i.id = $1
  `, [invoice_id]);
  const invoiceData = invoiceResult.rows[0];

  res.json({ import: updated, invoice: invoiceData });
});

// ── POST reject ────────────────────────────────────────────────────────────────
router.post('/imports/:id/reject', async (req, res) => {
  const impResult = await req.db.query('SELECT * FROM email_payment_imports WHERE id = $1', [req.params.id]);
  const imp = impResult.rows[0];
  if (!imp) return res.status(404).json({ error: 'Import not found' });
  if (imp.status !== 'pending') return res.status(400).json({ error: `Already ${imp.status}` });

  await req.db.query(`
    UPDATE email_payment_imports
    SET status = $1, confirmed_by = $2, confirmed_at = NOW()
    WHERE id = $3
  `, ['rejected', req.user.id, imp.id]);

  res.json({ success: true });
});

// ── DELETE single import (admin cleanup) ──────────────────────────────────────
router.delete('/imports/:id', async (req, res) => {
  await req.db.query('DELETE FROM email_payment_imports WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

function tryParse(val, fallback) {
  try { return JSON.parse(val); } catch { return fallback; }
}

module.exports = router;

/**
 * Privacy Center — CCPA/CPRA Data Subject Rights
 * GET    /api/privacy/requests                   — list data requests (admin)
 * POST   /api/privacy/requests                   — submit a data request
 * PUT    /api/privacy/requests/:id               — update request status (admin)
 * GET    /api/privacy/export/:employeeId        — export all personal data as JSON
 * DELETE /api/privacy/delete/:employeeId        — soft-delete candidate (with legal-hold check)
 * PUT    /api/privacy/correct/:employeeId       — apply correction to candidate record
 */
const express = require('express');
const router  = express.Router();
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');
const { auditLog } = require('../middleware/auditLog');

// ── List data requests ────────────────────────────────────────────────────────
router.get('/requests', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const { status } = req.query;
    const params = []; const where = [];
    if (status) { params.push(status); where.push(`dr.status = $${params.length}`); }

    const result = await req.db.query(`
      SELECT dr.*, ca.name AS employee_name, ca.email AS employee_email,
             u.name AS processed_by_name
      FROM data_requests dr
      JOIN employees ca ON ca.id = dr.candidate_id
      LEFT JOIN users u ON u.id = dr.processed_by
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY dr.created_at DESC
    `, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[privacy GET /requests]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Submit a data request ─────────────────────────────────────────────────────
router.post('/requests', authenticate, injectTenantDb, auditLog('data_requests'), async (req, res) => {
  try {
    const { candidate_id, request_type, request_notes, legal_basis } = req.body;
    if (!candidate_id || !request_type) {
      return res.status(400).json({ error: 'candidate_id and request_type are required' });
    }

    // Admin can create on behalf of anyone; candidates can only submit for themselves
    if (req.user.role === 'candidate' && req.user.employeeId !== parseInt(candidate_id, 10)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = await req.db.query(`
      INSERT INTO data_requests (candidate_id, request_type, requested_by, request_notes, legal_basis)
      VALUES ($1, $2, $3, $4, $5) RETURNING *
    `, [parseInt(candidate_id, 10), request_type, req.user.id, request_notes || null, legal_basis || null]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[privacy POST /requests]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Update request status ─────────────────────────────────────────────────────
router.put('/requests/:id', authenticate, requireAdmin, injectTenantDb, auditLog('data_requests'), async (req, res) => {
  try {
    const { status, response_notes } = req.body;
    const completedAt = ['completed','rejected'].includes(status) ? 'NOW()' : 'NULL';

    const result = await req.db.query(`
      UPDATE data_requests SET
        status         = COALESCE($1, status),
        response_notes = COALESCE($2, response_notes),
        processed_by   = $3,
        completed_at   = ${completedAt},
        updated_at     = NOW()
      WHERE id = $4 RETURNING *
    `, [status || null, response_notes || null, req.user.id, parseInt(req.params.id, 10)]);

    if (!result.rows.length) return res.status(404).json({ error: 'Request not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[privacy PUT /requests/:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Export all personal data ──────────────────────────────────────────────────
router.get('/export/:employeeId', authenticate, injectTenantDb, async (req, res) => {
  try {
    const cid = parseInt(req.params.employeeId, 10);

    // Authorization: admin can export anyone; candidate can only export themselves
    if (req.user.role === 'candidate' && req.user.employeeId !== cid) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [
      candidate, timeEntries, absences, documents, invoices,
      expenses, emergencyContacts, bankAccounts,
    ] = await Promise.all([
      req.db.query(`SELECT * FROM employees WHERE id = $1`, [cid]),
      req.db.query(`SELECT * FROM time_entries WHERE candidate_id = $1 ORDER BY date`, [cid]),
      req.db.query(`SELECT * FROM absences WHERE candidate_id = $1 ORDER BY start_date`, [cid]),
      req.db.query(`SELECT id, title, document_type, created_at, expires_at FROM documents WHERE candidate_id = $1`, [cid]),
      req.db.query(`SELECT id, invoice_number, invoice_date, total_amount, status FROM invoices WHERE candidate_id = $1`, [cid]),
      req.db.query(`SELECT * FROM expenses WHERE candidate_id = $1 ORDER BY expense_date`, [cid]).catch(() => ({ rows: [] })),
      req.db.query(`SELECT * FROM emergency_contacts WHERE candidate_id = $1`, [cid]).catch(() => ({ rows: [] })),
      req.db.query(`SELECT id, bank_name, account_type, created_at FROM bank_accounts WHERE candidate_id = $1`, [cid]).catch(() => ({ rows: [] })),
    ]);

    if (!candidate.rows.length) return res.status(404).json({ error: 'Employee not found' });

    // Redact sensitive fields
    const cand = { ...candidate.rows[0] };
    delete cand.password_hash;

    const exportData = {
      exported_at:      new Date().toISOString(),
      export_version:   '1.0',
      data_controller:  'HireIQ',
      legal_basis:      'CCPA/CPRA — Right to Know / Data Portability',
      person: cand,
      time_entries:     timeEntries.rows,
      absences:         absences.rows,
      documents:        documents.rows,
      invoices:         invoices.rows,
      expenses:         expenses.rows,
      emergency_contacts: emergencyContacts.rows,
      bank_accounts:    bankAccounts.rows.map(b => ({ ...b, account_number: '[REDACTED]' })),
    };

    // Log the export
    await req.db.query(`
      INSERT INTO audit_logs (table_name, record_id, action, changed_by, new_values, ip_address)
      VALUES ('employees', $1, 'data_export', $2, $3, $4)
    `, [String(cid), req.user.id, JSON.stringify({ type: 'CCPA_export' }), req.ip || null])
    .catch(() => {});

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="personal-data-${cid}.json"`);
    res.json(exportData);
  } catch (err) {
    console.error('[privacy GET /export/:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Soft-delete (Right to Erasure) ───────────────────────────────────────────
router.delete('/delete/:employeeId', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const cid = parseInt(req.params.employeeId, 10);

    const cand = await req.db.query(`SELECT * FROM employees WHERE id = $1`, [cid]);
    if (!cand.rows.length) return res.status(404).json({ error: 'Not found' });

    if (cand.rows[0].legal_hold) {
      return res.status(409).json({ error: 'Cannot delete: record is under legal hold.' });
    }

    // Soft delete: set deleted_at, anonymize PII
    await req.db.query(`
      UPDATE employees SET
        deleted_at  = NOW(),
        name        = '[DELETED]',
        email       = 'deleted_' || id || '@redacted.invalid',
        phone       = NULL,
        notes       = NULL,
        updated_at  = NOW()
      WHERE id = $1
    `, [cid]);

    // Cascade: anonymize user account
    const user = await req.db.query(`SELECT user_id FROM employees WHERE id = $1`, [cid]);
    if (user.rows[0]?.user_id) {
      await req.db.query(`
        UPDATE users SET
          name  = '[DELETED]',
          email = 'deleted_' || id || '@redacted.invalid',
          password_hash = 'DELETED'
        WHERE id = $1
      `, [user.rows[0].user_id]);
    }

    // Audit log
    await req.db.query(`
      INSERT INTO audit_logs (table_name, record_id, action, changed_by, new_values, ip_address)
      VALUES ('employees', $1, 'erasure_request', $2, $3, $4)
    `, [String(cid), req.user.id, JSON.stringify({ legal_basis: req.body.legal_basis || 'CCPA Right to Erasure' }), req.ip || null])
    .catch(() => {});

    res.json({ message: 'Record anonymized and soft-deleted. Time records and financial data retained per FLSA/IRS requirements.' });
  } catch (err) {
    console.error('[privacy DELETE /:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Correct personal data ─────────────────────────────────────────────────────
router.put('/correct/:employeeId', authenticate, requireAdmin, injectTenantDb, auditLog('employees'), async (req, res) => {
  try {
    const cid = parseInt(req.params.employeeId, 10);
    const { name, email, phone, notes } = req.body;

    const sets = []; const params = [];
    if (name  !== undefined) { params.push(name);  sets.push(`name  = $${params.length}`); }
    if (email !== undefined) { params.push(email); sets.push(`email = $${params.length}`); }
    if (phone !== undefined) { params.push(phone); sets.push(`phone = $${params.length}`); }
    if (notes !== undefined) { params.push(notes); sets.push(`notes = $${params.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'No correctable fields provided' });
    sets.push(`updated_at = NOW()`);
    params.push(cid);

    const result = await req.db.query(
      `UPDATE employees SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, name, email, phone`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });

    // Audit log
    await req.db.query(`
      INSERT INTO audit_logs (table_name, record_id, action, changed_by, new_values, ip_address)
      VALUES ('employees', $1, 'data_correction', $2, $3, $4)
    `, [String(cid), req.user.id, JSON.stringify({ corrected: req.body, legal_basis: 'CCPA Right to Correct' }), req.ip || null])
    .catch(() => {});

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[privacy PUT /correct/:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

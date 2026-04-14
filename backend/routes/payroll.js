/**
 * Payroll Reconciliation Routes
 *
 * GET /api/payroll/reconciliation?from=&to=&view=payroll|timesheet
 *
 * view=payroll   — compares expected pay vs actual invoice payments
 * view=timesheet — compares admin-approved hours vs client-approved hours
 *                  (discrepancy check before publishing invoices)
 */
const express = require('express');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireAdmin, injectTenantDb);

// ── Shared date-filter builder ────────────────────────────────────────────────
function buildDateFilter(prefix, from, to, params) {
  let filter = '';
  if (from) { filter += ` AND ${prefix}.date >= ?`; params.push(from); }
  if (to)   { filter += ` AND ${prefix}.date <= ?`; params.push(to); }
  return filter;
}

// ── GET /api/payroll/reconciliation ─────────────────────────────────────────
router.get('/reconciliation', async (req, res) => {
  const { from, to, view = 'payroll' } = req.query;

  if (view === 'timesheet') {
    return timesheetDiscrepancyView(req, res, from, to);
  }
  return payrollPaymentView(req, res, from, to);
});

// ────────────────────────────────────────────────────────────────────────────
// VIEW 1 — Payroll vs Payments
// Compare expected pay (approved hours × rate) vs actual invoice_payments
// ────────────────────────────────────────────────────────────────────────────
async function payrollPaymentView(req, res, from, to) {
  try {
    const p = [];
    const dateFilter = buildDateFilter('te', from, to, p);

    const hoursRows = await req.db.prepare(`
      SELECT
        c.id                                              AS candidate_id,
        c.name                                            AS candidate_name,
        c.hourly_rate,
        COUNT(te.id)::int                                 AS entry_count,
        COALESCE(SUM(te.hours), 0)::float                AS total_hours,
        COALESCE(SUM(te.hours * c.hourly_rate), 0)::float AS expected_pay
      FROM candidates c
      LEFT JOIN time_entries te
        ON te.candidate_id = c.id AND te.status = 'approved' ${dateFilter}
      GROUP BY c.id
      ORDER BY c.name
    `).all(...p);

    // Payments — filtered by payment_date in period
    const pp = [];
    let payDateFilter = '';
    if (from) { payDateFilter += ' AND ip.payment_date >= ?'; pp.push(from); }
    if (to)   { payDateFilter += ' AND ip.payment_date <= ?'; pp.push(to); }

    const payRows = await req.db.prepare(`
      SELECT
        i.candidate_id,
        COALESCE(SUM(ip.amount), 0)::float AS total_paid
      FROM invoice_payments ip
      JOIN invoices i ON ip.invoice_id = i.id
      WHERE 1=1 ${payDateFilter}
      GROUP BY i.candidate_id
    `).all(...pp);

    const paidMap = Object.fromEntries(payRows.map(r => [r.candidate_id, parseFloat(r.total_paid) || 0]));

    const rows = hoursRows.map(r => {
      const expected_pay = parseFloat(r.expected_pay) || 0;
      const total_paid   = paidMap[r.candidate_id] || 0;
      const variance     = total_paid - expected_pay;
      const status = Math.abs(variance) < 0.01 ? 'reconciled'
                   : variance > 0               ? 'overpaid'
                   : expected_pay === 0         ? 'no_hours'
                   :                              'underpaid';
      return { ...r, expected_pay, total_paid, variance, status };
    });

    const summary = {
      total_candidates: rows.length,
      total_expected:   rows.reduce((s, r) => s + r.expected_pay, 0),
      total_paid:       rows.reduce((s, r) => s + r.total_paid,   0),
      reconciled:       rows.filter(r => r.status === 'reconciled').length,
      underpaid:        rows.filter(r => r.status === 'underpaid').length,
      overpaid:         rows.filter(r => r.status === 'overpaid').length,
    };
    summary.net_variance = summary.total_paid - summary.total_expected;

    res.json({ view: 'payroll', rows, summary, period: { from: from || null, to: to || null } });
  } catch (err) {
    console.error('[payroll/payrollPaymentView]', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// VIEW 2 — Timesheet Discrepancy (pre-publish check)
// Candidate-submitted hours vs admin-approved vs client-approved
// Shows what is safe to invoice and what still has discrepancies
// ────────────────────────────────────────────────────────────────────────────
async function timesheetDiscrepancyView(req, res, from, to) {
  try {
  const p = [];
  const dateFilter = buildDateFilter('te', from, to, p);

  // Per-candidate breakdown of hours at each approval stage
  const rows = await req.db.prepare(`
    SELECT
      c.id                 AS candidate_id,
      c.name               AS candidate_name,
      c.hourly_rate,

      -- All submitted entries (pending + approved + rejected)
      COUNT(CASE WHEN te.id IS NOT NULL THEN 1 END)                     AS submitted_entries,
      COALESCE(SUM(te.hours), 0)                                        AS submitted_hours,

      -- Admin-approved entries
      COUNT(CASE WHEN te.status = 'approved' THEN 1 END)                AS admin_approved_entries,
      COALESCE(SUM(CASE WHEN te.status = 'approved' THEN te.hours END), 0)
                                                                        AS admin_approved_hours,

      -- Admin-approved AND client-approved
      COUNT(CASE WHEN te.status = 'approved'
                 AND te.client_approval_status = 'approved' THEN 1 END) AS client_approved_entries,
      COALESCE(SUM(CASE WHEN te.status = 'approved'
                        AND te.client_approval_status = 'approved'
                        THEN te.hours END), 0)                          AS client_approved_hours,

      -- Admin-approved but pending client review
      COUNT(CASE WHEN te.status = 'approved'
                 AND (te.client_approval_status IS NULL
                      OR te.client_approval_status = 'pending') THEN 1 END)
                                                                        AS pending_client_entries,
      COALESCE(SUM(CASE WHEN te.status = 'approved'
                        AND (te.client_approval_status IS NULL
                             OR te.client_approval_status = 'pending')
                        THEN te.hours END), 0)                          AS pending_client_hours,

      -- Admin-approved but client-rejected
      COUNT(CASE WHEN te.status = 'approved'
                 AND te.client_approval_status = 'rejected' THEN 1 END) AS client_rejected_entries,
      COALESCE(SUM(CASE WHEN te.status = 'approved'
                        AND te.client_approval_status = 'rejected'
                        THEN te.hours END), 0)                          AS client_rejected_hours,

      -- Admin-pending (not yet reviewed by admin)
      COUNT(CASE WHEN te.status = 'pending' THEN 1 END)                 AS admin_pending_entries,

      -- Admin-rejected
      COUNT(CASE WHEN te.status = 'rejected' THEN 1 END)                AS admin_rejected_entries

    FROM candidates c
    LEFT JOIN time_entries te
      ON te.candidate_id = c.id ${dateFilter.replace('AND te.date', 'AND te.date')}
    GROUP BY c.id
    ORDER BY c.name
  `).all(...p);

  const processed = rows.map(r => {
    // Coerce PostgreSQL numeric strings → JS numbers
    const admin_approved_hours  = parseFloat(r.admin_approved_hours)  || 0;
    const client_approved_hours = parseFloat(r.client_approved_hours) || 0;
    const client_rejected_hours = parseFloat(r.client_rejected_hours) || 0;
    const pending_client_hours  = parseFloat(r.pending_client_hours)  || 0;
    const submitted_hours       = parseFloat(r.submitted_hours)       || 0;
    const hourly_rate           = parseFloat(r.hourly_rate)           || 0;

    const discrepancy_hours  = admin_approved_hours - client_approved_hours;
    const invoiceable_hours  = client_approved_hours;
    const invoiceable_amount = invoiceable_hours  * hourly_rate;
    const at_risk_amount     = client_rejected_hours * hourly_rate;
    const pending_amount     = pending_client_hours  * hourly_rate;

    const publish_status =
      admin_approved_hours === 0  ? 'no_hours'
      : pending_client_hours > 0  ? 'pending_client'
      : client_rejected_hours > 0 && pending_client_hours === 0 ? 'has_rejections'
      : discrepancy_hours <= 0.001 ? 'ready'
      :                              'discrepancy';

    return {
      ...r,
      submitted_hours,
      admin_approved_hours,
      client_approved_hours,
      client_rejected_hours,
      pending_client_hours,
      hourly_rate,
      discrepancy_hours,
      invoiceable_hours,
      invoiceable_amount,
      at_risk_amount,
      pending_amount,
      publish_status,
    };
  });

  const summary = {
    total_candidates:        processed.length,
    total_submitted_hours:   processed.reduce((s, r) => s + r.submitted_hours,       0),
    total_admin_approved:    processed.reduce((s, r) => s + r.admin_approved_hours,  0),
    total_client_approved:   processed.reduce((s, r) => s + r.client_approved_hours, 0),
    total_pending_client:    processed.reduce((s, r) => s + r.pending_client_hours,  0),
    total_rejected_client:   processed.reduce((s, r) => s + r.client_rejected_hours, 0),
    total_discrepancy_hours: processed.reduce((s, r) => s + r.discrepancy_hours,     0),
    total_invoiceable:       processed.reduce((s, r) => s + r.invoiceable_amount,    0),
    ready:                   processed.filter(r => r.publish_status === 'ready').length,
    pending_client:          processed.filter(r => r.publish_status === 'pending_client').length,
    has_rejections:          processed.filter(r => r.publish_status === 'has_rejections').length,
    no_hours:                processed.filter(r => r.publish_status === 'no_hours').length,
  };

  res.json({ view: 'timesheet', rows: processed, summary, period: { from: from || null, to: to || null } });
  } catch (err) {
    console.error('[payroll/timesheetDiscrepancyView]', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/payroll/timesheet-detail/:candidateId ─────────────────────────
// Drilldown: all time entries for a candidate, with both approval statuses
router.get('/timesheet-detail/:candidateId', async (req, res) => {
  try {
    const { candidateId } = req.params;
    const { from, to } = req.query;
    const p = [candidateId];
    const dateFilter = buildDateFilter('te', from, to, p);

    const candidate = await req.db.prepare('SELECT id, name, hourly_rate FROM candidates WHERE id = ?').get(candidateId);
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

    const entries = await req.db.prepare(`
      SELECT
        te.id, te.date, te.hours, te.description, te.project,
        te.status AS admin_status,
        te.client_approval_status,
        te.client_approval_note,
        te.client_approved_at,
        (te.hours * c.hourly_rate)::float AS amount
      FROM time_entries te
      JOIN candidates c ON c.id = te.candidate_id
      WHERE te.candidate_id = ? ${dateFilter}
      ORDER BY te.date DESC
    `).all(...p);

    res.json({ candidate, entries });
  } catch (err) {
    console.error('[payroll/timesheet-detail]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');
const { sanitizeQueryEnum, sanitizeQueryDate, sanitizeQueryInt } = require('../middleware/validators');

const VALID_TE_STATUSES  = ['pending', 'approved', 'rejected'];
const VALID_ABS_STATUSES = ['pending', 'approved', 'rejected'];
const VALID_ABS_TYPES    = ['vacation', 'sick', 'personal', 'public_holiday', 'other'];

// All report endpoints are admin-only
router.use(authenticate, requireAdmin, injectTenantDb);

/**
 * GET /api/reports/hours
 * Total hours (and revenue) per candidate, filtered by date range + optional candidate.
 * Query params: start_date, end_date, candidate_id, status (all|pending|approved|rejected)
 */
router.get('/hours', async (req, res) => {
  try {
    // Validate + sanitize query params to prevent unexpected DB queries
    const start_date   = sanitizeQueryDate(req.query.start_date, 'start_date');
    const end_date     = sanitizeQueryDate(req.query.end_date,   'end_date');
    const candidate_id = sanitizeQueryInt(req.query.candidate_id, 'candidate_id');
    const client_id    = sanitizeQueryInt(req.query.client_id,    'client_id');
    const status       = sanitizeQueryEnum(req.query.status, VALID_TE_STATUSES, 'status');

    // NOTE: All user-supplied values are bound as ? parameters — no SQL injection risk.
    let where = ['1=1'];
    const params = [];

    if (start_date)   { where.push('te.date >= ?');          params.push(start_date); }
    if (end_date)     { where.push('te.date <= ?');          params.push(end_date); }
    if (candidate_id) { where.push('te.candidate_id = ?');   params.push(candidate_id); }
    if (client_id)    { where.push('c.client_id = ?');       params.push(client_id); }
    if (status)       { where.push('te.status = ?');         params.push(status); }

    const whereClause = where.join(' AND ');

    // Per-candidate summary
    const summary = await req.db.prepare(`
      SELECT
        c.id          AS candidate_id,
        c.name        AS candidate_name,
        c.hourly_rate,
        c.role,
        cl.name       AS client_name,
        COUNT(te.id)                                          AS entry_count,
        ROUND(SUM(te.hours), 2)                               AS total_hours,
        ROUND(SUM(CASE WHEN te.status='approved'  THEN te.hours ELSE 0 END), 2) AS approved_hours,
        ROUND(SUM(CASE WHEN te.status='pending'   THEN te.hours ELSE 0 END), 2) AS pending_hours,
        ROUND(SUM(CASE WHEN te.status='rejected'  THEN te.hours ELSE 0 END), 2) AS rejected_hours,
        ROUND(SUM(te.hours * c.hourly_rate), 2)               AS total_amount,
        ROUND(SUM(CASE WHEN te.status='approved'  THEN te.hours * c.hourly_rate ELSE 0 END), 2) AS approved_amount
      FROM time_entries te
      JOIN candidates c  ON te.candidate_id = c.id
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE ${whereClause}
      GROUP BY c.id
      ORDER BY total_hours DESC
    `).all(...params);

    // Daily breakdown (for chart)
    const daily = await req.db.prepare(`
      SELECT
        te.date,
        ROUND(SUM(te.hours), 2)  AS hours,
        ROUND(SUM(te.hours * c.hourly_rate), 2) AS amount,
        COUNT(te.id) AS entries
      FROM time_entries te
      JOIN candidates c ON te.candidate_id = c.id
      WHERE ${whereClause}
      GROUP BY te.date
      ORDER BY te.date ASC
    `).all(...params);

    // Totals row
    const totals = await req.db.prepare(`
      SELECT
        ROUND(SUM(te.hours), 2)  AS total_hours,
        ROUND(SUM(CASE WHEN te.status='approved' THEN te.hours ELSE 0 END), 2) AS approved_hours,
        ROUND(SUM(CASE WHEN te.status='pending'  THEN te.hours ELSE 0 END), 2) AS pending_hours,
        ROUND(SUM(CASE WHEN te.status='rejected' THEN te.hours ELSE 0 END), 2) AS rejected_hours,
        ROUND(SUM(te.hours * c.hourly_rate), 2)  AS total_amount,
        ROUND(SUM(CASE WHEN te.status='approved' THEN te.hours * c.hourly_rate ELSE 0 END), 2) AS approved_amount,
        COUNT(te.id) AS entry_count
      FROM time_entries te
      JOIN candidates c ON te.candidate_id = c.id
      WHERE ${whereClause}
    `).get(...params);

    res.json({ summary, daily, totals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reports/absences
 * Absence days per candidate, grouped by type, filtered by date range.
 * Query params: start_date, end_date, candidate_id, status, type
 */
router.get('/absences', async (req, res) => {
  try {
    const start_date   = sanitizeQueryDate(req.query.start_date, 'start_date');
    const end_date     = sanitizeQueryDate(req.query.end_date,   'end_date');
    const candidate_id = sanitizeQueryInt(req.query.candidate_id, 'candidate_id');
    const client_id    = sanitizeQueryInt(req.query.client_id,    'client_id');
    const status       = sanitizeQueryEnum(req.query.status, VALID_ABS_STATUSES, 'status');
    const type         = sanitizeQueryEnum(req.query.type,   VALID_ABS_TYPES,    'type');

    let where = ['1=1'];
    const params = [];

    if (start_date)   { where.push('a.start_date >= ?'); params.push(start_date); }
    if (end_date)     { where.push('a.end_date   <= ?'); params.push(end_date); }
    if (candidate_id) { where.push('a.candidate_id = ?'); params.push(candidate_id); }
    if (client_id)    { where.push('c.client_id = ?');   params.push(client_id); }
    if (status)       { where.push('a.status = ?'); params.push(status); }
    if (type)         { where.push('a.type = ?');   params.push(type); }

    const whereClause = where.join(' AND ');

    // Per-candidate summary
    const summary = await req.db.prepare(`
      SELECT
        c.id    AS candidate_id,
        c.name  AS candidate_name,
        cl.name AS client_name,
        COUNT(a.id) AS absence_count,
        SUM(CAST((julianday(a.end_date) - julianday(a.start_date) + 1) AS INTEGER)) AS total_days,
        SUM(CASE WHEN a.type='vacation'       THEN CAST((julianday(a.end_date)-julianday(a.start_date)+1) AS INTEGER) ELSE 0 END) AS vacation_days,
        SUM(CASE WHEN a.type='sick'           THEN CAST((julianday(a.end_date)-julianday(a.start_date)+1) AS INTEGER) ELSE 0 END) AS sick_days,
        SUM(CASE WHEN a.type='personal'       THEN CAST((julianday(a.end_date)-julianday(a.start_date)+1) AS INTEGER) ELSE 0 END) AS personal_days,
        SUM(CASE WHEN a.type='public_holiday' THEN CAST((julianday(a.end_date)-julianday(a.start_date)+1) AS INTEGER) ELSE 0 END) AS holiday_days,
        SUM(CASE WHEN a.status='approved'     THEN CAST((julianday(a.end_date)-julianday(a.start_date)+1) AS INTEGER) ELSE 0 END) AS approved_days,
        SUM(CASE WHEN a.status='pending'      THEN CAST((julianday(a.end_date)-julianday(a.start_date)+1) AS INTEGER) ELSE 0 END) AS pending_days,
        SUM(CASE WHEN a.status='rejected'     THEN CAST((julianday(a.end_date)-julianday(a.start_date)+1) AS INTEGER) ELSE 0 END) AS rejected_days
      FROM absences a
      JOIN candidates c  ON a.candidate_id = c.id
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE ${whereClause}
      GROUP BY c.id
      ORDER BY total_days DESC
    `).all(...params);

    // Detail rows
    const detail = await req.db.prepare(`
      SELECT
        a.id, a.start_date, a.end_date, a.type, a.status, a.notes,
        CAST((julianday(a.end_date) - julianday(a.start_date) + 1) AS INTEGER) AS days,
        c.name AS candidate_name
      FROM absences a
      JOIN candidates c ON a.candidate_id = c.id
      WHERE ${whereClause}
      ORDER BY a.start_date DESC
    `).all(...params);

    // Totals — join candidates so c.client_id filter works
    const totals = await req.db.prepare(`
      SELECT
        COUNT(a.id) AS absence_count,
        SUM(CAST((julianday(a.end_date)-julianday(a.start_date)+1) AS INTEGER)) AS total_days,
        SUM(CASE WHEN a.status='approved' THEN CAST((julianday(a.end_date)-julianday(a.start_date)+1) AS INTEGER) ELSE 0 END) AS approved_days,
        SUM(CASE WHEN a.status='pending'  THEN CAST((julianday(a.end_date)-julianday(a.start_date)+1) AS INTEGER) ELSE 0 END) AS pending_days
      FROM absences a
      JOIN candidates c ON a.candidate_id = c.id
      WHERE ${whereClause}
    `).get(...params);

    res.json({ summary, detail, totals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reports/revenue
 * Invoice & billable revenue summary.
 * Query params: start_date, end_date, candidate_id
 */
router.get('/revenue', async (req, res) => {
  try {
    const start_date   = sanitizeQueryDate(req.query.start_date, 'start_date');
    const end_date     = sanitizeQueryDate(req.query.end_date,   'end_date');
    const candidate_id = sanitizeQueryInt(req.query.candidate_id, 'candidate_id');
    const client_id    = sanitizeQueryInt(req.query.client_id,    'client_id');
    // All values are bound as ? parameters — no SQL injection risk.

    let teWhere = ['1=1'];
    const teParams = [];
    if (start_date)   { teWhere.push('te.date >= ?'); teParams.push(start_date); }
    if (end_date)     { teWhere.push('te.date <= ?'); teParams.push(end_date); }
    if (candidate_id) { teWhere.push('te.candidate_id = ?'); teParams.push(candidate_id); }
    if (client_id)    { teWhere.push('c.client_id = ?');     teParams.push(client_id); }

    // Billable hours revenue per candidate
    const billable = await req.db.prepare(`
      SELECT
        c.id    AS candidate_id,
        c.name  AS candidate_name,
        c.hourly_rate,
        cl.name AS client_name,
        ROUND(SUM(CASE WHEN te.status='approved' THEN te.hours ELSE 0 END), 2)                        AS approved_hours,
        ROUND(SUM(CASE WHEN te.status='approved' THEN te.hours * c.hourly_rate ELSE 0 END), 2)         AS approved_amount,
        ROUND(SUM(CASE WHEN te.status='pending'  THEN te.hours * c.hourly_rate ELSE 0 END), 2)         AS pending_amount,
        ROUND(SUM(te.hours * c.hourly_rate), 2)                                                        AS total_billable
      FROM time_entries te
      JOIN candidates c  ON te.candidate_id = c.id
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE ${teWhere.join(' AND ')}
      GROUP BY c.id
      ORDER BY total_billable DESC
    `).all(...teParams);

    // Invoice status summary
    let invWhere = ['1=1'];
    const invParams = [];
    if (start_date)   { invWhere.push('i.period_start >= ?'); invParams.push(start_date); }
    if (end_date)     { invWhere.push('i.period_end <= ?'); invParams.push(end_date); }
    if (candidate_id) { invWhere.push('i.candidate_id = ?'); invParams.push(candidate_id); }
    if (client_id)    { invWhere.push('c.client_id = ?');    invParams.push(client_id); }

    const invoices = await req.db.prepare(`
      SELECT
        c.name  AS candidate_name,
        cl.name AS client_name,
        i.invoice_number,
        i.period_start AS issue_date,
        i.due_date,
        i.total_amount,
        i.status,
        i.total_hours AS hours_billed
      FROM invoices i
      JOIN candidates c  ON i.candidate_id = c.id
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE ${invWhere.join(' AND ')}
      ORDER BY i.period_start DESC
    `).all(...invParams);

    const invTotals = await req.db.prepare(`
      SELECT
        ROUND(SUM(CASE WHEN i.status='paid'  THEN i.total_amount ELSE 0 END), 2) AS paid,
        ROUND(SUM(CASE WHEN i.status='sent'  THEN i.total_amount ELSE 0 END), 2) AS outstanding,
        ROUND(SUM(CASE WHEN i.status='draft' THEN i.total_amount ELSE 0 END), 2) AS draft,
        ROUND(SUM(i.total_amount), 2) AS total,
        COUNT(i.id) AS invoice_count
      FROM invoices i
      JOIN candidates c ON i.candidate_id = c.id
      WHERE ${invWhere.join(' AND ')}
    `).get(...invParams);

    res.json({ billable, invoices, invTotals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reports/summary
 * Single-call overview: KPIs + all three report datasets.
 * Used by the dashboard to populate all tabs in one shot.
 */
router.get('/summary', async (req, res) => {
  try {
    const { start_date, end_date, candidate_id } = req.query;

    // Build reusable where
    const buildWhere = (alias, dateField = 'date', idField = 'candidate_id') => {
      const w = ['1=1'], p = [];
      if (start_date)   { w.push(`${alias}.${dateField} >= ?`); p.push(start_date); }
      if (end_date)     { w.push(`${alias}.${dateField} <= ?`); p.push(end_date); }
      if (candidate_id) { w.push(`${alias}.${idField} = ?`);    p.push(candidate_id); }
      return { where: w.join(' AND '), params: p };
    };

    const te  = buildWhere('te', 'date');
    const abs = buildWhere('a',  'start_date');

    const kpis = await req.db.prepare(`
      SELECT
        ROUND(SUM(te.hours), 2)                                                                  AS total_hours,
        ROUND(SUM(CASE WHEN te.status='approved' THEN te.hours ELSE 0 END), 2)                   AS approved_hours,
        ROUND(SUM(CASE WHEN te.status='pending'  THEN te.hours ELSE 0 END), 2)                   AS pending_hours,
        ROUND(SUM(CASE WHEN te.status='approved' THEN te.hours * c.hourly_rate ELSE 0 END), 2)   AS approved_revenue,
        ROUND(SUM(te.hours * c.hourly_rate), 2)                                                  AS total_revenue,
        COUNT(DISTINCT te.candidate_id) AS active_candidates
      FROM time_entries te
      JOIN candidates c ON te.candidate_id = c.id
      WHERE ${te.where}
    `).get(...te.params);

    const absKpi = await req.db.prepare(`
      SELECT
        COUNT(a.id) AS total_absences,
        SUM(CAST((julianday(a.end_date)-julianday(a.start_date)+1) AS INTEGER)) AS total_absence_days
      FROM absences a WHERE ${abs.where}
    `).get(...abs.params);

    res.json({ kpis: { ...kpis, ...absKpi } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

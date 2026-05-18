const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');
const { sanitizeQueryEnum, sanitizeQueryDate, sanitizeQueryInt } = require('../middleware/validators');

const VALID_TE_STATUSES  = ['pending', 'approved', 'rejected'];
const VALID_ABS_STATUSES = ['pending', 'approved', 'rejected'];
const VALID_ABS_TYPES    = ['vacation', 'sick', 'personal', 'public_holiday', 'other'];

// All report endpoints are admin-only
router.use(authenticate, requireAdmin, injectTenantDb);

// ── Helper: replace ? placeholders with $N and return [sql, params] ──────────
// Converts a WHERE clause built with ? placeholders + array of values into
// PostgreSQL positional-param format.  The offset lets us share the same
// params array across multiple clauses in one query.
function toPositional(sql, params, offset = 0) {
  let i = offset;
  const converted = sql.replace(/\?/g, () => `$${++i}`);
  return converted;
}

// Build a WHERE clause with PostgreSQL positional params from the start.
function buildWherePg(conditions) {
  // conditions: array of { sql: 'col >= $N', value } — we index them here.
  // Actually simpler: we accumulate params and return both.
  const parts = ['1=1'];
  const params = [];
  for (const { fragment, value } of conditions) {
    if (value === undefined || value === null || value === '') continue;
    params.push(value);
    parts.push(fragment.replace('?', `$${params.length}`));
  }
  return { whereClause: parts.join(' AND '), params };
}

/**
 * GET /api/reports/hours
 * Total hours (and revenue) per candidate, filtered by date range + optional candidate.
 * Query params: start_date, end_date, candidate_id, status (all|pending|approved|rejected)
 */
router.get('/hours', async (req, res) => {
  try {
    const start_date   = sanitizeQueryDate(req.query.start_date, 'start_date');
    const end_date     = sanitizeQueryDate(req.query.end_date,   'end_date');
    const candidate_id = sanitizeQueryInt(req.query.candidate_id, 'candidate_id');
    const client_id    = sanitizeQueryInt(req.query.client_id,    'client_id');
    const status       = sanitizeQueryEnum(req.query.status, VALID_TE_STATUSES, 'status');

    const { whereClause, params } = buildWherePg([
      { fragment: 'te.date >= ?',        value: start_date   },
      { fragment: 'te.date <= ?',        value: end_date     },
      { fragment: 'te.candidate_id = ?', value: candidate_id },
      { fragment: 'c.client_id = ?',     value: client_id    },
      { fragment: 'te.status = ?',       value: status       },
    ]);

    // Per-candidate summary
    const summaryResult = await req.db.query(`
      SELECT
        c.id          AS candidate_id,
        c.name        AS employee_name,
        c.hourly_rate::float,
        c.role,
        cl.name       AS client_name,
        COUNT(te.id)::int                                                                          AS entry_count,
        ROUND(COALESCE(SUM(te.hours), 0)::numeric, 2)::float                                       AS total_hours,
        ROUND(COALESCE(SUM(CASE WHEN te.status='approved' THEN te.hours ELSE 0 END), 0)::numeric, 2)::float AS approved_hours,
        ROUND(COALESCE(SUM(CASE WHEN te.status='pending'  THEN te.hours ELSE 0 END), 0)::numeric, 2)::float AS pending_hours,
        ROUND(COALESCE(SUM(CASE WHEN te.status='rejected' THEN te.hours ELSE 0 END), 0)::numeric, 2)::float AS rejected_hours,
        ROUND(COALESCE(SUM(te.hours * c.hourly_rate), 0)::numeric, 2)::float                       AS total_amount,
        ROUND(COALESCE(SUM(CASE WHEN te.status='approved' THEN te.hours * c.hourly_rate ELSE 0 END), 0)::numeric, 2)::float AS approved_amount
      FROM time_entries te
      JOIN employees c  ON te.candidate_id = c.id
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE ${whereClause}
      GROUP BY c.id, c.name, c.hourly_rate, c.role, cl.name
      ORDER BY total_hours DESC
    `, params);

    // Daily breakdown (for chart)
    const dailyResult = await req.db.query(`
      SELECT
        te.date,
        ROUND(COALESCE(SUM(te.hours), 0)::numeric, 2)::float                    AS hours,
        ROUND(COALESCE(SUM(te.hours * c.hourly_rate), 0)::numeric, 2)::float    AS amount,
        COUNT(te.id)::int AS entries
      FROM time_entries te
      JOIN employees c ON te.candidate_id = c.id
      WHERE ${whereClause}
      GROUP BY te.date
      ORDER BY te.date ASC
    `, params);

    // Totals row
    const totalsResult = await req.db.query(`
      SELECT
        ROUND(COALESCE(SUM(te.hours), 0)::numeric, 2)::float                                                AS total_hours,
        ROUND(COALESCE(SUM(CASE WHEN te.status='approved' THEN te.hours ELSE 0 END), 0)::numeric, 2)::float AS approved_hours,
        ROUND(COALESCE(SUM(CASE WHEN te.status='pending'  THEN te.hours ELSE 0 END), 0)::numeric, 2)::float AS pending_hours,
        ROUND(COALESCE(SUM(CASE WHEN te.status='rejected' THEN te.hours ELSE 0 END), 0)::numeric, 2)::float AS rejected_hours,
        ROUND(COALESCE(SUM(te.hours * c.hourly_rate), 0)::numeric, 2)::float                                AS total_amount,
        ROUND(COALESCE(SUM(CASE WHEN te.status='approved' THEN te.hours * c.hourly_rate ELSE 0 END), 0)::numeric, 2)::float AS approved_amount,
        COUNT(te.id)::int AS entry_count
      FROM time_entries te
      JOIN employees c ON te.candidate_id = c.id
      WHERE ${whereClause}
    `, params);

    res.json({
      summary: summaryResult.rows,
      daily:   dailyResult.rows,
      totals:  totalsResult.rows[0] || null,
    });
  } catch (err) {
    console.error('[reports/hours]', err.message);
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

    const { whereClause, params } = buildWherePg([
      { fragment: 'a.start_date >= ?',   value: start_date   },
      { fragment: 'a.end_date <= ?',     value: end_date     },
      { fragment: 'a.candidate_id = ?',  value: candidate_id },
      { fragment: 'c.client_id = ?',     value: client_id    },
      { fragment: 'a.status = ?',        value: status       },
      { fragment: 'a.type = ?',          value: type         },
    ]);

    // Per-candidate summary
    const summaryResult = await req.db.query(`
      SELECT
        c.id    AS candidate_id,
        c.name  AS employee_name,
        cl.name AS client_name,
        COUNT(a.id)::int AS absence_count,
        COALESCE(SUM(a.end_date::date - a.start_date::date + 1), 0)::int                                                          AS total_days,
        COALESCE(SUM(CASE WHEN a.type='vacation'       THEN a.end_date::date - a.start_date::date + 1 ELSE 0 END), 0)::int        AS vacation_days,
        COALESCE(SUM(CASE WHEN a.type='sick'           THEN a.end_date::date - a.start_date::date + 1 ELSE 0 END), 0)::int        AS sick_days,
        COALESCE(SUM(CASE WHEN a.type='personal'       THEN a.end_date::date - a.start_date::date + 1 ELSE 0 END), 0)::int        AS personal_days,
        COALESCE(SUM(CASE WHEN a.type='public_holiday' THEN a.end_date::date - a.start_date::date + 1 ELSE 0 END), 0)::int        AS holiday_days,
        COALESCE(SUM(CASE WHEN a.status='approved'     THEN a.end_date::date - a.start_date::date + 1 ELSE 0 END), 0)::int        AS approved_days,
        COALESCE(SUM(CASE WHEN a.status='pending'      THEN a.end_date::date - a.start_date::date + 1 ELSE 0 END), 0)::int        AS pending_days,
        COALESCE(SUM(CASE WHEN a.status='rejected'     THEN a.end_date::date - a.start_date::date + 1 ELSE 0 END), 0)::int        AS rejected_days
      FROM absences a
      JOIN employees c  ON a.candidate_id = c.id
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE ${whereClause}
      GROUP BY c.id, c.name, cl.name
      ORDER BY total_days DESC
    `, params);

    // Detail rows
    const detailResult = await req.db.query(`
      SELECT
        a.id,
        a.start_date,
        a.end_date,
        a.type,
        a.status,
        a.notes,
        (a.end_date::date - a.start_date::date + 1)::int AS days,
        c.name AS employee_name
      FROM absences a
      JOIN employees c ON a.candidate_id = c.id
      WHERE ${whereClause}
      ORDER BY a.start_date DESC
    `, params);

    // Totals
    const totalsResult = await req.db.query(`
      SELECT
        COUNT(a.id)::int AS absence_count,
        COALESCE(SUM(a.end_date::date - a.start_date::date + 1), 0)::int                                                   AS total_days,
        COALESCE(SUM(CASE WHEN a.status='approved' THEN a.end_date::date - a.start_date::date + 1 ELSE 0 END), 0)::int    AS approved_days,
        COALESCE(SUM(CASE WHEN a.status='pending'  THEN a.end_date::date - a.start_date::date + 1 ELSE 0 END), 0)::int    AS pending_days
      FROM absences a
      JOIN employees c ON a.candidate_id = c.id
      WHERE ${whereClause}
    `, params);

    // Monthly absence trend (for chart)
    const monthlyResult = await req.db.query(`
      SELECT
        TO_CHAR(a.start_date, 'YYYY-MM') AS month,
        COALESCE(SUM(a.end_date::date - a.start_date::date + 1), 0)::int AS total_days,
        COALESCE(SUM(CASE WHEN a.type='sick'     THEN a.end_date::date - a.start_date::date + 1 ELSE 0 END), 0)::int AS sick_days,
        COALESCE(SUM(CASE WHEN a.type='vacation' THEN a.end_date::date - a.start_date::date + 1 ELSE 0 END), 0)::int AS vacation_days,
        COUNT(a.id)::int AS absence_count
      FROM absences a
      JOIN employees c ON a.candidate_id = c.id
      WHERE ${whereClause}
        AND a.status = 'approved'
      GROUP BY TO_CHAR(a.start_date, 'YYYY-MM')
      ORDER BY month ASC
    `, params);

    res.json({
      summary: summaryResult.rows,
      detail:  detailResult.rows,
      totals:  totalsResult.rows[0] || null,
      monthly: monthlyResult.rows,
    });
  } catch (err) {
    console.error('[reports/absences]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reports/revenue
 * Invoice & billable revenue summary.
 * Query params: start_date, end_date, candidate_id, client_id
 */
router.get('/revenue', async (req, res) => {
  try {
    const start_date   = sanitizeQueryDate(req.query.start_date, 'start_date');
    const end_date     = sanitizeQueryDate(req.query.end_date,   'end_date');
    const candidate_id = sanitizeQueryInt(req.query.candidate_id, 'candidate_id');
    const client_id    = sanitizeQueryInt(req.query.client_id,    'client_id');

    // Billable hours — filter on time_entries + candidates
    const { whereClause: teWhere, params: teParams } = buildWherePg([
      { fragment: 'te.date >= ?',        value: start_date   },
      { fragment: 'te.date <= ?',        value: end_date     },
      { fragment: 'te.candidate_id = ?', value: candidate_id },
      { fragment: 'c.client_id = ?',     value: client_id    },
    ]);

    const billableResult = await req.db.query(`
      SELECT
        c.id    AS candidate_id,
        c.name  AS employee_name,
        c.hourly_rate::float,
        cl.name AS client_name,
        ROUND(COALESCE(SUM(CASE WHEN te.status='approved' THEN te.hours ELSE 0 END), 0)::numeric, 2)::float                       AS approved_hours,
        ROUND(COALESCE(SUM(CASE WHEN te.status='approved' THEN te.hours * c.hourly_rate ELSE 0 END), 0)::numeric, 2)::float        AS approved_amount,
        ROUND(COALESCE(SUM(CASE WHEN te.status='pending'  THEN te.hours * c.hourly_rate ELSE 0 END), 0)::numeric, 2)::float        AS pending_amount,
        ROUND(COALESCE(SUM(te.hours * c.hourly_rate), 0)::numeric, 2)::float                                                       AS total_billable
      FROM time_entries te
      JOIN employees c  ON te.candidate_id = c.id
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE ${teWhere}
      GROUP BY c.id, c.name, c.hourly_rate, cl.name
      ORDER BY total_billable DESC
    `, teParams);

    // Invoice status summary — filter on invoices + candidates
    const { whereClause: invWhere, params: invParams } = buildWherePg([
      { fragment: 'i.period_start >= ?', value: start_date   },
      { fragment: 'i.period_end <= ?',   value: end_date     },
      { fragment: 'i.candidate_id = ?',  value: candidate_id },
      { fragment: 'c.client_id = ?',     value: client_id    },
    ]);

    const invoicesResult = await req.db.query(`
      SELECT
        c.name  AS employee_name,
        cl.name AS client_name,
        i.invoice_number,
        i.period_start AS issue_date,
        i.due_date,
        i.total_amount::float,
        i.status,
        i.total_hours::float AS hours_billed
      FROM invoices i
      JOIN employees c  ON i.candidate_id = c.id
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE ${invWhere}
      ORDER BY i.period_start DESC
    `, invParams);

    const invTotalsResult = await req.db.query(`
      SELECT
        ROUND(COALESCE(SUM(CASE WHEN i.status='paid'  THEN i.total_amount ELSE 0 END), 0)::numeric, 2)::float  AS paid,
        ROUND(COALESCE(SUM(CASE WHEN i.status='sent'  THEN i.total_amount ELSE 0 END), 0)::numeric, 2)::float  AS outstanding,
        ROUND(COALESCE(SUM(CASE WHEN i.status='draft' THEN i.total_amount ELSE 0 END), 0)::numeric, 2)::float  AS draft,
        ROUND(COALESCE(SUM(i.total_amount), 0)::numeric, 2)::float                                             AS total,
        COUNT(i.id)::int AS invoice_count
      FROM invoices i
      JOIN employees c ON i.candidate_id = c.id
      WHERE ${invWhere}
    `, invParams);

    // Per-client revenue (for bar chart)
    const byClientResult = await req.db.query(`
      SELECT
        cl.name  AS client_name,
        ROUND(COALESCE(SUM(CASE WHEN te.status='approved' THEN te.hours * c.hourly_rate ELSE 0 END), 0)::numeric, 2)::float AS approved_amount,
        ROUND(COALESCE(SUM(te.hours * c.hourly_rate), 0)::numeric, 2)::float AS total_amount,
        ROUND(COALESCE(SUM(te.hours), 0)::numeric, 2)::float AS total_hours
      FROM time_entries te
      JOIN employees c  ON te.candidate_id = c.id
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE ${teWhere}
      GROUP BY cl.name
      ORDER BY approved_amount DESC
    `, teParams);

    // Monthly revenue trend (for line chart)
    const monthlyRevResult = await req.db.query(`
      SELECT
        TO_CHAR(te.date, 'YYYY-MM') AS month,
        ROUND(COALESCE(SUM(CASE WHEN te.status='approved' THEN te.hours * c.hourly_rate ELSE 0 END), 0)::numeric, 2)::float AS approved_amount,
        ROUND(COALESCE(SUM(te.hours * c.hourly_rate), 0)::numeric, 2)::float AS total_amount
      FROM time_entries te
      JOIN employees c ON te.candidate_id = c.id
      WHERE ${teWhere}
      GROUP BY TO_CHAR(te.date, 'YYYY-MM')
      ORDER BY month ASC
    `, teParams);

    res.json({
      billable:  billableResult.rows,
      invoices:  invoicesResult.rows,
      invTotals: invTotalsResult.rows[0] || null,
      byClient:  byClientResult.rows,
      monthly:   monthlyRevResult.rows,
    });
  } catch (err) {
    console.error('[reports/revenue]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reports/summary
 * Single-call overview: KPIs — used by the dashboard to populate all tabs in one shot.
 */
router.get('/summary', async (req, res) => {
  try {
    const start_date   = sanitizeQueryDate(req.query.start_date,   'start_date');
    const end_date     = sanitizeQueryDate(req.query.end_date,     'end_date');
    const candidate_id = sanitizeQueryInt(req.query.candidate_id,  'candidate_id');

    const { whereClause: teWhere, params: teParams } = buildWherePg([
      { fragment: 'te.date >= ?',        value: start_date   },
      { fragment: 'te.date <= ?',        value: end_date     },
      { fragment: 'te.candidate_id = ?', value: candidate_id },
    ]);

    const { whereClause: absWhere, params: absParams } = buildWherePg([
      { fragment: 'a.start_date >= ?',   value: start_date   },
      { fragment: 'a.start_date <= ?',   value: end_date     },
      { fragment: 'a.candidate_id = ?',  value: candidate_id },
    ]);

    const [kpisResult, absKpiResult] = await Promise.all([
      req.db.query(`
        SELECT
          ROUND(COALESCE(SUM(te.hours), 0)::numeric, 2)::float                                                                 AS total_hours,
          ROUND(COALESCE(SUM(CASE WHEN te.status='approved' THEN te.hours ELSE 0 END), 0)::numeric, 2)::float                  AS approved_hours,
          ROUND(COALESCE(SUM(CASE WHEN te.status='pending'  THEN te.hours ELSE 0 END), 0)::numeric, 2)::float                  AS pending_hours,
          ROUND(COALESCE(SUM(CASE WHEN te.status='approved' THEN te.hours * c.hourly_rate ELSE 0 END), 0)::numeric, 2)::float  AS approved_revenue,
          ROUND(COALESCE(SUM(te.hours * c.hourly_rate), 0)::numeric, 2)::float                                                 AS total_revenue,
          COUNT(DISTINCT te.candidate_id)::int AS active_candidates
        FROM time_entries te
        JOIN employees c ON te.candidate_id = c.id
        WHERE ${teWhere}
      `, teParams),

      req.db.query(`
        SELECT
          COUNT(a.id)::int AS total_absences,
          COALESCE(SUM(a.end_date::date - a.start_date::date + 1), 0)::int AS total_absence_days
        FROM absences a
        WHERE ${absWhere}
      `, absParams),
    ]);

    res.json({
      kpis: {
        ...(kpisResult.rows[0]  || {}),
        ...(absKpiResult.rows[0] || {}),
      },
    });
  } catch (err) {
    console.error('[reports/summary]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/utilization — Project utilization & per-person utilization
router.get('/utilization', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const { start_date, end_date, client_id } = req.query;

    // ── Project-level query ──────────────────────────────────────────────────
    const projParams = [];
    const projWhere  = [`p.status != 'cancelled'`];
    let   teJoinCond = '';

    if (client_id)  { projParams.push(parseInt(client_id, 10)); projWhere.push(`p.client_id = $${projParams.length}`); }
    if (start_date) { projParams.push(start_date); teJoinCond += ` AND te.date >= $${projParams.length}`; }
    if (end_date)   { projParams.push(end_date);   teJoinCond += ` AND te.date <= $${projParams.length}`; }

    const projectResult = await req.db.query(`
      SELECT
        p.id, p.name AS project_name, p.billing_model, p.budget_hours, p.budget_amount,
        c.name AS client_name,
        COALESCE(SUM(te.hours), 0)                                                                   AS total_hours,
        COALESCE(SUM(te.hours) FILTER (WHERE te.status = 'approved'), 0)                             AS approved_hours,
        COALESCE(SUM(te.hours) FILTER (WHERE te.is_billable = TRUE AND te.status = 'approved'), 0)   AS billable_hours,
        COALESCE((
          SELECT SUM(inv.total_amount)
          FROM invoices inv
          WHERE inv.project_id = p.id AND inv.status NOT IN ('cancelled','draft')
        ), 0) AS invoiced_total,
        CASE WHEN COALESCE(SUM(te.hours), 0) > 0
          THEN ROUND(COALESCE(SUM(te.hours) FILTER (WHERE te.is_billable = TRUE AND te.status = 'approved'), 0)
                     / COALESCE(SUM(te.hours), 1) * 100)
          ELSE 0 END AS utilization_pct
      FROM projects p
      LEFT JOIN clients c       ON c.id  = p.client_id
      LEFT JOIN time_entries te ON te.project_id = p.id ${teJoinCond}
      WHERE ${projWhere.join(' AND ')}
      GROUP BY p.id, p.name, p.billing_model, p.budget_hours, p.budget_amount, c.name
      HAVING COALESCE(SUM(te.hours), 0) > 0
      ORDER BY billable_hours DESC
    `, projParams);

    // ── Per-person query ─────────────────────────────────────────────────────
    const personParams = [];
    const personWhere  = [];

    if (client_id)  { personParams.push(parseInt(client_id, 10)); personWhere.push(`ca.client_id = $${personParams.length}`); }
    if (start_date) { personParams.push(start_date); personWhere.push(`te.date >= $${personParams.length}`); }
    if (end_date)   { personParams.push(end_date);   personWhere.push(`te.date <= $${personParams.length}`); }

    const personResult = await req.db.query(`
      SELECT
        ca.id, ca.name, ca.role, ca.target_utilization,
        COALESCE(SUM(te.hours), 0)                                                                   AS total_hours,
        COALESCE(SUM(te.hours) FILTER (WHERE te.is_billable = TRUE AND te.status = 'approved'), 0)   AS billable_hours,
        COALESCE(SUM(te.hours) FILTER (WHERE te.status = 'approved'), 0)                             AS approved_hours,
        CASE WHEN COALESCE(SUM(te.hours), 0) > 0
          THEN ROUND(COALESCE(SUM(te.hours) FILTER (WHERE te.is_billable = TRUE AND te.status = 'approved'), 0)
                     / COALESCE(SUM(te.hours), 1) * 100)
          ELSE 0 END AS utilization_pct
      FROM employees ca
      INNER JOIN time_entries te ON te.candidate_id = ca.id
      ${personWhere.length ? 'WHERE ' + personWhere.join(' AND ') : ''}
      GROUP BY ca.id, ca.name, ca.role, ca.target_utilization
      ORDER BY utilization_pct DESC
    `, personParams);

    // ── Retainer burn per project ──────────────────────────────────────────
    // For retainer projects: show hours consumed vs budget (retainer_amount / avg bill rate)
    const retainerProjects = projectResult.rows.filter(p => p.billing_model === 'retainer');

    // ── Realization rate: invoiced_total / (billable_hours * bill_rate) ───
    // Using the rate_card resolved bill_rate where available, else candidate.hourly_rate
    const totalBillableHrs   = projectResult.rows.reduce((s, r) => s + Number(r.billable_hours), 0);
    const totalInvoiced      = projectResult.rows.reduce((s, r) => s + Number(r.invoiced_total), 0);

    // Unbilled: approved billable hours not yet on any invoice
    const unbilledResult = await req.db.query(`
      SELECT COALESCE(SUM(te.hours), 0) AS unbilled_hrs
      FROM time_entries te
      WHERE te.is_billable = TRUE AND te.status = 'approved' AND te.invoice_id IS NULL
      ${start_date ? `AND te.date >= '${start_date}'` : ''}
      ${end_date   ? `AND te.date <= '${end_date}'`   : ''}
    `);
    const unbilledHrs = Number(unbilledResult.rows[0]?.unbilled_hrs ?? 0);

    // For realization we need bill rates — approximate from invoiced / billed hrs
    const realizationPct = totalBillableHrs > 0 && totalInvoiced > 0
      ? Math.round((totalInvoiced / (totalInvoiced + unbilledHrs * (totalInvoiced / totalBillableHrs))) * 100)
      : 0;

    res.json({
      totals: {
        avg_utilization_pct: personResult.rows.length
          ? Math.round(personResult.rows.reduce((s, r) => s + Number(r.utilization_pct), 0) / personResult.rows.length)
          : 0,
        total_billable_hrs: Math.round(totalBillableHrs * 100) / 100,
        unbilled_hrs:       Math.round(unbilledHrs * 100) / 100,
        total_invoiced:     Math.round(totalInvoiced * 100) / 100,
        realization_pct:    realizationPct,
      },
      projects: projectResult.rows,
      people:   personResult.rows,
      retainer_projects: retainerProjects.map(p => ({
        ...p,
        retainer_burn_pct: p.retainer_amount > 0
          ? Math.min(100, Math.round(Number(p.invoiced_total) / Number(p.retainer_amount) * 100))
          : null,
      })),
    });
  } catch (err) {
    console.error('GET /reports/utilization', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/reports/overtime-risk
// Shows employees who are at risk of overtime in the current or specified workweek.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/overtime-risk', async (req, res) => {
  try {
    const { week_start } = req.query;

    // Default: current workweek Mon–Sun
    let weekBegin, weekEnd;
    if (week_start) {
      weekBegin = week_start;
      const d = new Date(week_start + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + 6);
      weekEnd = d.toISOString().slice(0, 10);
    } else {
      const now = new Date();
      const dow = now.getUTCDay(); // 0=Sun
      const diff = dow === 0 ? 6 : dow - 1; // Mon=0
      const mon = new Date(now); mon.setUTCDate(now.getUTCDate() - diff);
      const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
      weekBegin = mon.toISOString().slice(0, 10);
      weekEnd   = sun.toISOString().slice(0, 10);
    }

    const result = await req.db.query(`
      SELECT
        ca.id, ca.name, ca.role, ca.hourly_rate,
        COALESCE(pr.weekly_ot_threshold, 40) AS ot_threshold,
        COALESCE(SUM(te.hours), 0)           AS hours_this_week,
        COALESCE(SUM(te.hours), 0) - COALESCE(pr.weekly_ot_threshold, 40) AS ot_exposure_hrs,
        CASE WHEN COALESCE(SUM(te.hours), 0) >= COALESCE(pr.weekly_ot_threshold, 40)
          THEN 'over' WHEN COALESCE(SUM(te.hours), 0) >= COALESCE(pr.weekly_ot_threshold, 40) * 0.8
          THEN 'at_risk' ELSE 'safe' END      AS risk_level,
        pr.name AS pay_rule_name
      FROM employees ca
      LEFT JOIN pay_rules pr ON pr.id = COALESCE(ca.pay_rule_id,
        (SELECT id FROM pay_rules WHERE is_default = TRUE LIMIT 1))
      LEFT JOIN time_entries te ON te.candidate_id = ca.id
        AND te.date BETWEEN $1 AND $2
        AND te.status != 'rejected'
      WHERE ca.status = 'active' AND ca.deleted_at IS NULL
      GROUP BY ca.id, ca.name, ca.role, ca.hourly_rate, pr.weekly_ot_threshold, pr.name
      ORDER BY hours_this_week DESC
    `, [weekBegin, weekEnd]);

    const rows = result.rows;
    res.json({
      week: { start: weekBegin, end: weekEnd },
      summary: {
        total_employees: rows.length,
        over_ot:         rows.filter(r => r.risk_level === 'over').length,
        at_risk:         rows.filter(r => r.risk_level === 'at_risk').length,
        safe:            rows.filter(r => r.risk_level === 'safe').length,
      },
      employees: rows,
    });
  } catch (err) {
    console.error('GET /reports/overtime-risk', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/reports/missing-approvals
// Lists time entries that have been pending for more than N days.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/missing-approvals', async (req, res) => {
  try {
    const { days_pending = 3, candidate_id, client_id } = req.query;

    const params  = [parseInt(days_pending, 10)];
    const extras  = [];

    if (candidate_id) { params.push(parseInt(candidate_id, 10)); extras.push(`te.candidate_id = $${params.length}`); }
    if (client_id)    { params.push(parseInt(client_id, 10));    extras.push(`ca.client_id    = $${params.length}`); }

    const extraWhere = extras.length ? ` AND ${extras.join(' AND ')}` : '';

    const result = await req.db.query(`
      SELECT
        te.id, te.date, te.hours, te.description, te.created_at, te.project_id,
        ca.name AS employee_name, ca.email AS employee_email,
        cl.name AS client_name,
        p.name  AS project_name,
        CURRENT_DATE - te.date::date AS days_old,
        NOW() - te.created_at        AS age
      FROM time_entries te
      JOIN employees ca ON ca.id = te.candidate_id
      LEFT JOIN clients cl ON cl.id = ca.client_id
      LEFT JOIN projects p ON p.id = te.project_id
      WHERE te.status = 'pending'
        AND te.date < CURRENT_DATE - ($1 || ' days')::interval
        ${extraWhere}
      ORDER BY te.date ASC
    `, params);

    res.json({
      threshold_days: parseInt(days_pending, 10),
      count:          result.rows.length,
      entries:        result.rows,
    });
  } catch (err) {
    console.error('GET /reports/missing-approvals', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/reports/compliance
// Compliance exceptions: missing records, retention alerts, classification risks
// ═══════════════════════════════════════════════════════════════════════════
router.get('/compliance', async (req, res) => {
  try {
    // 1. Employees missing critical records (I-9 metadata flag = w9_collected)
    const missingW9 = await req.db.query(`
      SELECT ca.id, ca.name, ca.email, ca.classification_status, ca.start_date
      FROM employees ca
      WHERE ca.classification_status = 'contractor'
        AND (ca.w9_collected = FALSE OR ca.w9_collected IS NULL)
        AND ca.deleted_at IS NULL AND ca.status = 'active'
      ORDER BY ca.name
    `);

    // 2. Pending contractor classification reviews
    const pendingClassification = await req.db.query(`
      SELECT ca.id, ca.name, ca.email, ca.start_date, ca.classification_notes
      FROM employees ca
      WHERE ca.classification_status = 'pending_review'
        AND ca.deleted_at IS NULL
      ORDER BY ca.start_date
    `);

    // 3. Time entries with no approval for >7 days (payroll deadline risk)
    const staleEntries = await req.db.query(`
      SELECT COUNT(*) AS count
      FROM time_entries te
      WHERE te.status = 'pending' AND te.date < CURRENT_DATE - INTERVAL '7 days'
    `);

    // 4. Employees with end dates in the past but still active
    const terminatedActive = await req.db.query(`
      SELECT ca.id, ca.name, ca.end_date, ca.status
      FROM employees ca
      WHERE ca.end_date IS NOT NULL
        AND ca.end_date < CURRENT_DATE
        AND ca.status = 'active'
        AND ca.deleted_at IS NULL
      ORDER BY ca.end_date
    `);

    // 5. Data requests pending > 30 days (CCPA: 45-day response deadline)
    const overdueDataRequests = await req.db.query(`
      SELECT dr.id, dr.request_type, dr.created_at, dr.status,
             ca.name AS employee_name
      FROM data_requests dr
      JOIN employees ca ON ca.id = dr.candidate_id
      WHERE dr.status IN ('pending','in_progress')
        AND dr.created_at < NOW() - INTERVAL '30 days'
      ORDER BY dr.created_at
    `).catch(() => ({ rows: [] })); // table may not exist on older tenants

    // 6. Documents approaching retention expiry (within 60 days)
    const expiringDocs = await req.db.query(`
      SELECT d.id, d.title, d.document_type, d.expires_at, ca.name AS employee_name
      FROM documents d
      LEFT JOIN employees ca ON ca.id = d.candidate_id
      WHERE d.expires_at IS NOT NULL
        AND d.expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '60 days'
      ORDER BY d.expires_at
    `).catch(() => ({ rows: [] }));

    res.json({
      summary: {
        missing_w9:            missingW9.rows.length,
        pending_classification: pendingClassification.rows.length,
        stale_pending_entries:  parseInt(staleEntries.rows[0]?.count ?? 0, 10),
        terminated_still_active: terminatedActive.rows.length,
        overdue_data_requests:  overdueDataRequests.rows.length,
        expiring_documents:     expiringDocs.rows.length,
      },
      missing_w9:             missingW9.rows,
      pending_classification: pendingClassification.rows,
      terminated_still_active: terminatedActive.rows,
      overdue_data_requests:  overdueDataRequests.rows,
      expiring_documents:     expiringDocs.rows,
    });
  } catch (err) {
    console.error('GET /reports/compliance', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CSV EXPORT ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

function toCSV(rows, columns) {
  const header = columns.map(c => `"${c.label}"`).join(',');
  const lines  = rows.map(row =>
    columns.map(c => {
      const v = row[c.key] ?? '';
      const s = String(v).replace(/"/g, '""');
      return `"${s}"`;
    }).join(',')
  );
  return [header, ...lines].join('\r\n');
}

// GET /api/reports/export/time-entries.csv
router.get('/export/time-entries.csv', async (req, res) => {
  try {
    const { start_date, end_date, candidate_id, status } = req.query;
    const params = []; const where = [];
    if (start_date)   { params.push(start_date); where.push(`te.date >= $${params.length}`); }
    if (end_date)     { params.push(end_date);   where.push(`te.date <= $${params.length}`); }
    if (candidate_id) { params.push(parseInt(candidate_id,10)); where.push(`te.candidate_id = $${params.length}`); }
    if (status)       { params.push(status);     where.push(`te.status = $${params.length}`); }

    const result = await req.db.query(`
      SELECT te.id, te.date, ca.name AS employee, cl.name AS client, p.name AS project,
             pt.name AS task, te.hours, te.is_billable, te.status, te.description,
             te.billing_notes, ca.hourly_rate,
             ROUND(te.hours * ca.hourly_rate, 2) AS amount, te.created_at
      FROM time_entries te
      JOIN employees ca ON ca.id = te.candidate_id
      LEFT JOIN clients cl ON cl.id = ca.client_id
      LEFT JOIN projects p ON p.id = te.project_id
      LEFT JOIN project_tasks pt ON pt.id = te.task_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY te.date, ca.name
    `, params);

    const csv = toCSV(result.rows, [
      { key: 'id',           label: 'ID' },
      { key: 'date',         label: 'Date' },
      { key: 'employee',     label: 'Employee' },
      { key: 'client',       label: 'Client' },
      { key: 'project',      label: 'Project' },
      { key: 'task',         label: 'Task' },
      { key: 'hours',        label: 'Hours' },
      { key: 'is_billable',  label: 'Billable' },
      { key: 'status',       label: 'Status' },
      { key: 'description',  label: 'Description' },
      { key: 'billing_notes',label: 'Billing Notes' },
      { key: 'hourly_rate',  label: 'Rate ($/hr)' },
      { key: 'amount',       label: 'Amount ($)' },
    ]);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="time-entries.csv"');
    res.send(csv);
  } catch (err) {
    console.error('GET /reports/export/time-entries.csv', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/export/invoices.csv
router.get('/export/invoices.csv', async (req, res) => {
  try {
    const { start_date, end_date, status } = req.query;
    const params = []; const where = [];
    if (start_date) { params.push(start_date); where.push(`inv.invoice_date >= $${params.length}`); }
    if (end_date)   { params.push(end_date);   where.push(`inv.invoice_date <= $${params.length}`); }
    if (status)     { params.push(status);     where.push(`inv.status = $${params.length}`); }

    const result = await req.db.query(`
      SELECT inv.id, inv.invoice_number, inv.invoice_date, inv.due_date,
             cl.name AS client, ca.name AS employee, p.name AS project,
             inv.subtotal, inv.tax_amount, inv.discount_amount, inv.total_amount,
             inv.billing_model, inv.status, inv.paid_at, inv.sent_at
      FROM invoices inv
      LEFT JOIN clients cl ON cl.id = inv.client_id
      LEFT JOIN employees ca ON ca.id = inv.candidate_id
      LEFT JOIN projects p ON p.id = inv.project_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY inv.invoice_date DESC
    `, params);

    const csv = toCSV(result.rows, [
      { key: 'invoice_number', label: 'Invoice #' },
      { key: 'invoice_date',   label: 'Date' },
      { key: 'due_date',       label: 'Due Date' },
      { key: 'client',         label: 'Client' },
      { key: 'employee',       label: 'Employee' },
      { key: 'project',        label: 'Project' },
      { key: 'billing_model',  label: 'Billing Model' },
      { key: 'subtotal',       label: 'Subtotal ($)' },
      { key: 'discount_amount',label: 'Discount ($)' },
      { key: 'tax_amount',     label: 'Tax ($)' },
      { key: 'total_amount',   label: 'Total ($)' },
      { key: 'status',         label: 'Status' },
      { key: 'sent_at',        label: 'Sent At' },
      { key: 'paid_at',        label: 'Paid At' },
    ]);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="invoices.csv"');
    res.send(csv);
  } catch (err) {
    console.error('GET /reports/export/invoices.csv', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/export/payroll.csv
router.get('/export/payroll.csv', async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const params = []; const where = ['te.status = \'approved\''];
    if (start_date) { params.push(start_date); where.push(`te.date >= $${params.length}`); }
    if (end_date)   { params.push(end_date);   where.push(`te.date <= $${params.length}`); }

    const result = await req.db.query(`
      SELECT
        ca.name AS employee, ca.email, ca.role, ca.contract_type, ca.hourly_rate,
        COALESCE(pr.weekly_ot_threshold, 40) AS ot_threshold,
        COALESCE(pr.ot_multiplier, 1.5) AS ot_multiplier,
        SUM(te.hours)                    AS total_hours,
        LEAST(SUM(te.hours), COALESCE(pr.weekly_ot_threshold, 40)) AS regular_hours,
        GREATEST(SUM(te.hours) - COALESCE(pr.weekly_ot_threshold, 40), 0) AS ot_hours,
        ROUND(
          LEAST(SUM(te.hours), COALESCE(pr.weekly_ot_threshold, 40)) * ca.hourly_rate
          + GREATEST(SUM(te.hours) - COALESCE(pr.weekly_ot_threshold, 40), 0)
            * ca.hourly_rate * COALESCE(pr.ot_multiplier, 1.5), 2
        ) AS gross_pay
      FROM time_entries te
      JOIN employees ca ON ca.id = te.candidate_id
      LEFT JOIN pay_rules pr ON pr.id = COALESCE(ca.pay_rule_id,
        (SELECT id FROM pay_rules WHERE is_default = TRUE LIMIT 1))
      WHERE ${where.join(' AND ')}
      GROUP BY ca.id, ca.name, ca.email, ca.role, ca.contract_type, ca.hourly_rate,
               pr.weekly_ot_threshold, pr.ot_multiplier
      ORDER BY ca.name
    `, params);

    const csv = toCSV(result.rows, [
      { key: 'employee',      label: 'Employee' },
      { key: 'email',         label: 'Email' },
      { key: 'role',          label: 'Role' },
      { key: 'contract_type', label: 'Employment Type' },
      { key: 'hourly_rate',   label: 'Rate ($/hr)' },
      { key: 'total_hours',   label: 'Total Hours' },
      { key: 'regular_hours', label: 'Regular Hours' },
      { key: 'ot_hours',      label: 'OT Hours' },
      { key: 'ot_threshold',  label: 'OT Threshold' },
      { key: 'ot_multiplier', label: 'OT Rate' },
      { key: 'gross_pay',     label: 'Gross Pay ($)' },
    ]);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="payroll.csv"');
    res.send(csv);
  } catch (err) {
    console.error('GET /reports/export/payroll.csv', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/reports/labor-cost
// Cost per project / client, absence cost, profitability
// ═══════════════════════════════════════════════════════════════════════════
router.get('/labor-cost', async (req, res) => {
  try {
    const start_date   = sanitizeQueryDate(req.query.start_date, 'start_date');
    const end_date     = sanitizeQueryDate(req.query.end_date,   'end_date');
    const candidate_id = sanitizeQueryInt(req.query.candidate_id, 'candidate_id');
    const client_id    = sanitizeQueryInt(req.query.client_id,    'client_id');

    const { whereClause: teWhere, params: teParams } = buildWherePg([
      { fragment: 'te.date >= ?',        value: start_date   },
      { fragment: 'te.date <= ?',        value: end_date     },
      { fragment: 'te.candidate_id = ?', value: candidate_id },
      { fragment: 'c.client_id = ?',     value: client_id    },
    ]);

    // ── Cost per project ───────────────────────────────────────────────────
    const projectCostResult = await req.db.query(`
      SELECT
        p.id          AS project_id,
        p.name        AS project_name,
        cl.name       AS client_name,
        p.billing_model,
        ROUND(COALESCE(SUM(te.hours * c.hourly_rate), 0)::numeric, 2)::float           AS labor_cost,
        ROUND(COALESCE(SUM(te.hours), 0)::numeric, 2)::float                           AS total_hours,
        ROUND(COALESCE(SUM(CASE WHEN te.status='approved' THEN te.hours * c.hourly_rate ELSE 0 END), 0)::numeric, 2)::float AS approved_cost,
        ROUND(COALESCE((
          SELECT SUM(i.total_amount) FROM invoices i WHERE i.project_id = p.id
            AND (start_date IS NULL OR i.period_start >= start_date)
            AND (end_date IS NULL   OR i.period_end   <= end_date)
        ), 0)::numeric, 2)::float AS invoiced_revenue,
        p.budget_hours,
        p.retainer_amount
      FROM time_entries te
      JOIN employees c  ON te.candidate_id = c.id
      LEFT JOIN clients cl ON c.client_id = cl.id
      LEFT JOIN projects p ON te.project_id = p.id
      WHERE ${teWhere} AND te.project_id IS NOT NULL
      GROUP BY p.id, p.name, cl.name, p.billing_model, p.budget_hours, p.retainer_amount
      ORDER BY labor_cost DESC
    `, teParams);

    // ── Cost per client ────────────────────────────────────────────────────
    const clientCostResult = await req.db.query(`
      SELECT
        cl.id         AS client_id,
        COALESCE(cl.name, 'No Client') AS client_name,
        ROUND(COALESCE(SUM(te.hours * c.hourly_rate), 0)::numeric, 2)::float           AS labor_cost,
        ROUND(COALESCE(SUM(te.hours), 0)::numeric, 2)::float                           AS total_hours,
        ROUND(COALESCE(SUM(CASE WHEN te.status='approved' THEN te.hours * c.hourly_rate ELSE 0 END), 0)::numeric, 2)::float AS approved_cost,
        ROUND(COALESCE((
          SELECT SUM(i.total_amount) FROM invoices i
          JOIN employees ec ON ec.id = i.candidate_id
          WHERE ec.client_id = cl.id
            AND (start_date IS NULL OR i.period_start >= start_date)
            AND (end_date IS NULL   OR i.period_end   <= end_date)
        ), 0)::numeric, 2)::float AS invoiced_revenue
      FROM time_entries te
      JOIN employees c  ON te.candidate_id = c.id
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE ${teWhere}
      GROUP BY cl.id, cl.name
      ORDER BY labor_cost DESC
    `, teParams);

    // ── Absence cost (approved absence days × daily rate) ──────────────────
    const { whereClause: absWhere, params: absParams } = buildWherePg([
      { fragment: 'a.start_date >= ?',   value: start_date   },
      { fragment: 'a.end_date <= ?',     value: end_date     },
      { fragment: 'a.candidate_id = ?',  value: candidate_id },
      { fragment: 'c.client_id = ?',     value: client_id    },
    ]);

    const absenceCostResult = await req.db.query(`
      SELECT
        c.id          AS employee_id,
        c.name        AS employee_name,
        c.hourly_rate::float,
        COALESCE(SUM(a.end_date::date - a.start_date::date + 1), 0)::int           AS absence_days,
        ROUND(COALESCE(SUM((a.end_date::date - a.start_date::date + 1) * c.hourly_rate * 8), 0)::numeric, 2)::float AS absence_cost
      FROM absences a
      JOIN employees c ON a.candidate_id = c.id
      WHERE ${absWhere} AND a.status = 'approved'
      GROUP BY c.id, c.name, c.hourly_rate
      ORDER BY absence_cost DESC
    `, absParams);

    // ── Employee-level cost vs revenue ─────────────────────────────────────
    const employeePLResult = await req.db.query(`
      SELECT
        c.id          AS employee_id,
        c.name        AS employee_name,
        c.hourly_rate::float,
        cl.name       AS client_name,
        ROUND(COALESCE(SUM(te.hours), 0)::numeric, 2)::float                                           AS total_hours,
        ROUND(COALESCE(SUM(CASE WHEN te.status='approved' THEN te.hours * c.hourly_rate ELSE 0 END), 0)::numeric, 2)::float AS labor_cost,
        ROUND(COALESCE(SUM(CASE WHEN te.status='approved' THEN te.hours * c.hourly_rate ELSE 0 END), 0)::numeric, 2)::float AS billable_revenue
      FROM time_entries te
      JOIN employees c  ON te.candidate_id = c.id
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE ${teWhere}
      GROUP BY c.id, c.name, c.hourly_rate, cl.name
      ORDER BY billable_revenue DESC
    `, teParams);

    // ── Totals ─────────────────────────────────────────────────────────────
    const totalLaborCost   = projectCostResult.rows.reduce((s, r) => s + Number(r.labor_cost),   0);
    const totalRevenue     = clientCostResult.rows.reduce((s, r) => s + Number(r.invoiced_revenue), 0);
    const totalAbsenceCost = absenceCostResult.rows.reduce((s, r) => s + Number(r.absence_cost), 0);
    const grossMargin      = totalRevenue - totalLaborCost;
    const marginPct        = totalRevenue > 0 ? Math.round((grossMargin / totalRevenue) * 100) : 0;

    // Add profitability to project rows
    const projectsWithProfit = projectCostResult.rows.map(p => ({
      ...p,
      gross_profit:  Math.round((Number(p.invoiced_revenue) - Number(p.labor_cost)) * 100) / 100,
      margin_pct:    Number(p.invoiced_revenue) > 0
        ? Math.round(((Number(p.invoiced_revenue) - Number(p.labor_cost)) / Number(p.invoiced_revenue)) * 100)
        : null,
    }));

    const clientsWithProfit = clientCostResult.rows.map(c => ({
      ...c,
      gross_profit: Math.round((Number(c.invoiced_revenue) - Number(c.labor_cost)) * 100) / 100,
      margin_pct:   Number(c.invoiced_revenue) > 0
        ? Math.round(((Number(c.invoiced_revenue) - Number(c.labor_cost)) / Number(c.invoiced_revenue)) * 100)
        : null,
    }));

    res.json({
      totals: {
        total_labor_cost:   Math.round(totalLaborCost   * 100) / 100,
        total_revenue:      Math.round(totalRevenue     * 100) / 100,
        total_absence_cost: Math.round(totalAbsenceCost * 100) / 100,
        gross_margin:       Math.round(grossMargin      * 100) / 100,
        margin_pct,
      },
      byProject:  projectsWithProfit,
      byClient:   clientsWithProfit,
      absenceCost: absenceCostResult.rows,
      byEmployee: employeePLResult.rows,
    });
  } catch (err) {
    console.error('GET /reports/labor-cost', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/reports/comparison
// Returns totals for current period + previous period for period-over-period
// ═══════════════════════════════════════════════════════════════════════════
router.get('/comparison', async (req, res) => {
  try {
    const start      = sanitizeQueryDate(req.query.start_date,      'start_date');
    const end        = sanitizeQueryDate(req.query.end_date,         'end_date');
    const cmpStart   = sanitizeQueryDate(req.query.compare_start,    'compare_start');
    const cmpEnd     = sanitizeQueryDate(req.query.compare_end,      'compare_end');
    const client_id  = sanitizeQueryInt(req.query.client_id,         'client_id');
    const emp_id     = sanitizeQueryInt(req.query.candidate_id,      'candidate_id');

    async function getPeriodTotals(s, e) {
      const { whereClause, params } = buildWherePg([
        { fragment: 'te.date >= ?',        value: s        },
        { fragment: 'te.date <= ?',        value: e        },
        { fragment: 'c.client_id = ?',     value: client_id },
        { fragment: 'te.candidate_id = ?', value: emp_id    },
      ]);
      const r = await req.db.query(`
        SELECT
          ROUND(COALESCE(SUM(te.hours), 0)::numeric, 2)::float                                                AS total_hours,
          ROUND(COALESCE(SUM(CASE WHEN te.status='approved' THEN te.hours ELSE 0 END), 0)::numeric, 2)::float AS approved_hours,
          ROUND(COALESCE(SUM(CASE WHEN te.status='approved' THEN te.hours * c.hourly_rate ELSE 0 END), 0)::numeric, 2)::float AS approved_revenue,
          COUNT(te.id)::int AS entry_count
        FROM time_entries te
        JOIN employees c ON te.candidate_id = c.id
        WHERE ${whereClause}
      `, params);

      const { whereClause: absWhere, params: absParams } = buildWherePg([
        { fragment: 'a.start_date >= ?',  value: s        },
        { fragment: 'a.end_date <= ?',    value: e        },
        { fragment: 'c.client_id = ?',    value: client_id },
        { fragment: 'a.candidate_id = ?', value: emp_id    },
      ]);
      const absR = await req.db.query(`
        SELECT COALESCE(SUM(a.end_date::date - a.start_date::date + 1), 0)::int AS absence_days
        FROM absences a
        JOIN employees c ON a.candidate_id = c.id
        WHERE ${absWhere} AND a.status = 'approved'
      `, absParams);

      return {
        start: s, end: e,
        ...r.rows[0],
        absence_days: absR.rows[0]?.absence_days ?? 0,
      };
    }

    const [current, previous] = await Promise.all([
      getPeriodTotals(start, end),
      getPeriodTotals(cmpStart, cmpEnd),
    ]);

    function delta(cur, prev) {
      const c = Number(cur  || 0);
      const p = Number(prev || 0);
      return {
        current: c,
        previous: p,
        change: Math.round((c - p) * 100) / 100,
        pct_change: p !== 0 ? Math.round(((c - p) / p) * 100) : null,
      };
    }

    res.json({
      current,
      previous,
      deltas: {
        total_hours:     delta(current.total_hours,     previous.total_hours),
        approved_hours:  delta(current.approved_hours,  previous.approved_hours),
        approved_revenue: delta(current.approved_revenue, previous.approved_revenue),
        absence_days:    delta(current.absence_days,    previous.absence_days),
      },
    });
  } catch (err) {
    console.error('GET /reports/comparison', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

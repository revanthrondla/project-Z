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
        c.name        AS candidate_name,
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
      JOIN candidates c  ON te.candidate_id = c.id
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
      JOIN candidates c ON te.candidate_id = c.id
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
      JOIN candidates c ON te.candidate_id = c.id
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
        c.name  AS candidate_name,
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
      JOIN candidates c  ON a.candidate_id = c.id
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
        c.name AS candidate_name
      FROM absences a
      JOIN candidates c ON a.candidate_id = c.id
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
      JOIN candidates c ON a.candidate_id = c.id
      WHERE ${whereClause}
    `, params);

    res.json({
      summary: summaryResult.rows,
      detail:  detailResult.rows,
      totals:  totalsResult.rows[0] || null,
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
        c.name  AS candidate_name,
        c.hourly_rate::float,
        cl.name AS client_name,
        ROUND(COALESCE(SUM(CASE WHEN te.status='approved' THEN te.hours ELSE 0 END), 0)::numeric, 2)::float                       AS approved_hours,
        ROUND(COALESCE(SUM(CASE WHEN te.status='approved' THEN te.hours * c.hourly_rate ELSE 0 END), 0)::numeric, 2)::float        AS approved_amount,
        ROUND(COALESCE(SUM(CASE WHEN te.status='pending'  THEN te.hours * c.hourly_rate ELSE 0 END), 0)::numeric, 2)::float        AS pending_amount,
        ROUND(COALESCE(SUM(te.hours * c.hourly_rate), 0)::numeric, 2)::float                                                       AS total_billable
      FROM time_entries te
      JOIN candidates c  ON te.candidate_id = c.id
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
        c.name  AS candidate_name,
        cl.name AS client_name,
        i.invoice_number,
        i.period_start AS issue_date,
        i.due_date,
        i.total_amount::float,
        i.status,
        i.total_hours::float AS hours_billed
      FROM invoices i
      JOIN candidates c  ON i.candidate_id = c.id
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
      JOIN candidates c ON i.candidate_id = c.id
      WHERE ${invWhere}
    `, invParams);

    res.json({
      billable:  billableResult.rows,
      invoices:  invoicesResult.rows,
      invTotals: invTotalsResult.rows[0] || null,
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
        JOIN candidates c ON te.candidate_id = c.id
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

module.exports = router;

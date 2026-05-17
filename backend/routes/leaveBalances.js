/**
 * Leave Balances + Accrual Engine
 *
 * GET    /api/leave-balances                 — all balances for current user (or admin: all / by employee)
 * GET    /api/leave-balances/:employeeId     — balances for specific employee (admin)
 * POST   /api/leave-balances/accrue          — run accrual for one or all employees (admin)
 * POST   /api/leave-balances/carry-over      — run year-end carry-over for all employees (admin)
 * PUT    /api/leave-balances/:id             — manual adjustment (admin)
 * GET    /api/leave-balances/summary         — PTO dashboard summary for current user
 */

const express = require('express');
const router  = express.Router();
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');

// ── Helpers ────────────────────────────────────────────────────────────────────

async function getEmployeeIdForUser(db, userId) {
  const r = await db.query(
    `SELECT id FROM employees WHERE user_id = $1 AND status = 'active' LIMIT 1`,
    [userId]
  );
  return r.rows[0]?.id || null;
}

/**
 * Compute accrual for a single employee+leave_type based on their policy.
 * Returns the number of days to accrue since last accrual.
 */
async function computeAccrual(db, employeeId, leaveType, balance, policy) {
  if (!policy || policy.accrual_rate_days_per_month <= 0) return 0;

  const lastAccrual = balance.last_accrual_at ? new Date(balance.last_accrual_at) : null;
  const now         = new Date();

  // If accrual ran this month already, skip
  if (lastAccrual) {
    const sameMonth = lastAccrual.getFullYear() === now.getFullYear() &&
                      lastAccrual.getMonth() === now.getMonth();
    if (sameMonth) return 0;
  }

  // Months since last accrual (or since policy start if never run)
  const since = lastAccrual
    ? Math.max(0, monthsBetween(lastAccrual, now))
    : 1;

  let accrued = since * (policy.accrual_rate_days_per_month || 0);

  // Cap at max balance if set
  const currentTotal = (balance.balance_days || 0) + (balance.carry_over_days || 0);
  if (policy.max_balance_days && currentTotal + accrued > policy.max_balance_days) {
    accrued = Math.max(0, policy.max_balance_days - currentTotal);
  }

  return Math.round(accrued * 4) / 4; // round to quarter-day
}

function monthsBetween(from, to) {
  return (to.getFullYear() - from.getFullYear()) * 12 +
         (to.getMonth()    - from.getMonth());
}

// ── GET /api/leave-balances/summary ───────────────────────────────────────────
// Must be before /:id to avoid route conflict
router.get('/summary', authenticate, injectTenantDb, async (req, res) => {
  try {
    const db = req.db;
    let employeeId;

    if (req.user.role === 'candidate') {
      employeeId = await getEmployeeIdForUser(db, req.user.id);
    } else if (req.query.employee_id) {
      employeeId = parseInt(req.query.employee_id, 10);
    }

    if (!employeeId) return res.json([]);

    // Get balances with policy names + pending absence days
    const result = await db.query(`
      SELECT
        lb.*,
        ap.name        AS policy_name,
        ap.leave_type  AS policy_type,
        -- Pending days from approved future absences not yet deducted
        COALESCE((
          SELECT SUM(
            CASE WHEN a.is_partial_day THEN a.partial_hours / 8.0
                 ELSE (a.end_date::date - a.start_date::date + 1)
            END
          )
          FROM absences a
          WHERE a.candidate_id = lb.employee_id
            AND a.type = ap.leave_type
            AND a.status = 'approved'
            AND a.start_date >= CURRENT_DATE
        ), 0) AS upcoming_days
      FROM leave_balances lb
      JOIN absence_policies ap ON ap.id = lb.policy_id
      WHERE lb.employee_id = $1
      ORDER BY ap.leave_type
    `, [employeeId]);

    res.json(result.rows);
  } catch (err) {
    console.error('[leave-balances/summary]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/leave-balances ────────────────────────────────────────────────────
router.get('/', authenticate, injectTenantDb, async (req, res) => {
  try {
    const db = req.db;
    const { employee_id } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (req.user.role === 'candidate') {
      const empId = await getEmployeeIdForUser(db, req.user.id);
      if (!empId) return res.json([]);
      params.push(empId);
      whereClause += ` AND lb.employee_id = $${params.length}`;
    } else if (employee_id) {
      params.push(employee_id);
      whereClause += ` AND lb.employee_id = $${params.length}`;
    }

    const result = await db.query(`
      SELECT lb.*, e.name AS employee_name, ap.name AS policy_name, ap.leave_type
      FROM leave_balances lb
      JOIN employees e ON e.id = lb.employee_id
      JOIN absence_policies ap ON ap.id = lb.policy_id
      ${whereClause}
      ORDER BY e.name, ap.leave_type
    `, params);

    res.json(result.rows);
  } catch (err) {
    console.error('[leave-balances GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/leave-balances/:employeeId ───────────────────────────────────────
router.get('/:employeeId', authenticate, injectTenantDb, async (req, res) => {
  try {
    const db = req.db;
    const empId = parseInt(req.params.employeeId, 10);

    // Candidates can only see their own
    if (req.user.role === 'candidate') {
      const myEmpId = await getEmployeeIdForUser(db, req.user.id);
      if (myEmpId !== empId) return res.status(403).json({ error: 'Access denied' });
    }

    const result = await db.query(`
      SELECT lb.*, ap.name AS policy_name, ap.leave_type,
             ap.accrual_rate_days_per_month, ap.max_days_per_year,
             ap.max_carry_over_days, ap.carry_over_expiry_months
      FROM leave_balances lb
      JOIN absence_policies ap ON ap.id = lb.policy_id
      WHERE lb.employee_id = $1
      ORDER BY ap.leave_type
    `, [empId]);

    res.json(result.rows);
  } catch (err) {
    console.error('[leave-balances/:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/leave-balances/accrue ───────────────────────────────────────────
// Runs monthly accrual for one employee or all employees
router.post('/accrue', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const db = req.db;
    const { employee_id } = req.body;

    let whereClause = 'WHERE e.status = \'active\'';
    const params = [];
    if (employee_id) {
      params.push(employee_id);
      whereClause += ` AND e.id = $${params.length}`;
    }

    // Load all active employees with their leave balances + policies
    const balances = await db.query(`
      SELECT lb.*, ap.accrual_rate_days_per_month, ap.leave_type,
             ap.max_balance_days, ap.max_days_per_year
      FROM leave_balances lb
      JOIN employees e ON e.id = lb.employee_id
      JOIN absence_policies ap ON ap.id = lb.policy_id
      ${whereClause}
    `, params);

    let accrued = 0;
    const now = new Date().toISOString();

    for (const bal of balances.rows) {
      const days = await computeAccrual(db, bal.employee_id, bal.leave_type, bal, bal);
      if (days <= 0) continue;

      await db.query(`
        UPDATE leave_balances SET
          balance_days    = balance_days + $1,
          accrued_days    = accrued_days + $1,
          last_accrual_at = $2,
          updated_at      = $2
        WHERE id = $3
      `, [days, now, bal.id]);

      accrued++;
    }

    res.json({ message: `Accrual complete`, records_updated: accrued, run_at: now });
  } catch (err) {
    console.error('[leave-balances/accrue]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/leave-balances/carry-over ───────────────────────────────────────
// Year-end carry-over: caps carry-over per policy, sets expiry, resets balance
router.post('/carry-over', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const db = req.db;
    const now = new Date();
    const expiryYear = now.getFullYear() + 1;

    // Load all balances with policy carry-over config
    const balances = await db.query(`
      SELECT lb.*, ap.max_carry_over_days, ap.carry_over_expiry_months
      FROM leave_balances lb
      JOIN employees e ON e.id = lb.employee_id
      JOIN absence_policies ap ON ap.id = lb.policy_id
      WHERE e.status = 'active'
    `);

    let processed = 0;

    for (const bal of balances.rows) {
      const maxCarry    = bal.max_carry_over_days || 0;
      const carryOver   = Math.min(bal.balance_days || 0, maxCarry);
      const expiryMonths = bal.carry_over_expiry_months || 3;
      const expiresAt   = new Date(expiryYear, now.getMonth() + expiryMonths, 1)
                            .toISOString().slice(0, 10);

      await db.query(`
        UPDATE leave_balances SET
          carry_over_days = $1,
          expires_at      = $2,
          balance_days    = 0,
          accrued_days    = 0,
          pending_days    = 0,
          updated_at      = NOW()
        WHERE id = $3
      `, [carryOver, expiresAt, bal.id]);

      processed++;
    }

    res.json({ message: 'Carry-over complete', records_updated: processed });
  } catch (err) {
    console.error('[leave-balances/carry-over]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/leave-balances/:id ────────────────────────────────────────────────
// Admin manual adjustment
router.put('/:id', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const db = req.db;
    const { balance_days, carry_over_days, pending_days, notes } = req.body;

    const result = await db.query(`
      UPDATE leave_balances SET
        balance_days    = COALESCE($2, balance_days),
        carry_over_days = COALESCE($3, carry_over_days),
        pending_days    = COALESCE($4, pending_days),
        notes           = COALESCE($5, notes),
        updated_at      = NOW()
      WHERE id = $1
      RETURNING *
    `, [
      req.params.id,
      balance_days    !== undefined ? parseFloat(balance_days)    : null,
      carry_over_days !== undefined ? parseFloat(carry_over_days) : null,
      pending_days    !== undefined ? parseFloat(pending_days)    : null,
      notes || null,
    ]);

    if (!result.rows.length) return res.status(404).json({ error: 'Balance record not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[leave-balances PUT]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

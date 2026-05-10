/**
 * Expenses API — Consulting expense tracking & approval
 *
 * Routes:
 *   GET    /api/expenses                  — list expenses (admin: all, candidate: own)
 *   GET    /api/expenses/:id              — single expense
 *   POST   /api/expenses                  — create expense
 *   PUT    /api/expenses/:id              — update expense (pending only)
 *   DELETE /api/expenses/:id              — delete expense (pending only)
 *   POST   /api/expenses/:id/approve      — approve (admin)
 *   POST   /api/expenses/:id/reject       — reject with reason (admin)
 *   GET    /api/expenses/summary          — totals by category/status for dashboard
 */

const express = require('express');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');

const router = express.Router();

const VALID_CATEGORIES = [
  'travel', 'mileage', 'per_diem', 'software',
  'hardware', 'meals', 'accommodation', 'other'
];

function clean(v) { return v === undefined ? null : (v === '' ? null : v); }
function cleanNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}
function cleanInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function computeAmount(row) {
  if (row.category === 'mileage' && row.mileage_miles) {
    return parseFloat(row.mileage_miles) * parseFloat(row.mileage_rate || 0.67);
  }
  return parseFloat(row.amount || 0);
}

// GET /api/expenses/summary  — MUST come before /:id
router.get('/summary', authenticate, injectTenantDb, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const candidateFilter = isAdmin ? '' : `AND e.candidate_id = ${req.user.employeeId}`;

    const result = await req.db.query(`
      SELECT
        e.status,
        e.category,
        COUNT(*)                                                              AS count,
        COALESCE(SUM(CASE WHEN e.category = 'mileage'
                          THEN e.mileage_miles * COALESCE(e.mileage_rate, 0.67)
                          ELSE COALESCE(e.amount, 0) END), 0)               AS total_amount,
        COALESCE(SUM(CASE WHEN e.is_billable AND e.category = 'mileage'
                          THEN e.mileage_miles * COALESCE(e.mileage_rate, 0.67)
                          WHEN e.is_billable THEN COALESCE(e.amount, 0)
                          ELSE 0 END), 0)                                   AS billable_amount
      FROM expenses e
      WHERE 1=1 ${candidateFilter}
      GROUP BY e.status, e.category
      ORDER BY e.status, e.category
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /expenses/summary', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/expenses
router.get('/', authenticate, injectTenantDb, async (req, res) => {
  try {
    const { status, project_id, candidate_id, from, to } = req.query;
    const isAdmin = req.user.role === 'admin';

    const params = [];
    const conditions = [];

    if (!isAdmin) {
      params.push(req.user.employeeId);
      conditions.push(`e.candidate_id = $${params.length}`);
    } else if (candidate_id) {
      params.push(parseInt(candidate_id, 10));
      conditions.push(`e.candidate_id = $${params.length}`);
    }

    if (status) {
      params.push(status);
      conditions.push(`e.status = $${params.length}`);
    }
    if (project_id) {
      params.push(parseInt(project_id, 10));
      conditions.push(`e.project_id = $${params.length}`);
    }
    if (from) {
      params.push(from);
      conditions.push(`e.expense_date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`e.expense_date <= $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await req.db.query(`
      SELECT e.*,
             ca.name  AS employee_name,
             cl.name  AS client_name,
             pr.name  AS project_name,
             pt.name  AS task_name,
             u.name   AS approved_by_name
      FROM expenses e
      LEFT JOIN employees ca ON ca.id = e.candidate_id
      LEFT JOIN clients    cl ON cl.id = e.client_id
      LEFT JOIN projects   pr ON pr.id = e.project_id
      LEFT JOIN project_tasks pt ON pt.id = e.task_id
      LEFT JOIN users       u ON u.id = e.approved_by
      ${whereClause}
      ORDER BY e.expense_date DESC, e.created_at DESC
    `, params);

    res.json(result.rows);
  } catch (err) {
    console.error('GET /expenses', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/expenses/:id
router.get('/:id', authenticate, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid expense ID' });

    const result = await req.db.query(`
      SELECT e.*,
             ca.name AS employee_name,
             cl.name AS client_name,
             pr.name AS project_name,
             pt.name AS task_name,
             u.name  AS approved_by_name
      FROM expenses e
      LEFT JOIN employees ca ON ca.id = e.candidate_id
      LEFT JOIN clients    cl ON cl.id = e.client_id
      LEFT JOIN projects   pr ON pr.id = e.project_id
      LEFT JOIN project_tasks pt ON pt.id = e.task_id
      LEFT JOIN users       u ON u.id = e.approved_by
      WHERE e.id = $1
    `, [id]);

    const expense = result.rows[0];
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    if (req.user.role !== 'admin' && expense.candidate_id !== req.user.employeeId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(expense);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/expenses
router.post('/', authenticate, injectTenantDb, async (req, res) => {
  try {
    const {
      candidate_id, client_id, project_id, task_id,
      expense_date, category, description, amount,
      mileage_miles, mileage_rate, currency,
      is_billable, is_reimbursable, receipt_url, notes
    } = req.body;

    // Determine candidate: admins can specify, others only themselves
    let employeeId;
    if (req.user.role === 'admin') {
      employeeId = cleanInt(candidate_id);
      if (!employeeId) return res.status(400).json({ error: 'candidate_id is required' });
    } else {
      employeeId = req.user.employeeId;
      if (!employeeId) return res.status(403).json({ error: 'No candidate profile found' });
    }

    if (!expense_date) return res.status(400).json({ error: 'expense_date is required' });
    if (!category || !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
    }
    if (!description) return res.status(400).json({ error: 'description is required' });
    if (category === 'mileage') {
      if (!mileage_miles) return res.status(400).json({ error: 'mileage_miles required for mileage expenses' });
    } else {
      if (!amount) return res.status(400).json({ error: 'amount is required' });
    }

    const result = await req.db.query(`
      INSERT INTO expenses (
        candidate_id, client_id, project_id, task_id,
        expense_date, category, description, amount,
        mileage_miles, mileage_rate, currency,
        is_billable, is_reimbursable, receipt_url, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *
    `, [
      employeeId, cleanInt(client_id), cleanInt(project_id), cleanInt(task_id),
      expense_date, category, description.trim(), cleanNum(amount),
      cleanNum(mileage_miles), cleanNum(mileage_rate) || 0.67,
      currency || 'USD',
      is_billable !== false, is_reimbursable !== false,
      clean(receipt_url), clean(notes)
    ]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /expenses', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/expenses/:id
router.put('/:id', authenticate, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid expense ID' });

    // Check ownership
    const existing = await req.db.query('SELECT * FROM expenses WHERE id = $1', [id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Expense not found' });
    const exp = existing.rows[0];

    if (req.user.role !== 'admin' && exp.candidate_id !== req.user.employeeId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (exp.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending expenses can be edited' });
    }

    const {
      client_id, project_id, task_id, expense_date, category, description,
      amount, mileage_miles, mileage_rate, currency,
      is_billable, is_reimbursable, receipt_url, notes
    } = req.body;

    const result = await req.db.query(`
      UPDATE expenses SET
        client_id       = $1,
        project_id      = $2,
        task_id         = $3,
        expense_date    = COALESCE($4, expense_date),
        category        = COALESCE($5, category),
        description     = COALESCE($6, description),
        amount          = $7,
        mileage_miles   = $8,
        mileage_rate    = COALESCE($9, mileage_rate),
        currency        = COALESCE($10, currency),
        is_billable     = COALESCE($11, is_billable),
        is_reimbursable = COALESCE($12, is_reimbursable),
        receipt_url     = $13,
        notes           = $14,
        updated_at      = NOW()
      WHERE id = $15
      RETURNING *
    `, [
      cleanInt(client_id), cleanInt(project_id), cleanInt(task_id),
      clean(expense_date), clean(category), description ? description.trim() : null,
      cleanNum(amount), cleanNum(mileage_miles), cleanNum(mileage_rate),
      clean(currency),
      is_billable !== undefined ? is_billable : null,
      is_reimbursable !== undefined ? is_reimbursable : null,
      clean(receipt_url), clean(notes),
      id
    ]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /expenses/:id', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/expenses/:id
router.delete('/:id', authenticate, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid expense ID' });

    const existing = await req.db.query('SELECT * FROM expenses WHERE id = $1', [id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Expense not found' });

    if (req.user.role !== 'admin' && existing.rows[0].candidate_id !== req.user.employeeId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (existing.rows[0].status !== 'pending') {
      return res.status(400).json({ error: 'Only pending expenses can be deleted' });
    }

    await req.db.query('DELETE FROM expenses WHERE id = $1', [id]);
    res.json({ message: 'Expense deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/expenses/:id/approve
router.post('/:id/approve', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid expense ID' });

    const result = await req.db.query(`
      UPDATE expenses SET
        status = 'approved',
        approved_by = $1,
        approved_at = NOW(),
        rejected_reason = NULL,
        updated_at = NOW()
      WHERE id = $2 AND status = 'pending'
      RETURNING *
    `, [req.user.id, id]);

    if (!result.rows[0]) return res.status(404).json({ error: 'Expense not found or not pending' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/expenses/:id/reject
router.post('/:id/reject', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid expense ID' });

    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Rejection reason is required' });

    const result = await req.db.query(`
      UPDATE expenses SET
        status = 'rejected',
        approved_by = $1,
        approved_at = NOW(),
        rejected_reason = $2,
        updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [req.user.id, reason, id]);

    if (!result.rows[0]) return res.status(404).json({ error: 'Expense not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

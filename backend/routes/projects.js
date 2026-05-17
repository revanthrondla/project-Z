/**
 * Projects API — Consulting/Professional Services
 *
 * Routes:
 *   GET    /api/projects                        — list all (admin) or assigned (client/candidate)
 *   GET    /api/projects/:id                    — project detail + tasks + budget summary
 *   POST   /api/projects                        — create project (admin)
 *   PUT    /api/projects/:id                    — update project (admin)
 *   DELETE /api/projects/:id                    — soft-delete (admin)
 *   GET    /api/projects/:id/tasks              — list tasks for project
 *   POST   /api/projects/:id/tasks              — add task
 *   PUT    /api/projects/:id/tasks/:tid         — update task
 *   DELETE /api/projects/:id/tasks/:tid         — delete task
 *   GET    /api/projects/:id/utilization        — utilization & profitability stats
 *   GET    /api/projects/:id/unbilled           — unbilled approved time + expenses
 */

const express = require('express');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');

const router = express.Router();

// ─── Helper ────────────────────────────────────────────────────────────────

function clean(v) { return v === undefined ? null : v; }
function cleanNum(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}
function cleanInt(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

// ─── Project CRUD ──────────────────────────────────────────────────────────

// GET /api/projects
router.get('/', authenticate, injectTenantDb, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'admin') {
      const result = await req.db.query(`
        SELECT p.*,
               c.name AS client_name,
               u.name AS project_manager_name,
               COUNT(DISTINCT pt.id) AS task_count,
               COALESCE(SUM(te.hours) FILTER (WHERE te.status = 'approved'), 0) AS actual_hours,
               COALESCE(SUM(te.hours) FILTER (WHERE te.is_billable AND te.status = 'approved'), 0) AS billed_hours
        FROM projects p
        LEFT JOIN clients c ON c.id = p.client_id
        LEFT JOIN users u ON u.id = p.project_manager_id
        LEFT JOIN project_tasks pt ON pt.project_id = p.id
        LEFT JOIN time_entries te ON te.project_id = p.id
        WHERE p.status != 'cancelled'
        GROUP BY p.id, c.name, u.name
        ORDER BY p.created_at DESC
      `);
      rows = result.rows;
    } else if (req.user.role === 'client') {
      const result = await req.db.query(`
        SELECT p.id, p.name, p.code, p.status, p.billing_model,
               p.budget_hours, p.budget_amount, p.contract_start, p.contract_end,
               COALESCE(SUM(te.hours) FILTER (WHERE te.status = 'approved' AND te.is_billable), 0) AS billed_hours
        FROM projects p
        LEFT JOIN time_entries te ON te.project_id = p.id
        WHERE p.client_id = $1 AND p.status != 'cancelled'
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `, [req.user.clientId]);
      rows = result.rows;
    } else {
      // candidate — projects where they have time entries or are assigned
      const result = await req.db.query(`
        SELECT DISTINCT p.id, p.name, p.code, p.status, p.billing_model,
               c.name AS client_name
        FROM projects p
        LEFT JOIN clients c ON c.id = p.client_id
        INNER JOIN time_entries te ON te.project_id = p.id AND te.candidate_id = $1
        WHERE p.status = 'active'
        ORDER BY p.name
      `, [req.user.employeeId]);
      rows = result.rows;
    }
    res.json(rows);
  } catch (err) {
    console.error('GET /projects', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:id
router.get('/:id', authenticate, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid project ID' });

    const projectResult = await req.db.query(`
      SELECT p.*,
             c.name AS client_name, c.billing_currency,
             u.name AS project_manager_name,
             COALESCE(SUM(te.hours) FILTER (WHERE te.status = 'approved'), 0)           AS actual_hours,
             COALESCE(SUM(te.hours) FILTER (WHERE te.status = 'approved' AND te.is_billable), 0) AS billable_hours,
             COALESCE(SUM(te.hours) FILTER (WHERE te.status = 'pending'), 0)             AS pending_hours,
             COALESCE(COUNT(DISTINCT te.candidate_id) FILTER (WHERE te.status = 'approved'), 0) AS active_members
      FROM projects p
      LEFT JOIN clients c ON c.id = p.client_id
      LEFT JOIN users u ON u.id = p.project_manager_id
      LEFT JOIN time_entries te ON te.project_id = p.id
      WHERE p.id = $1
      GROUP BY p.id, c.name, c.billing_currency, u.name
    `, [id]);

    if (!projectResult.rows[0]) return res.status(404).json({ error: 'Project not found' });

    // client access check
    if (req.user.role === 'client' && projectResult.rows[0].client_id !== req.user.clientId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const tasksResult = await req.db.query(
      'SELECT * FROM project_tasks WHERE project_id = $1 ORDER BY sort_order, id',
      [id]
    );

    res.json({ ...projectResult.rows[0], tasks: tasksResult.rows });
  } catch (err) {
    console.error('GET /projects/:id', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects
router.post('/', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const {
      client_id, name, code, description, billing_model,
      budget_hours, budget_amount, retainer_amount, retainer_period,
      po_number, contract_start, contract_end, project_manager_id,
      status, tags, notes
    } = req.body;

    if (!client_id || !name) {
      return res.status(400).json({ error: 'client_id and name are required' });
    }

    const result = await req.db.query(`
      INSERT INTO projects (
        client_id, name, code, description, billing_model,
        budget_hours, budget_amount, retainer_amount, retainer_period,
        po_number, contract_start, contract_end, project_manager_id,
        status, tags, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *
    `, [
      cleanInt(client_id), name.trim(), clean(code), clean(description),
      billing_model || 'hourly',
      cleanNum(budget_hours), cleanNum(budget_amount),
      cleanNum(retainer_amount), retainer_period || 'monthly',
      clean(po_number), clean(contract_start) || null, clean(contract_end) || null,
      cleanInt(project_manager_id),
      status || 'active', clean(tags), clean(notes)
    ]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /projects', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/projects/:id
router.put('/:id', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid project ID' });

    const {
      client_id, name, code, description, billing_model,
      budget_hours, budget_amount, retainer_amount, retainer_period,
      po_number, contract_start, contract_end, project_manager_id,
      status, tags, notes
    } = req.body;

    const result = await req.db.query(`
      UPDATE projects SET
        client_id = COALESCE($1, client_id),
        name = COALESCE($2, name),
        code = $3,
        description = $4,
        billing_model = COALESCE($5, billing_model),
        budget_hours = $6,
        budget_amount = $7,
        retainer_amount = $8,
        retainer_period = COALESCE($9, retainer_period),
        po_number = $10,
        contract_start = $11,
        contract_end = $12,
        project_manager_id = $13,
        status = COALESCE($14, status),
        tags = $15,
        notes = $16,
        updated_at = NOW()
      WHERE id = $17
      RETURNING *
    `, [
      cleanInt(client_id), name ? name.trim() : null,
      clean(code), clean(description),
      billing_model || null,
      cleanNum(budget_hours), cleanNum(budget_amount),
      cleanNum(retainer_amount), retainer_period || null,
      clean(po_number),
      contract_start ? contract_start : null,
      contract_end ? contract_end : null,
      cleanInt(project_manager_id),
      status || null, clean(tags), clean(notes),
      id
    ]);

    if (!result.rows[0]) return res.status(404).json({ error: 'Project not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /projects/:id', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/projects/:id — soft delete (mark cancelled)
router.delete('/:id', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid project ID' });

    const result = await req.db.query(
      `UPDATE projects SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Project not found' });
    res.json({ message: 'Project cancelled', id });
  } catch (err) {
    console.error('DELETE /projects/:id', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Project Tasks ─────────────────────────────────────────────────────────

// GET /api/projects/:id/tasks
router.get('/:id/tasks', authenticate, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = await req.db.query(
      'SELECT * FROM project_tasks WHERE project_id = $1 ORDER BY sort_order, id',
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/tasks
router.post('/:id/tasks', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const project_id = parseInt(req.params.id, 10);
    const { name, description, estimated_hours, is_billable, sort_order } = req.body;
    if (!name) return res.status(400).json({ error: 'Task name is required' });

    const result = await req.db.query(`
      INSERT INTO project_tasks (project_id, name, description, estimated_hours, is_billable, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [
      project_id, name.trim(), clean(description),
      cleanNum(estimated_hours), is_billable !== false,
      cleanInt(sort_order) || 0
    ]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/projects/:id/tasks/:tid
router.put('/:id/tasks/:tid', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const tid = parseInt(req.params.tid, 10);
    const { name, description, estimated_hours, is_billable, status, sort_order } = req.body;

    const result = await req.db.query(`
      UPDATE project_tasks SET
        name = COALESCE($1, name),
        description = $2,
        estimated_hours = $3,
        is_billable = COALESCE($4, is_billable),
        status = COALESCE($5, status),
        sort_order = COALESCE($6, sort_order)
      WHERE id = $7 AND project_id = $8
      RETURNING *
    `, [
      name ? name.trim() : null,
      clean(description), cleanNum(estimated_hours),
      is_billable !== undefined ? is_billable : null,
      clean(status), cleanInt(sort_order),
      tid, parseInt(req.params.id, 10)
    ]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Task not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/projects/:id/tasks/:tid
router.delete('/:id/tasks/:tid', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const tid = parseInt(req.params.tid, 10);
    await req.db.query(
      'DELETE FROM project_tasks WHERE id = $1 AND project_id = $2',
      [tid, parseInt(req.params.id, 10)]
    );
    res.json({ message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Utilization & Profitability ───────────────────────────────────────────

// GET /api/projects/:id/utilization
router.get('/:id/utilization', authenticate, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid project ID' });

    // Project info + task estimates
    const projResult = await req.db.query(`
      SELECT p.*,
             COALESCE(SUM(pt.estimated_hours), 0) AS estimated_hours
      FROM projects p
      LEFT JOIN project_tasks pt ON pt.project_id = p.id AND pt.status != 'cancelled'
      WHERE p.id = $1
      GROUP BY p.id
    `, [id]);
    const project = projResult.rows[0];
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Time summary
    const timeResult = await req.db.query(`
      SELECT
        COALESCE(SUM(hours), 0)                                          AS total_hours,
        COALESCE(SUM(hours) FILTER (WHERE is_billable = TRUE), 0)       AS billable_hours,
        COALESCE(SUM(hours) FILTER (WHERE is_billable = FALSE), 0)      AS non_billable_hours,
        COALESCE(SUM(hours) FILTER (WHERE status = 'approved'), 0)       AS approved_hours,
        COALESCE(SUM(hours) FILTER (WHERE status = 'approved' AND is_billable = TRUE), 0) AS approved_billable_hours,
        COALESCE(SUM(hours) FILTER (WHERE status = 'pending'), 0)        AS pending_hours,
        COUNT(DISTINCT candidate_id)                                      AS unique_people
      FROM time_entries
      WHERE project_id = $1
    `, [id]);

    // Per-person breakdown
    const peopleResult = await req.db.query(`
      SELECT ca.name, ca.role, ca.target_utilization,
             COALESCE(SUM(te.hours), 0) AS total_hours,
             COALESCE(SUM(te.hours) FILTER (WHERE te.is_billable = TRUE AND te.status = 'approved'), 0) AS billable_hours,
             COALESCE(SUM(te.hours) FILTER (WHERE te.status = 'approved'), 0) AS approved_hours
      FROM time_entries te
      JOIN employees ca ON ca.id = te.candidate_id
      WHERE te.project_id = $1
      GROUP BY ca.id, ca.name, ca.role, ca.target_utilization
      ORDER BY billable_hours DESC
    `, [id]);

    // Rate card for billing amount calculation
    const rateResult = await req.db.query(`
      SELECT DISTINCT ON (rc.candidate_id)
             rc.candidate_id, rc.bill_rate, rc.cost_rate
      FROM rate_cards rc
      WHERE rc.project_id = $1
        AND (rc.effective_to IS NULL OR rc.effective_to >= CURRENT_DATE)
      ORDER BY rc.candidate_id, rc.effective_from DESC
    `, [id]);
    const rateMap = {};
    rateResult.rows.forEach(r => { rateMap[r.candidate_id] = r; });

    // Invoice totals for this project
    const invoiceResult = await req.db.query(`
      SELECT
        COALESCE(SUM(total_amount) FILTER (WHERE status NOT IN ('cancelled')), 0) AS invoiced_total,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'paid'), 0)             AS paid_total,
        COALESCE(SUM(total_amount) FILTER (WHERE status IN ('sent','approved','client_approved','overdue')), 0) AS outstanding_total
      FROM invoices
      WHERE project_id = $1
    `, [id]);

    // Expense totals
    const expResult = await req.db.query(`
      SELECT
        COALESCE(SUM(COALESCE(amount, mileage_miles * mileage_rate, 0)), 0)                               AS total_expenses,
        COALESCE(SUM(COALESCE(amount, mileage_miles * mileage_rate, 0)) FILTER (WHERE is_billable), 0)   AS billable_expenses
      FROM expenses
      WHERE project_id = $1 AND status != 'rejected'
    `, [id]);

    const t = timeResult.rows[0];
    const inv = invoiceResult.rows[0];
    const exp = expResult.rows[0];

    const billableHours = parseFloat(t.approved_billable_hours) || 0;
    const totalHours = parseFloat(t.total_hours) || 0;
    const utilization = totalHours > 0 ? Math.round((billableHours / totalHours) * 100) : 0;

    // Realization = revenue actually billed vs potential at standard rates
    const estimatedHours = parseFloat(project.estimated_hours) || parseFloat(project.budget_hours) || 0;
    const variance = estimatedHours > 0
      ? Math.round(((parseFloat(t.approved_hours) - estimatedHours) / estimatedHours) * 100)
      : null;

    res.json({
      project: {
        id: project.id,
        name: project.name,
        billing_model: project.billing_model,
        budget_hours: project.budget_hours,
        budget_amount: project.budget_amount,
        retainer_amount: project.retainer_amount,
        estimated_hours: project.estimated_hours,
        status: project.status,
        contract_start: project.contract_start,
        contract_end: project.contract_end
      },
      time: {
        total_hours: t.total_hours,
        billable_hours: t.billable_hours,
        non_billable_hours: t.non_billable_hours,
        approved_hours: t.approved_hours,
        approved_billable_hours: t.approved_billable_hours,
        pending_hours: t.pending_hours,
        unique_people: t.unique_people
      },
      billing: {
        invoiced_total: inv.invoiced_total,
        paid_total: inv.paid_total,
        outstanding_total: inv.outstanding_total,
        billable_expenses: exp.billable_expenses,
        total_expenses: exp.total_expenses
      },
      metrics: {
        utilization_pct: utilization,
        hours_variance_pct: variance,
        budget_hours_used_pct: project.budget_hours
          ? Math.round((parseFloat(t.approved_hours) / parseFloat(project.budget_hours)) * 100)
          : null,
        budget_amount_used_pct: project.budget_amount
          ? Math.round((parseFloat(inv.invoiced_total) / parseFloat(project.budget_amount)) * 100)
          : null
      },
      people: peopleResult.rows
    });
  } catch (err) {
    console.error('GET /projects/:id/utilization', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:id/unbilled — approved time not yet on an invoice
router.get('/:id/unbilled', authenticate, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid project ID' });

    // Time entries approved but not yet invoiced
    const timeResult = await req.db.query(`
      SELECT te.*, ca.name AS employee_name, ca.role AS candidate_role,
             pt.name AS task_name
      FROM time_entries te
      JOIN employees ca ON ca.id = te.candidate_id
      LEFT JOIN project_tasks pt ON pt.id = te.task_id
      WHERE te.project_id = $1
        AND te.status = 'approved'
        AND te.is_billable = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM invoice_line_items ili
          JOIN invoices inv ON inv.id = ili.invoice_id
          WHERE inv.project_id = te.project_id
            AND inv.status NOT IN ('draft','cancelled')
            AND ili.date = te.date
        )
      ORDER BY te.date
    `, [id]);

    // Approved expenses not yet invoiced
    const expResult = await req.db.query(`
      SELECT e.*, ca.name AS employee_name
      FROM expenses e
      JOIN employees ca ON ca.id = e.candidate_id
      WHERE e.project_id = $1
        AND e.is_billable = TRUE
        AND e.status = 'approved'
        AND e.invoice_id IS NULL
      ORDER BY e.expense_date
    `, [id]);

    const totalUnbilledHours = timeResult.rows.reduce((s, r) => s + parseFloat(r.hours || 0), 0);
    const totalUnbilledExpenses = expResult.rows.reduce((s, r) => {
      const amt = r.mileage_miles ? parseFloat(r.mileage_miles) * parseFloat(r.mileage_rate || 0.67) : parseFloat(r.amount || 0);
      return s + amt;
    }, 0);

    res.json({
      time_entries: timeResult.rows,
      expenses: expResult.rows,
      summary: {
        unbilled_hours: Math.round(totalUnbilledHours * 100) / 100,
        unbilled_expense_total: Math.round(totalUnbilledExpenses * 100) / 100,
        time_entry_count: timeResult.rows.length,
        expense_count: expResult.rows.length
      }
    });
  } catch (err) {
    console.error('GET /projects/:id/unbilled', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Budget Alert ──────────────────────────────────────────────────────────
// GET /api/projects/:id/budget-status
// Returns current budget consumption % + whether alert threshold has been crossed
router.get('/:id/budget-status', authenticate, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid project ID' });

    const projectResult = await req.db.query(
      'SELECT id, name, budget_hours, budget_amount, billing_model, budget_alert_threshold, budget_alert_pct FROM projects WHERE id = $1',
      [id]
    );
    if (!projectResult.rows[0]) return res.status(404).json({ error: 'Project not found' });
    const p = projectResult.rows[0];

    // Compute actual approved hours / amounts
    const hoursResult = await req.db.query(
      `SELECT COALESCE(SUM(hours), 0) AS actual_hours,
              COALESCE(SUM(CASE WHEN is_billable THEN hours ELSE 0 END), 0) AS billable_hours
       FROM time_entries WHERE project_id = $1 AND status = 'approved'`,
      [id]
    );
    const { actual_hours, billable_hours } = hoursResult.rows[0];

    let consumedPct = 0;
    if (p.budget_hours && parseFloat(p.budget_hours) > 0) {
      consumedPct = Math.round((parseFloat(actual_hours) / parseFloat(p.budget_hours)) * 100);
    }

    const threshold  = p.budget_alert_threshold || 80;
    const alertState = consumedPct >= threshold ? 'alert' : consumedPct >= threshold - 10 ? 'warning' : 'ok';

    // Persist the computed pct for quick access on project list
    if (Math.abs(consumedPct - (p.budget_alert_pct || 0)) >= 1) {
      await req.db.query(
        `UPDATE projects SET budget_alert_pct = $1, budget_last_computed_at = NOW() WHERE id = $2`,
        [consumedPct, id]
      );
    }

    res.json({
      project_id: id,
      budget_hours: p.budget_hours,
      actual_hours: parseFloat(actual_hours),
      billable_hours: parseFloat(billable_hours),
      consumed_pct: consumedPct,
      threshold,
      alert_state: alertState,
      is_over_budget: consumedPct > 100,
    });
  } catch (err) {
    console.error('GET /projects/:id/budget-status', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/projects/:id/alert-threshold  — admin update threshold
router.put('/:id/alert-threshold', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { budget_alert_threshold } = req.body;
    const threshold = parseInt(budget_alert_threshold, 10);
    if (isNaN(threshold) || threshold < 1 || threshold > 100) {
      return res.status(400).json({ error: 'budget_alert_threshold must be 1–100' });
    }
    const result = await req.db.query(
      'UPDATE projects SET budget_alert_threshold = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [threshold, id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Project not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /projects/:id/alert-threshold', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

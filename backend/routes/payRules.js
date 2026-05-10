/**
 * Pay Rules Engine
 * GET    /api/pay-rules                 — list all rules
 * POST   /api/pay-rules                 — create rule
 * PUT    /api/pay-rules/:id             — update rule
 * DELETE /api/pay-rules/:id             — delete rule (not default)
 * GET    /api/pay-rules/default         — get the active default rule
 * POST   /api/pay-rules/calculate       — overtime + pay calculation for a set of time entries
 *
 * FLSA overtime: >40 hrs in a fixed 168-hr workweek at 1.5x regular rate.
 * Regular rate = total compensation / total hours (excluding statutory exclusions).
 */
const express = require('express');
const router  = express.Router();
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Apply time rounding to decimal hours per a rule's rounding policy.
 * 'none'            → no change
 * '6min'            → round to nearest 0.1 hr
 * '15min'           → round to nearest 0.25 hr
 * 'nearest_quarter' → same as 15min
 */
function applyRounding(hours, policy) {
  if (!policy || policy === 'none') return hours;
  if (policy === '6min')            return Math.round(hours * 10) / 10;
  if (policy === '15min' || policy === 'nearest_quarter') return Math.round(hours * 4) / 4;
  return hours;
}

/**
 * Calculate overtime pay for a workweek bucket.
 * @param {number} totalHours  — sum of hours in the workweek (after rounding)
 * @param {number} regularRate — USD/hr regular rate
 * @param {object} rule        — pay_rules row
 * @returns {{ regular_hours, ot_hours, dt_hours, regular_pay, ot_pay, dt_pay, gross_pay, warnings[] }}
 */
function calcOvertimePay(totalHours, regularRate, rule) {
  const warnings = [];

  // Minimum wage check
  if (regularRate < rule.minimum_wage) {
    warnings.push(`Rate $${regularRate.toFixed(2)}/hr is below minimum wage $${rule.minimum_wage.toFixed(2)}/hr`);
  }

  const weeklyOT = Number(rule.weekly_ot_threshold ?? 40);
  const dtThresh = rule.double_time_threshold ? Number(rule.double_time_threshold) : null;
  const otMult   = Number(rule.ot_multiplier  ?? 1.5);
  const dtMult   = Number(rule.dt_multiplier  ?? 2.0);

  let regularHours = 0, otHours = 0, dtHours = 0;

  if (dtThresh && totalHours > dtThresh) {
    regularHours = Math.min(totalHours, weeklyOT);
    otHours      = dtThresh - weeklyOT;
    dtHours      = totalHours - dtThresh;
  } else if (totalHours > weeklyOT) {
    regularHours = weeklyOT;
    otHours      = totalHours - weeklyOT;
  } else {
    regularHours = totalHours;
  }

  const regularPay = regularHours * regularRate;
  const otPay      = otHours      * regularRate * otMult;
  const dtPay      = dtHours      * regularRate * dtMult;
  const grossPay   = regularPay + otPay + dtPay;

  return {
    regular_hours: Math.round(regularHours * 100) / 100,
    ot_hours:      Math.round(otHours * 100) / 100,
    dt_hours:      Math.round(dtHours * 100) / 100,
    regular_pay:   Math.round(regularPay * 100) / 100,
    ot_pay:        Math.round(otPay * 100) / 100,
    dt_pay:        Math.round(dtPay * 100) / 100,
    gross_pay:     Math.round(grossPay * 100) / 100,
    warnings,
  };
}

// ─── Workweek bucketing ──────────────────────────────────────────────────────

const DAY_INDEX = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };

/**
 * Given a date string (YYYY-MM-DD) and workweek_start day name,
 * return the ISO string of the Monday-equivalent start of that workweek.
 */
function getWorkweekStart(dateStr, weekStartDay) {
  const date  = new Date(dateStr + 'T12:00:00Z');
  const dayOfWeek = date.getUTCDay(); // 0=Sun
  const startIdx  = DAY_INDEX[weekStartDay] ?? 1;
  let diff = dayOfWeek - startIdx;
  if (diff < 0) diff += 7;
  const wkStart = new Date(date);
  wkStart.setUTCDate(date.getUTCDate() - diff);
  return wkStart.toISOString().slice(0, 10);
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/pay-rules
router.get('/', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const result = await req.db.query(
      `SELECT pr.*, ol.name AS location_name
       FROM pay_rules pr
       LEFT JOIN org_locations ol ON ol.id = pr.location_id
       ORDER BY pr.is_default DESC, pr.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[pay-rules GET /]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pay-rules/default
router.get('/default', authenticate, injectTenantDb, async (req, res) => {
  try {
    const result = await req.db.query(
      `SELECT * FROM pay_rules WHERE is_default = TRUE LIMIT 1`
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No default pay rule configured' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[pay-rules GET /default]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pay-rules
router.post('/', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const {
      name, is_default, workweek_start, daily_ot_threshold, weekly_ot_threshold,
      double_time_threshold, ot_multiplier, dt_multiplier, minimum_wage,
      time_rounding, break_threshold_hours, break_duration_min, paid_breaks,
      location_id, notes,
    } = req.body;

    if (!name) return res.status(400).json({ error: 'name is required' });

    // If setting as default, clear existing default
    if (is_default) {
      await req.db.query(`UPDATE pay_rules SET is_default = FALSE WHERE is_default = TRUE`);
    }

    const result = await req.db.query(`
      INSERT INTO pay_rules (
        name, is_default, workweek_start, daily_ot_threshold, weekly_ot_threshold,
        double_time_threshold, ot_multiplier, dt_multiplier, minimum_wage,
        time_rounding, break_threshold_hours, break_duration_min, paid_breaks,
        location_id, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *
    `, [
      name,
      is_default ?? false,
      workweek_start ?? 'monday',
      daily_ot_threshold   || null,
      weekly_ot_threshold  ?? 40,
      double_time_threshold || null,
      ot_multiplier ?? 1.5,
      dt_multiplier ?? 2.0,
      minimum_wage  ?? 7.25,
      time_rounding ?? 'none',
      break_threshold_hours ?? 6,
      break_duration_min    ?? 30,
      paid_breaks   ?? false,
      location_id   || null,
      notes         || null,
    ]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[pay-rules POST /]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/pay-rules/:id
router.put('/:id', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const { id } = req.params;
    const fields = [
      'name','is_default','workweek_start','daily_ot_threshold','weekly_ot_threshold',
      'double_time_threshold','ot_multiplier','dt_multiplier','minimum_wage',
      'time_rounding','break_threshold_hours','break_duration_min','paid_breaks',
      'location_id','notes',
    ];
    const params = [];
    const sets   = [];

    for (const f of fields) {
      if (req.body[f] !== undefined) {
        params.push(req.body[f]);
        sets.push(`${f} = $${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    if (req.body.is_default === true) {
      await req.db.query(`UPDATE pay_rules SET is_default = FALSE WHERE is_default = TRUE AND id != $1`, [id]);
    }

    params.push(id);
    sets.push(`updated_at = NOW()`);
    const result = await req.db.query(
      `UPDATE pay_rules SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Pay rule not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[pay-rules PUT /:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pay-rules/:id
router.delete('/:id', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const { id } = req.params;
    const rule = await req.db.query(`SELECT * FROM pay_rules WHERE id = $1`, [id]);
    if (!rule.rows.length) return res.status(404).json({ error: 'Not found' });
    if (rule.rows[0].is_default) return res.status(400).json({ error: 'Cannot delete the default pay rule' });
    await req.db.query(`DELETE FROM pay_rules WHERE id = $1`, [id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('[pay-rules DELETE /:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pay-rules/calculate
// Body: { candidate_id, start_date, end_date }
// Returns workweek-by-workweek overtime breakdown
router.post('/calculate', authenticate, injectTenantDb, async (req, res) => {
  try {
    const { candidate_id, start_date, end_date } = req.body;
    if (!candidate_id || !start_date || !end_date) {
      return res.status(400).json({ error: 'candidate_id, start_date, end_date required' });
    }

    // Get candidate + their assigned pay rule (or default)
    const candResult = await req.db.query(`
      SELECT c.*, pr.*,
             pr.id AS rule_id, pr.name AS rule_name,
             c.hourly_rate AS pay_rate
      FROM employees c
      LEFT JOIN pay_rules pr ON pr.id = COALESCE(c.pay_rule_id,
        (SELECT id FROM pay_rules WHERE is_default = TRUE LIMIT 1))
      WHERE c.id = $1
    `, [parseInt(candidate_id, 10)]);

    if (!candResult.rows.length) return res.status(404).json({ error: 'Candidate not found' });
    const cand = candResult.rows[0];

    // If no pay rule, grab default directly
    let rule = cand;
    if (!rule.weekly_ot_threshold) {
      const defRule = await req.db.query(`SELECT * FROM pay_rules WHERE is_default = TRUE LIMIT 1`);
      rule = defRule.rows[0] ?? { weekly_ot_threshold: 40, ot_multiplier: 1.5, minimum_wage: 7.25, time_rounding: 'none', workweek_start: 'monday' };
    }

    // Fetch approved time entries in range
    const teResult = await req.db.query(`
      SELECT te.id, te.date, te.hours, te.description, te.project_id, p.name AS project_name
      FROM time_entries te
      LEFT JOIN projects p ON p.id = te.project_id
      WHERE te.candidate_id = $1 AND te.date BETWEEN $2 AND $3 AND te.status = 'approved'
      ORDER BY te.date
    `, [parseInt(candidate_id, 10), start_date, end_date]);

    // Bucket by workweek
    const workweeks = {};
    for (const te of teResult.rows) {
      const wkKey = getWorkweekStart(te.date, rule.workweek_start ?? 'monday');
      if (!workweeks[wkKey]) workweeks[wkKey] = { entries: [], total_hours: 0 };
      const hrs = applyRounding(Number(te.hours), rule.time_rounding);
      workweeks[wkKey].entries.push({ ...te, rounded_hours: hrs });
      workweeks[wkKey].total_hours += hrs;
    }

    const payRate = Number(cand.hourly_rate ?? cand.pay_rate ?? 0);
    const breakdown = [];
    let grandTotal = { regular_hours: 0, ot_hours: 0, dt_hours: 0, regular_pay: 0, ot_pay: 0, dt_pay: 0, gross_pay: 0 };

    for (const [wkStart, wk] of Object.entries(workweeks).sort()) {
      const calc = calcOvertimePay(wk.total_hours, payRate, rule);
      breakdown.push({
        workweek_start: wkStart,
        entries:        wk.entries,
        ...calc,
      });
      grandTotal.regular_hours += calc.regular_hours;
      grandTotal.ot_hours      += calc.ot_hours;
      grandTotal.dt_hours      += calc.dt_hours;
      grandTotal.regular_pay   += calc.regular_pay;
      grandTotal.ot_pay        += calc.ot_pay;
      grandTotal.dt_pay        += calc.dt_pay;
      grandTotal.gross_pay     += calc.gross_pay;
    }

    // Round grand totals
    for (const k of Object.keys(grandTotal)) grandTotal[k] = Math.round(grandTotal[k] * 100) / 100;

    res.json({
      candidate: { id: cand.id, name: cand.name, hourly_rate: payRate },
      rule:      { id: rule.rule_id ?? rule.id, name: rule.rule_name ?? rule.name },
      period:    { start_date, end_date },
      breakdown,
      totals:    grandTotal,
    });
  } catch (err) {
    console.error('[pay-rules POST /calculate]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

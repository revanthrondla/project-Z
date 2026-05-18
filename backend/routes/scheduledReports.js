/**
 * Scheduled Reports — CRUD + manual trigger
 *
 * Routes
 *   GET    /api/scheduled-reports          list all for tenant
 *   POST   /api/scheduled-reports          create
 *   PUT    /api/scheduled-reports/:id      update
 *   DELETE /api/scheduled-reports/:id      delete
 *   POST   /api/scheduled-reports/:id/run  manual trigger (send now)
 */

const express  = require('express');
const router   = express.Router();
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');

/* ── auth gate ── */
router.use(authenticate, requireAdmin, injectTenantDb);

/* ─── helpers ──────────────────────────────────────────────────────────── */
/**
 * Compute next_run_at from frequency + day settings.
 * Returns a Date object.
 */
function computeNextRun(frequency, dayOfWeek, dayOfMonth) {
  const now = new Date();
  let next  = new Date(now);

  if (frequency === 'daily') {
    // Tomorrow at 07:00
    next.setDate(now.getDate() + 1);
    next.setHours(7, 0, 0, 0);
  } else if (frequency === 'weekly') {
    const dow = Number(dayOfWeek) || 1; // default Monday
    const diff = (dow - now.getDay() + 7) % 7 || 7;
    next.setDate(now.getDate() + diff);
    next.setHours(7, 0, 0, 0);
  } else if (frequency === 'monthly') {
    const dom = Number(dayOfMonth) || 1;
    next = new Date(now.getFullYear(), now.getMonth() + 1, dom, 7, 0, 0, 0);
    // If that day already passed this month, roll to next month
    if (next <= now) {
      next = new Date(now.getFullYear(), now.getMonth() + 2, dom, 7, 0, 0, 0);
    }
  }
  return next;
}

/* ─── Validation ────────────────────────────────────────────────────────── */
const VALID_TYPES  = ['hours','absences','revenue','utilization','labor_cost','payroll'];
const VALID_FREQ   = ['daily','weekly','monthly'];
const VALID_FMT    = ['csv','pdf'];
const VALID_PERIOD = ['last_period','last_week','last_month','last_quarter','last_year'];

function validate(body) {
  const errs = [];
  if (!body.name || !String(body.name).trim())          errs.push('name is required');
  if (!VALID_TYPES.includes(body.report_type))          errs.push('invalid report_type');
  if (!VALID_FREQ.includes(body.frequency))             errs.push('invalid frequency');
  if (!VALID_FMT.includes(body.format))                 errs.push('invalid format');
  if (!VALID_PERIOD.includes(body.period))              errs.push('invalid period');
  if (!Array.isArray(body.recipients) || !body.recipients.length)
    errs.push('recipients must be a non-empty array of emails');
  return errs;
}

/* ─── GET / ── list all ─────────────────────────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const result = await req.db.query(`
      SELECT sr.*, u.name AS created_by_name
      FROM   scheduled_reports sr
      LEFT JOIN users u ON sr.created_by = u.id
      ORDER  BY sr.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /scheduled-reports', err);
    res.status(500).json({ error: 'Failed to fetch scheduled reports' });
  }
});

/* ─── POST / ── create ──────────────────────────────────────────────────── */
router.post('/', async (req, res) => {
  const {
    name, report_type, frequency, day_of_week, day_of_month,
    recipients, format, period, is_active = true,
  } = req.body;

  const body = { name, report_type, frequency, day_of_week, day_of_month, recipients, format, period };
  const errs = validate(body);
  if (errs.length) return res.status(400).json({ error: errs.join('; ') });

  const nextRun = is_active ? computeNextRun(frequency, day_of_week, day_of_month) : null;

  try {
    const result = await req.db.query(`
      INSERT INTO scheduled_reports
        (name, report_type, frequency, day_of_week, day_of_month,
         recipients, format, period, is_active, next_run_at, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [
      String(name).trim(), report_type, frequency,
      day_of_week ?? null, day_of_month ?? null,
      recipients, format, period,
      Boolean(is_active), nextRun, req.user.id,
    ]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /scheduled-reports', err);
    res.status(500).json({ error: 'Failed to create scheduled report' });
  }
});

/* ─── PUT /:id ── update ────────────────────────────────────────────────── */
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });

  const {
    name, report_type, frequency, day_of_week, day_of_month,
    recipients, format, period, is_active,
  } = req.body;

  // Build partial-update clause
  const sets  = [];
  const vals  = [];
  let   idx   = 1;

  const push = (col, val) => { sets.push(`${col} = $${idx++}`); vals.push(val); };

  if (name        !== undefined) push('name',          String(name).trim());
  if (report_type !== undefined) push('report_type',   report_type);
  if (frequency   !== undefined) push('frequency',     frequency);
  if (day_of_week   !== undefined) push('day_of_week',   day_of_week);
  if (day_of_month  !== undefined) push('day_of_month',  day_of_month);
  if (recipients  !== undefined) push('recipients',    recipients);
  if (format      !== undefined) push('format',        format);
  if (period      !== undefined) push('period',        period);
  if (is_active   !== undefined) {
    push('is_active', Boolean(is_active));
    // recompute next_run only when re-activating
    if (is_active) {
      const freq = frequency || req.body._freq;
      push('next_run_at', computeNextRun(
        frequency || 'weekly',
        day_of_week,
        day_of_month,
      ));
    } else {
      push('next_run_at', null);
    }
  }
  push('updated_at', new Date());

  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

  vals.push(id);
  try {
    const result = await req.db.query(
      `UPDATE scheduled_reports SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals,
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /scheduled-reports/:id', err);
    res.status(500).json({ error: 'Failed to update scheduled report' });
  }
});

/* ─── DELETE /:id ── delete ─────────────────────────────────────────────── */
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  try {
    const result = await req.db.query(
      'DELETE FROM scheduled_reports WHERE id = $1 RETURNING id',
      [id],
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /scheduled-reports/:id', err);
    res.status(500).json({ error: 'Failed to delete scheduled report' });
  }
});

/* ─── POST /:id/run ── manual trigger ──────────────────────────────────── */
router.post('/:id/run', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rows } = await req.db.query(
      'SELECT * FROM scheduled_reports WHERE id = $1',
      [id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    const schedule = rows[0];
    // Fire-and-forget — sendScheduledReport is imported below
    const { sendScheduledReport } = require('../services/scheduledReportRunner');
    sendScheduledReport(req.db, schedule).catch(e => console.error('manual trigger error', e));

    res.json({ message: 'Report delivery triggered. Email will arrive shortly.' });
  } catch (err) {
    console.error('POST /scheduled-reports/:id/run', err);
    res.status(500).json({ error: 'Failed to trigger report' });
  }
});

module.exports = router;

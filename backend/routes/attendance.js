/**
 * Attendance — Clock-in / Clock-out
 *
 * GET  /api/attendance/status              — current clock state for the requesting user
 * POST /api/attendance/clock-in            — clock in (with optional GPS)
 * POST /api/attendance/clock-out           — clock out
 * POST /api/attendance/break-start         — start a break
 * POST /api/attendance/break-end           — end a break
 * GET  /api/attendance/live                — admin: who is currently clocked in
 * GET  /api/attendance/history             — paginated clock events (admin or own)
 * GET  /api/attendance/daily-summary       — daily attendance records (admin)
 * PUT  /api/attendance/daily/:id           — admin: correct a daily record
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

async function getLastEvent(db, employeeId) {
  const r = await db.query(
    `SELECT * FROM clock_events WHERE employee_id = $1 ORDER BY event_time DESC LIMIT 1`,
    [employeeId]
  );
  return r.rows[0] || null;
}

async function upsertDailySummary(db, employeeId, workDate) {
  const eventsRes = await db.query(
    `SELECT * FROM clock_events
     WHERE employee_id = $1 AND DATE(event_time) = $2
     ORDER BY event_time ASC`,
    [employeeId, workDate]
  );
  const events = eventsRes.rows;

  let clockIn = null, clockOut = null, breakMins = 0;
  let breakStart = null;

  for (const e of events) {
    if (e.event_type === 'clock_in' && !clockIn) clockIn = e.event_time;
    if (e.event_type === 'clock_out')              clockOut = e.event_time;
    if (e.event_type === 'break_start')            breakStart = e.event_time;
    if (e.event_type === 'break_end' && breakStart) {
      breakMins += Math.round((new Date(e.event_time) - new Date(breakStart)) / 60000);
      breakStart = null;
    }
  }

  let totalMins = null, netMins = null;
  if (clockIn && clockOut) {
    totalMins = Math.round((new Date(clockOut) - new Date(clockIn)) / 60000);
    netMins   = Math.max(0, totalMins - breakMins);
  } else if (clockIn) {
    totalMins = Math.round((Date.now() - new Date(clockIn)) / 60000);
    netMins   = Math.max(0, totalMins - breakMins);
  }

  const status = clockIn ? 'present' : 'absent';

  await db.query(
    `INSERT INTO attendance_daily
       (employee_id, work_date, clock_in_time, clock_out_time,
        total_minutes, break_minutes, net_minutes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (employee_id, work_date) DO UPDATE SET
       clock_in_time  = EXCLUDED.clock_in_time,
       clock_out_time = EXCLUDED.clock_out_time,
       total_minutes  = EXCLUDED.total_minutes,
       break_minutes  = EXCLUDED.break_minutes,
       net_minutes    = EXCLUDED.net_minutes,
       status         = EXCLUDED.status,
       updated_at     = NOW()`,
    [employeeId, workDate, clockIn, clockOut, totalMins, breakMins, netMins, status]
  );
}

// ── GET /api/attendance/status ─────────────────────────────────────────────────
router.get('/status', authenticate, injectTenantDb, async (req, res) => {
  try {
    const db = req.db;
    const employeeId = await getEmployeeIdForUser(db, req.user.id);
    if (!employeeId) return res.json({ clocked_in: false, on_break: false, last_event: null });

    const last = await getLastEvent(db, employeeId);
    const clocked_in = last?.event_type === 'clock_in' || last?.event_type === 'break_end';
    const on_break   = last?.event_type === 'break_start';

    const today = new Date().toISOString().slice(0, 10);
    const summaryRes = await db.query(
      `SELECT * FROM attendance_daily WHERE employee_id = $1 AND work_date = $2`,
      [employeeId, today]
    );

    res.json({
      clocked_in,
      on_break,
      last_event: last || null,
      today_summary: summaryRes.rows[0] || null,
      employee_id: employeeId,
    });
  } catch (err) {
    console.error('[attendance/status]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/attendance/clock-in ──────────────────────────────────────────────
router.post('/clock-in', authenticate, injectTenantDb, async (req, res) => {
  try {
    const db = req.db;
    const employeeId = await getEmployeeIdForUser(db, req.user.id);
    if (!employeeId) return res.status(404).json({ error: 'Employee record not found' });

    const last = await getLastEvent(db, employeeId);
    if (last?.event_type === 'clock_in' || last?.event_type === 'break_end') {
      return res.status(409).json({ error: 'Already clocked in' });
    }

    const { latitude, longitude, accuracy_m, location_name, notes } = req.body;

    const result = await db.query(
      `INSERT INTO clock_events
         (employee_id, event_type, latitude, longitude, accuracy_m, location_name, ip_address, notes)
       VALUES ($1,'clock_in',$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [employeeId, latitude||null, longitude||null, accuracy_m||null,
       location_name||null, req.ip, notes||null]
    );

    const today = new Date().toISOString().slice(0, 10);
    await upsertDailySummary(db, employeeId, today);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[attendance/clock-in]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/attendance/clock-out ─────────────────────────────────────────────
router.post('/clock-out', authenticate, injectTenantDb, async (req, res) => {
  try {
    const db = req.db;
    const employeeId = await getEmployeeIdForUser(db, req.user.id);
    if (!employeeId) return res.status(404).json({ error: 'Employee record not found' });

    const last = await getLastEvent(db, employeeId);
    if (!last || last.event_type === 'clock_out') {
      return res.status(409).json({ error: 'Not clocked in' });
    }

    const { latitude, longitude, accuracy_m, location_name, notes } = req.body;

    const result = await db.query(
      `INSERT INTO clock_events
         (employee_id, event_type, latitude, longitude, accuracy_m, location_name, ip_address, notes)
       VALUES ($1,'clock_out',$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [employeeId, latitude||null, longitude||null, accuracy_m||null,
       location_name||null, req.ip, notes||null]
    );

    const today = new Date().toISOString().slice(0, 10);
    await upsertDailySummary(db, employeeId, today);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[attendance/clock-out]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/attendance/break-start ──────────────────────────────────────────
router.post('/break-start', authenticate, injectTenantDb, async (req, res) => {
  try {
    const db = req.db;
    const employeeId = await getEmployeeIdForUser(db, req.user.id);
    if (!employeeId) return res.status(404).json({ error: 'Employee record not found' });

    const last = await getLastEvent(db, employeeId);
    if (!last || (last.event_type !== 'clock_in' && last.event_type !== 'break_end')) {
      return res.status(409).json({ error: 'Must be clocked in to start a break' });
    }

    const result = await db.query(
      `INSERT INTO clock_events (employee_id, event_type, ip_address, notes)
       VALUES ($1,'break_start',$2,$3) RETURNING *`,
      [employeeId, req.ip, req.body.notes||null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[attendance/break-start]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/attendance/break-end ────────────────────────────────────────────
router.post('/break-end', authenticate, injectTenantDb, async (req, res) => {
  try {
    const db = req.db;
    const employeeId = await getEmployeeIdForUser(db, req.user.id);
    if (!employeeId) return res.status(404).json({ error: 'Employee record not found' });

    const last = await getLastEvent(db, employeeId);
    if (last?.event_type !== 'break_start') {
      return res.status(409).json({ error: 'Not on a break' });
    }

    const result = await db.query(
      `INSERT INTO clock_events (employee_id, event_type, ip_address)
       VALUES ($1,'break_end',$2) RETURNING *`,
      [employeeId, req.ip]
    );

    const today = new Date().toISOString().slice(0, 10);
    await upsertDailySummary(db, employeeId, today);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[attendance/break-end]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/attendance/live  (admin) ─────────────────────────────────────────
router.get('/live', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const db = req.db;
    const today = new Date().toISOString().slice(0, 10);

    const result = await db.query(`
      SELECT
        e.id, e.name, e.email, e.role, e.avatar_url,
        ad.status, ad.clock_in_time, ad.clock_out_time,
        ad.total_minutes, ad.break_minutes, ad.net_minutes,
        (SELECT event_type FROM clock_events ce
         WHERE ce.employee_id = e.id ORDER BY event_time DESC LIMIT 1) AS last_event_type,
        (SELECT COUNT(*) FROM absences a
         WHERE a.candidate_id = e.id AND a.status = 'approved'
           AND a.start_date <= $1 AND a.end_date >= $1) AS on_leave_count
      FROM employees e
      LEFT JOIN attendance_daily ad ON ad.employee_id = e.id AND ad.work_date = $1
      WHERE e.status = 'active'
      ORDER BY e.name
    `, [today]);

    res.json(result.rows.map(r => ({
      ...r,
      live_status: parseInt(r.on_leave_count) > 0 ? 'on_leave'
                 : r.last_event_type === 'clock_in'    ? 'clocked_in'
                 : r.last_event_type === 'break_start' ? 'on_break'
                 : r.last_event_type === 'break_end'   ? 'clocked_in'
                 : r.last_event_type === 'clock_out'   ? 'clocked_out'
                 : 'not_started',
    })));
  } catch (err) {
    console.error('[attendance/live]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/attendance/daily-summary  (admin) ────────────────────────────────
router.get('/daily-summary', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const db = req.db;
    const { date, from, to, employee_id } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];
    if (date) {
      params.push(date);
      whereClause += ` AND ad.work_date = $${params.length}`;
    } else if (from && to) {
      params.push(from); params.push(to);
      whereClause += ` AND ad.work_date BETWEEN $${params.length - 1} AND $${params.length}`;
    }
    if (employee_id) {
      params.push(employee_id);
      whereClause += ` AND ad.employee_id = $${params.length}`;
    }

    const result = await db.query(`
      SELECT ad.*, e.name AS employee_name, e.email, e.role
      FROM attendance_daily ad
      JOIN employees e ON e.id = ad.employee_id
      ${whereClause}
      ORDER BY ad.work_date DESC, e.name
    `, params);

    res.json(result.rows);
  } catch (err) {
    console.error('[attendance/daily-summary]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/attendance/history ────────────────────────────────────────────────
router.get('/history', authenticate, injectTenantDb, async (req, res) => {
  try {
    const db = req.db;
    const { from, to, employee_id, limit = 100, offset = 0 } = req.query;

    const isAdmin = req.user.role === 'admin';
    let empId = null;

    if (isAdmin && employee_id) {
      empId = employee_id;
    } else if (!isAdmin) {
      empId = await getEmployeeIdForUser(db, req.user.id);
    }

    let whereClause = 'WHERE 1=1';
    const params = [];
    if (empId) { params.push(empId); whereClause += ` AND ce.employee_id = $${params.length}`; }
    if (from)  { params.push(from);  whereClause += ` AND ce.event_time >= $${params.length}`; }
    if (to)    { params.push(to);    whereClause += ` AND ce.event_time < $${params.length}::date + 1`; }

    params.push(limit); params.push(offset);

    const result = await db.query(`
      SELECT ce.*, e.name AS employee_name
      FROM clock_events ce
      JOIN employees e ON e.id = ce.employee_id
      ${whereClause}
      ORDER BY ce.event_time DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json(result.rows);
  } catch (err) {
    console.error('[attendance/history]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/attendance/daily/:id  (admin correction) ─────────────────────────
router.put('/daily/:id', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const db = req.db;
    const { clock_in_time, clock_out_time, break_minutes, status, notes } = req.body;

    const result = await db.query(`
      UPDATE attendance_daily SET
        clock_in_time  = COALESCE($2, clock_in_time),
        clock_out_time = COALESCE($3, clock_out_time),
        break_minutes  = COALESCE($4, break_minutes),
        total_minutes  = CASE
          WHEN $2 IS NOT NULL OR $3 IS NOT NULL THEN
            EXTRACT(EPOCH FROM (COALESCE($3, clock_out_time) - COALESCE($2, clock_in_time))) / 60
          ELSE total_minutes END,
        status         = COALESCE($5, status),
        notes          = COALESCE($6, notes),
        updated_at     = NOW()
      WHERE id = $1
      RETURNING *
    `, [req.params.id, clock_in_time||null, clock_out_time||null,
        break_minutes ?? null, status||null, notes||null]);

    if (!result.rows.length) return res.status(404).json({ error: 'Record not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[attendance/daily/:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

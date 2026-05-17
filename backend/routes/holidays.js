/**
 * Public Holidays
 *
 * GET    /api/holidays          — list holidays (filter: year, location_id)
 * POST   /api/holidays          — create (admin)
 * PUT    /api/holidays/:id      — update (admin)
 * DELETE /api/holidays/:id      — delete (admin)
 * GET    /api/holidays/check    — check if a date is a holiday { date, location_id? }
 * POST   /api/holidays/bulk     — bulk-create from a standard list (admin)
 */

const express = require('express');
const router  = express.Router();
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');

// ── GET /api/holidays ──────────────────────────────────────────────────────────
router.get('/', authenticate, injectTenantDb, async (req, res) => {
  try {
    const db = req.db;
    const { year, location_id } = req.query;

    let where = 'WHERE 1=1';
    const params = [];

    if (year) {
      params.push(year);
      where += ` AND EXTRACT(YEAR FROM holiday_date) = $${params.length}`;
    }
    if (location_id) {
      params.push(location_id);
      where += ` AND (ph.location_id = $${params.length} OR ph.location_id IS NULL)`;
    }

    const result = await db.query(`
      SELECT ph.*, ol.name AS location_name
      FROM public_holidays ph
      LEFT JOIN org_locations ol ON ol.id = ph.location_id
      ${where}
      ORDER BY ph.holiday_date ASC
    `, params);

    res.json(result.rows);
  } catch (err) {
    console.error('[holidays GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/holidays/check ────────────────────────────────────────────────────
// Returns { is_holiday: bool, holiday: row|null }
router.get('/check', authenticate, injectTenantDb, async (req, res) => {
  try {
    const db = req.db;
    const { date, location_id } = req.query;
    if (!date) return res.status(400).json({ error: 'date query param required' });

    const params = [date];
    let locationFilter = '';
    if (location_id) {
      params.push(location_id);
      locationFilter = ` AND (location_id = $${params.length} OR location_id IS NULL)`;
    }

    const result = await db.query(
      `SELECT * FROM public_holidays WHERE holiday_date = $1${locationFilter} LIMIT 1`,
      params
    );

    res.json({
      is_holiday: result.rows.length > 0,
      holiday: result.rows[0] || null,
    });
  } catch (err) {
    console.error('[holidays check]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/holidays ─────────────────────────────────────────────────────────
router.post('/', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const db = req.db;
    const { holiday_date, name, is_mandatory = true, location_id, applies_to = 'all' } = req.body;

    if (!holiday_date || !name) {
      return res.status(400).json({ error: 'holiday_date and name are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(holiday_date)) {
      return res.status(400).json({ error: 'holiday_date must be YYYY-MM-DD' });
    }

    const VALID_APPLIES = ['all', 'full_time', 'part_time', 'contractors'];
    if (!VALID_APPLIES.includes(applies_to)) {
      return res.status(400).json({ error: `applies_to must be one of: ${VALID_APPLIES.join(', ')}` });
    }

    const result = await db.query(`
      INSERT INTO public_holidays (holiday_date, name, is_mandatory, location_id, applies_to)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (location_id, holiday_date, name) DO UPDATE SET
        is_mandatory = EXCLUDED.is_mandatory,
        applies_to   = EXCLUDED.applies_to
      RETURNING *
    `, [holiday_date, name.trim(), is_mandatory, location_id || null, applies_to]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[holidays POST]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/holidays/bulk ────────────────────────────────────────────────────
// Accepts array of { holiday_date, name, is_mandatory?, location_id?, applies_to? }
router.post('/bulk', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const db = req.db;
    const { holidays } = req.body;

    if (!Array.isArray(holidays) || holidays.length === 0) {
      return res.status(400).json({ error: 'holidays array required' });
    }
    if (holidays.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 holidays per bulk request' });
    }

    const inserted = [];
    for (const h of holidays) {
      const { holiday_date, name, is_mandatory = true, location_id, applies_to = 'all' } = h;
      if (!holiday_date || !name) continue;

      const r = await db.query(`
        INSERT INTO public_holidays (holiday_date, name, is_mandatory, location_id, applies_to)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (location_id, holiday_date, name) DO UPDATE SET
          is_mandatory = EXCLUDED.is_mandatory,
          applies_to   = EXCLUDED.applies_to
        RETURNING *
      `, [holiday_date, name.trim(), is_mandatory, location_id || null, applies_to || 'all']);

      inserted.push(r.rows[0]);
    }

    res.status(201).json({ inserted: inserted.length, records: inserted });
  } catch (err) {
    console.error('[holidays bulk]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/holidays/:id ──────────────────────────────────────────────────────
router.put('/:id', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const db = req.db;
    const { holiday_date, name, is_mandatory, location_id, applies_to } = req.body;

    const result = await db.query(`
      UPDATE public_holidays SET
        holiday_date = COALESCE($2, holiday_date),
        name         = COALESCE($3, name),
        is_mandatory = COALESCE($4, is_mandatory),
        location_id  = COALESCE($5, location_id),
        applies_to   = COALESCE($6, applies_to)
      WHERE id = $1
      RETURNING *
    `, [
      req.params.id,
      holiday_date || null,
      name ? name.trim() : null,
      is_mandatory !== undefined ? is_mandatory : null,
      location_id !== undefined ? (location_id || null) : null,
      applies_to || null,
    ]);

    if (!result.rows.length) return res.status(404).json({ error: 'Holiday not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[holidays PUT]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/holidays/:id ───────────────────────────────────────────────────
router.delete('/:id', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const db = req.db;
    const result = await db.query(
      'DELETE FROM public_holidays WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Holiday not found' });
    res.json({ message: 'Holiday deleted', id: result.rows[0].id });
  } catch (err) {
    console.error('[holidays DELETE]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

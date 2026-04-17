/**
 * Demo Requests Routes
 *
 * Public:
 *   POST /api/public/demo-requests  — capture inbound lead from marketing site
 *
 * Super-admin (protected):
 *   GET  /api/super-admin/demo-requests        — list all leads (paginated + filtered)
 *   GET  /api/super-admin/demo-requests/stats  — counts by status
 *   PATCH /api/super-admin/demo-requests/:id/status — update lead status
 */

const express  = require('express');
const router   = express.Router();
const { getMasterDb } = require('../masterDatabase');

// ── Helpers ───────────────────────────────────────────────────────────────────

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email));
}

// ── Public: Submit demo request ───────────────────────────────────────────────

router.post('/', async (req, res) => {
  try {
    const { name, email, company, phone, message, source } = req.body;

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: 'Full name is required (min 2 characters).' });
    }
    if (!email || !validateEmail(email)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    if (name.trim().length > 120) {
      return res.status(400).json({ error: 'Name is too long.' });
    }
    if (message && message.length > 2000) {
      return res.status(400).json({ error: 'Message must be under 2000 characters.' });
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
               || req.socket?.remoteAddress
               || null;

    const db = await getMasterDb();
    const result = await db.query(
      `INSERT INTO demo_requests (name, email, company, phone, message, source, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [
        name.trim(),
        email.trim().toLowerCase(),
        company?.trim() || null,
        phone?.trim()   || null,
        message?.trim() || null,
        source?.trim()  || 'homepage',
        ip,
      ]
    );

    const lead = result.rows[0];
    console.log(`[DemoRequest] New lead #${lead.id}: ${email.trim().toLowerCase()}`);

    return res.status(201).json({
      success: true,
      message: 'Demo request received. We\'ll be in touch within 1 business day.',
      id: lead.id,
    });
  } catch (err) {
    console.error('[DemoRequest] POST error:', err.message);
    return res.status(500).json({ error: 'Failed to submit demo request. Please try again.' });
  }
});

// ── Super-admin: Stats ────────────────────────────────────────────────────────

router.get('/stats', async (req, res) => {
  try {
    const db = await getMasterDb();
    const result = await db.query(`
      SELECT
        COUNT(*)::int                                          AS total,
        COUNT(*) FILTER (WHERE status = 'new')::int           AS new,
        COUNT(*) FILTER (WHERE status = 'contacted')::int     AS contacted,
        COUNT(*) FILTER (WHERE status = 'qualified')::int     AS qualified,
        COUNT(*) FILTER (WHERE status = 'disqualified')::int  AS disqualified,
        COUNT(*) FILTER (WHERE status = 'converted')::int     AS converted,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS this_week
      FROM demo_requests
    `);
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('[DemoRequest] GET /stats error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch demo request stats.' });
  }
});

// ── Super-admin: List leads ───────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page, 10)  || 1);
    const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status || null;
    const search = req.query.search?.trim() || null;

    const conditions = [];
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length} OR company ILIKE $${params.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const db = await getMasterDb();
    const [rows, countRow] = await Promise.all([
      db.query(
        `SELECT id, name, email, company, phone, message, status, source, created_at, updated_at
         FROM demo_requests
         ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      db.query(
        `SELECT COUNT(*)::int AS total FROM demo_requests ${where}`,
        params
      ),
    ]);

    return res.json({
      leads: rows.rows,
      total: countRow.rows[0].total,
      page,
      limit,
      pages: Math.ceil(countRow.rows[0].total / limit),
    });
  } catch (err) {
    console.error('[DemoRequest] GET / error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch demo requests.' });
  }
});

// ── Super-admin: Update lead status ──────────────────────────────────────────

router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const VALID = ['new', 'contacted', 'qualified', 'disqualified', 'converted'];

    if (!VALID.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Must be one of: ${VALID.join(', ')}`,
      });
    }

    const db = await getMasterDb();
    const result = await db.query(
      `UPDATE demo_requests
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, email, status, updated_at`,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Demo request not found.' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error('[DemoRequest] PATCH /:id/status error:', err.message);
    return res.status(500).json({ error: 'Failed to update status.' });
  }
});

module.exports = router;

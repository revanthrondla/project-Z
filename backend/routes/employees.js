const express = require('express');
const bcrypt = require('bcryptjs');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');
const { indexUserEmail } = require('../masterDatabase');

const router = express.Router();

// GET /api/employees — Admin: all; Candidate: own profile
router.get('/', authenticate, injectTenantDb, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      const result = await req.db.query(`
        SELECT c.*, cl.name as client_name, u.email as user_email
        FROM employees c
        LEFT JOIN clients cl ON c.client_id = cl.id
        LEFT JOIN users u ON c.user_id = u.id
        ORDER BY c.name
      `);
      return res.json(result.rows);
    }
    // Candidate: own profile only
    const result = await req.db.query(`
      SELECT c.*, cl.name as client_name
      FROM employees c
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE c.id = $1
    `, [req.user.employeeId]);
    const candidate = result.rows[0];
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
    res.json([candidate]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/employees/:id
router.get('/:id', authenticate, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (req.user.role !== 'admin' && req.user.employeeId !== id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const result = await req.db.query(`
      SELECT c.*, cl.name as client_name, cl.contact_email as client_contact_email
      FROM employees c
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE c.id = $1
    `, [id]);
    const candidate = result.rows[0];
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
    res.json(candidate);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Input validation helper ───────────────────────────────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validateCandidateInput({ name, email, hourly_rate, start_date, end_date }) {
  if (name && name.length > 255)          return 'Name must be 255 characters or fewer';
  if (email && email.length > 255)        return 'Email must be 255 characters or fewer';
  if (hourly_rate !== undefined) {
    const rate = parseFloat(hourly_rate);
    if (isNaN(rate) || rate < 0)          return 'hourly_rate must be a non-negative number';
    if (rate > 100000)                    return 'hourly_rate exceeds maximum allowed value';
  }
  if (start_date && !DATE_RE.test(start_date)) return 'start_date must be YYYY-MM-DD';
  if (end_date   && !DATE_RE.test(end_date))   return 'end_date must be YYYY-MM-DD';
  return null;
}

// POST /api/employees — Admin only
router.post('/', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const { name, email, phone, role, hourly_rate, client_id, start_date, end_date, status, contract_type, password } = req.body;
    if (!name || !email || !role || !hourly_rate) {
      return res.status(400).json({ error: 'Name, email, role, and hourly_rate are required' });
    }
    const validErr = validateCandidateInput({ name, email, hourly_rate, start_date, end_date });
    if (validErr) return res.status(400).json({ error: validErr });

    // Check if email already exists
    const existingResult = await req.db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (existingResult.rows.length > 0) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    const hash = await bcrypt.hash(password || 'candidate123', 10);

    const newCandidate = await req.db.transaction(async (tx) => {
      const userResult = await tx.query(
        'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
        [name, email.toLowerCase().trim(), hash, 'candidate']
      );
      const userId = userResult.rows[0].id;

      const candidateResult = await tx.query(`
        INSERT INTO employees (user_id, name, email, phone, role, hourly_rate, client_id, start_date, end_date, status, contract_type)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
      `, [
        userId, name, email.toLowerCase().trim(), phone || null,
        role, parseFloat(hourly_rate), client_id || null,
        start_date || null, end_date || null,
        status || 'active', contract_type || 'contractor'
      ]);

      const employeeId = candidateResult.rows[0].id;

      const newCandidateResult = await tx.query(
        'SELECT c.*, cl.name as client_name FROM employees c LEFT JOIN clients cl ON c.client_id = cl.id WHERE c.id = $1',
        [employeeId]
      );

      return newCandidateResult.rows[0];
    });

    // Index email → tenant for seamless login (fire-and-forget, non-blocking)
    indexUserEmail(email.toLowerCase().trim(), req.user.tenantSlug).catch(() => {});

    res.status(201).json(newCandidate);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/employees/:id — Admin or self
router.put('/:id', authenticate, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid candidate ID' });
    if (req.user.role !== 'admin' && req.user.employeeId !== id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { name, email, phone, role, hourly_rate, client_id, start_date, end_date, status, contract_type, market_status, available_date, market_notes } = req.body;
    const validErr = validateCandidateInput({ name, email, hourly_rate, start_date, end_date });
    if (validErr) return res.status(400).json({ error: validErr });

    const updateFields = [];
    const values = [];
    let paramCounter = 1;

    if (name) { updateFields.push(`name = $${paramCounter++}`); values.push(name); }
    if (phone !== undefined) { updateFields.push(`phone = $${paramCounter++}`); values.push(phone); }
    if (market_status) { updateFields.push(`market_status = $${paramCounter++}`); values.push(market_status); }
    if (available_date !== undefined) { updateFields.push(`available_date = $${paramCounter++}`); values.push(available_date || null); }
    if (market_notes !== undefined) { updateFields.push(`market_notes = $${paramCounter++}`); values.push(market_notes || null); }
    if (req.user.role === 'admin') {
      if (role) { updateFields.push(`role = $${paramCounter++}`); values.push(role); }
      if (hourly_rate !== undefined) { updateFields.push(`hourly_rate = $${paramCounter++}`); values.push(parseFloat(hourly_rate)); }
      if (client_id !== undefined) { updateFields.push(`client_id = $${paramCounter++}`); values.push(client_id || null); }
      if (start_date !== undefined) { updateFields.push(`start_date = $${paramCounter++}`); values.push(start_date); }
      if (end_date !== undefined) { updateFields.push(`end_date = $${paramCounter++}`); values.push(end_date || null); }
      if (status) { updateFields.push(`status = $${paramCounter++}`); values.push(status); }
      if (contract_type) { updateFields.push(`contract_type = $${paramCounter++}`); values.push(contract_type); }
    }

    if (updateFields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(id);
    await req.db.query(`UPDATE employees SET ${updateFields.join(', ')} WHERE id = $${paramCounter}`, values);

    const result = await req.db.query('SELECT c.*, cl.name as client_name FROM employees c LEFT JOIN clients cl ON c.client_id = cl.id WHERE c.id = $1', [id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/employees/:id — Admin only
router.delete('/:id', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await req.db.query('SELECT * FROM employees WHERE id = $1', [id]);
    const candidate = result.rows[0];
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

    await req.db.query('DELETE FROM employees WHERE id = $1', [id]);
    res.json({ message: 'Candidate deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/employees/:id/stats
router.get('/:id/stats', authenticate, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (req.user.role !== 'admin' && req.user.employeeId !== id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const currentYear = new Date().getFullYear();

    const monthlyHoursResult = await req.db.query(`
      SELECT COALESCE(SUM(hours), 0) as hours
      FROM time_entries
      WHERE candidate_id = $1 AND TO_CHAR(date, 'YYYY-MM') = $2 AND status != 'rejected'
    `, [id, currentMonth]);
    const monthlyHours = monthlyHoursResult.rows[0];

    const yearlyHoursResult = await req.db.query(`
      SELECT COALESCE(SUM(hours), 0) as hours
      FROM time_entries
      WHERE candidate_id = $1 AND EXTRACT(YEAR FROM date::date) = $2 AND status != 'rejected'
    `, [id, currentYear]);
    const yearlyHours = yearlyHoursResult.rows[0];

    const pendingEntriesResult = await req.db.query(`
      SELECT COUNT(*) as count FROM time_entries WHERE candidate_id = $1 AND status = 'pending'
    `, [id]);
    const pendingEntries = pendingEntriesResult.rows[0];

    const absenceStatsResult = await req.db.query(`
      SELECT type, COUNT(*) as count FROM absences WHERE candidate_id = $1 AND status = 'approved'
      GROUP BY type
    `, [id]);
    const absenceStats = absenceStatsResult.rows;

    const invoiceStatsResult = await req.db.query(`
      SELECT status, COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total
      FROM invoices WHERE candidate_id = $1
      GROUP BY status
    `, [id]);
    const invoiceStats = invoiceStatsResult.rows;

    res.json({ monthlyHours: monthlyHours.hours, yearlyHours: yearlyHours.hours, pendingEntries: pendingEntries.count, absenceStats, invoiceStats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/employees/:id/market-status — admin or self (candidate)
router.patch('/:id/market-status', authenticate, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    // Access check: admin or the candidate themselves
    if (req.user.role !== 'admin' && req.user.employeeId !== id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { market_status, available_date, market_notes } = req.body;
    const VALID = ['employed', 'in_market', 'about_to_be_in_market'];
    if (market_status && !VALID.includes(market_status)) {
      return res.status(400).json({ error: 'Invalid market_status' });
    }
    const result = await req.db.query(
      `UPDATE employees SET
         market_status  = COALESCE($1, market_status),
         available_date = $2,
         market_notes   = $3,
         updated_at     = NOW()
       WHERE id = $4 RETURNING id, market_status, available_date, market_notes`,
      [market_status || null, available_date || null, market_notes || null, id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Candidate not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

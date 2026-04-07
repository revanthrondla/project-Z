const express = require('express');
const bcrypt = require('bcryptjs');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');

const router = express.Router();

// GET /api/candidates — Admin: all; Candidate: own profile
router.get('/', authenticate, injectTenantDb, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      const candidates = await req.db.prepare(`
        SELECT c.*, cl.name as client_name, u.email as user_email
        FROM candidates c
        LEFT JOIN clients cl ON c.client_id = cl.id
        LEFT JOIN users u ON c.user_id = u.id
        ORDER BY c.name
      `).all();
      return res.json(candidates);
    }
    // Candidate: own profile only
    const candidate = await req.db.prepare(`
      SELECT c.*, cl.name as client_name
      FROM candidates c
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE c.id = ?
    `).get(req.user.candidateId);
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
    res.json([candidate]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/candidates/:id
router.get('/:id', authenticate, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (req.user.role !== 'admin' && req.user.candidateId !== id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const candidate = await req.db.prepare(`
      SELECT c.*, cl.name as client_name, cl.contact_email as client_contact_email
      FROM candidates c
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE c.id = ?
    `).get(id);
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

// POST /api/candidates — Admin only
router.post('/', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const { name, email, phone, role, hourly_rate, client_id, start_date, end_date, status, contract_type, password } = req.body;
    if (!name || !email || !role || !hourly_rate) {
      return res.status(400).json({ error: 'Name, email, role, and hourly_rate are required' });
    }
    const validErr = validateCandidateInput({ name, email, hourly_rate, start_date, end_date });
    if (validErr) return res.status(400).json({ error: validErr });

    // Check if email already exists
    const existingUser = await req.db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (existingUser) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    const hash = await bcrypt.hash(password || 'candidate123', 10);

    const candidateId = await req.db.transaction(async (tx) => {
      const userResult = await tx.prepare(
        'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
      ).run(name, email.toLowerCase().trim(), hash, 'candidate');

      const candidateResult = await tx.prepare(`
        INSERT INTO candidates (user_id, name, email, phone, role, hourly_rate, client_id, start_date, end_date, status, contract_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userResult.lastInsertRowid, name, email.toLowerCase().trim(), phone || null,
        role, parseFloat(hourly_rate), client_id || null,
        start_date || null, end_date || null,
        status || 'active', contract_type || 'contractor'
      );

      return candidateResult.lastInsertRowid;
    });
    const newCandidate = await req.db.prepare('SELECT c.*, cl.name as client_name FROM candidates c LEFT JOIN clients cl ON c.client_id = cl.id WHERE c.id = ?').get(candidateId);
    res.status(201).json(newCandidate);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/candidates/:id — Admin or self
router.put('/:id', authenticate, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid candidate ID' });
    if (req.user.role !== 'admin' && req.user.candidateId !== id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { name, email, phone, role, hourly_rate, client_id, start_date, end_date, status, contract_type } = req.body;
    const validErr = validateCandidateInput({ name, email, hourly_rate, start_date, end_date });
    if (validErr) return res.status(400).json({ error: validErr });

    const updateFields = [];
    const values = [];

    if (name) { updateFields.push('name = ?'); values.push(name); }
    if (phone !== undefined) { updateFields.push('phone = ?'); values.push(phone); }
    if (req.user.role === 'admin') {
      if (role) { updateFields.push('role = ?'); values.push(role); }
      if (hourly_rate !== undefined) { updateFields.push('hourly_rate = ?'); values.push(parseFloat(hourly_rate)); }
      if (client_id !== undefined) { updateFields.push('client_id = ?'); values.push(client_id || null); }
      if (start_date !== undefined) { updateFields.push('start_date = ?'); values.push(start_date); }
      if (end_date !== undefined) { updateFields.push('end_date = ?'); values.push(end_date || null); }
      if (status) { updateFields.push('status = ?'); values.push(status); }
      if (contract_type) { updateFields.push('contract_type = ?'); values.push(contract_type); }
    }

    if (updateFields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(id);
    await req.db.prepare(`UPDATE candidates SET ${updateFields.join(', ')} WHERE id = ?`).run(...values);

    const updated = await req.db.prepare('SELECT c.*, cl.name as client_name FROM candidates c LEFT JOIN clients cl ON c.client_id = cl.id WHERE c.id = ?').get(id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/candidates/:id — Admin only
router.delete('/:id', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const candidate = await req.db.prepare('SELECT * FROM candidates WHERE id = ?').get(id);
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

    await req.db.prepare('DELETE FROM candidates WHERE id = ?').run(id);
    res.json({ message: 'Candidate deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/candidates/:id/stats
router.get('/:id/stats', authenticate, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (req.user.role !== 'admin' && req.user.candidateId !== id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const currentYear = new Date().getFullYear();

    const monthlyHours = await req.db.prepare(`
      SELECT COALESCE(SUM(hours), 0) as hours
      FROM time_entries
      WHERE candidate_id = ? AND TO_CHAR(date, 'YYYY-MM') = ? AND status != 'rejected'
    `).get(id, currentMonth);

    const yearlyHours = await req.db.prepare(`
      SELECT COALESCE(SUM(hours), 0) as hours
      FROM time_entries
      WHERE candidate_id = ? AND EXTRACT(YEAR FROM date::date) = ? AND status != 'rejected'
    `).get(id, currentYear);

    const pendingEntries = await req.db.prepare(`
      SELECT COUNT(*) as count FROM time_entries WHERE candidate_id = ? AND status = 'pending'
    `).get(id);

    const absenceStats = await req.db.prepare(`
      SELECT type, COUNT(*) as count FROM absences WHERE candidate_id = ? AND status = 'approved'
      GROUP BY type
    `).all(id);

    const invoiceStats = await req.db.prepare(`
      SELECT status, COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total
      FROM invoices WHERE candidate_id = ?
      GROUP BY status
    `).all(id);

    res.json({ monthlyHours: monthlyHours.hours, yearlyHours: yearlyHours.hours, pendingEntries: pendingEntries.count, absenceStats, invoiceStats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

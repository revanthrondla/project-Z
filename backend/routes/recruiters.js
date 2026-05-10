/**
 * Recruiter Routes
 *
 * GET    /api/recruiters             — admin: list all recruiters
 * POST   /api/recruiters             — admin: create recruiter account
 * GET    /api/recruiters/me          — recruiter: own profile
 * GET    /api/recruiters/:id         — admin or own recruiter
 * PUT    /api/recruiters/:id         — admin: update recruiter
 * DELETE /api/recruiters/:id         — admin: deactivate recruiter
 *
 * GET    /api/recruiters/:id/assignments    — admin or own: list assigned candidates
 * POST   /api/recruiters/:id/assignments    — admin: assign candidate
 * DELETE /api/recruiters/:id/assignments/:employeeId  — admin: remove assignment
 */
const express = require('express');
const bcrypt  = require('bcryptjs');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');
const { indexUserEmail } = require('../masterDatabase');

const router = express.Router();
router.use(authenticate, injectTenantDb);

// ── Helper: ensure caller is admin OR the recruiter themselves ─────────────────
function isAdminOrSelf(req, recruiterId) {
  if (req.user.role === 'admin') return true;
  return req.user.role === 'recruiter' && req.user.recruiterId === parseInt(recruiterId);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/recruiters — admin only
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await req.db.query(`
      SELECT r.*, u.email as user_email,
             COUNT(ra.id)::int as assignment_count
      FROM recruiters r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN recruiter_assignments ra ON ra.recruiter_id = r.id
      GROUP BY r.id, u.email
      ORDER BY r.name
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/recruiters — admin: create recruiter user + profile
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, email, password, specialties = [] } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check for existing user
    const existing = await req.db.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows[0]) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    const hash = await bcrypt.hash(password, 10);

    // Create user with recruiter role
    const userResult = await req.db.query(
      `INSERT INTO users (name, email, password_hash, role, must_change_password, created_at, updated_at)
       VALUES ($1, $2, $3, 'recruiter', TRUE, NOW(), NOW()) RETURNING id`,
      [name, normalizedEmail, hash]
    );
    const userId = userResult.rows[0].id;

    // Create recruiter profile
    const recResult = await req.db.query(
      `INSERT INTO recruiters (user_id, name, email, specialties, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING *`,
      [userId, name, normalizedEmail, JSON.stringify(specialties)]
    );

    // Index email → tenant for seamless login
    indexUserEmail(normalizedEmail, req.user.tenantSlug).catch(() => {});

    res.status(201).json(recResult.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/recruiters/me — recruiter: own profile + assignment count
// ─────────────────────────────────────────────────────────────────────────────
router.get('/me', async (req, res) => {
  try {
    if (req.user.role !== 'recruiter') {
      return res.status(403).json({ error: 'Recruiter access only' });
    }
    const result = await req.db.query(`
      SELECT r.*, u.email as user_email,
             COUNT(ra.id)::int as assignment_count
      FROM recruiters r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN recruiter_assignments ra ON ra.recruiter_id = r.id
      WHERE u.id = $1
      GROUP BY r.id, u.email
    `, [req.user.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Recruiter profile not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/recruiters/:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    if (!isAdminOrSelf(req, req.params.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const result = await req.db.query(`
      SELECT r.*, u.email as user_email,
             COUNT(ra.id)::int as assignment_count
      FROM recruiters r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN recruiter_assignments ra ON ra.recruiter_id = r.id
      WHERE r.id = $1
      GROUP BY r.id, u.email
    `, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Recruiter not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/recruiters/:id — admin only
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name, specialties } = req.body;
    const result = await req.db.query(
      `UPDATE recruiters SET
         name        = COALESCE($1, name),
         specialties = COALESCE($2, specialties),
         updated_at  = NOW()
       WHERE id = $3 RETURNING *`,
      [name || null, specialties ? JSON.stringify(specialties) : null, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Recruiter not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/recruiters/:id — admin: deactivate (soft delete via user status)
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    // Get the user_id for this recruiter
    const recResult = await req.db.query('SELECT user_id FROM recruiters WHERE id = $1', [req.params.id]);
    if (!recResult.rows[0]) return res.status(404).json({ error: 'Recruiter not found' });
    // Change role to 'candidate' equivalent deactivation — just mark deleted via role change
    await req.db.query('DELETE FROM recruiters WHERE id = $1', [req.params.id]);
    await req.db.query('DELETE FROM users WHERE id = $1', [recResult.rows[0].user_id]);
    res.json({ message: 'Recruiter removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/recruiters/:id/assignments — list assigned candidates
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/assignments', async (req, res) => {
  try {
    if (!isAdminOrSelf(req, req.params.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const result = await req.db.query(`
      SELECT c.id, c.name, c.email, c.role as job_title, c.status,
             c.market_status, c.available_date, c.market_notes,
             ra.assigned_at, ra.notes as assignment_notes,
             CASE WHEN cr.id IS NOT NULL THEN true ELSE false END as has_resume
      FROM recruiter_assignments ra
      JOIN employees c ON ra.candidate_id = c.id
      LEFT JOIN candidate_resumes cr ON cr.candidate_id = c.id
      WHERE ra.recruiter_id = $1
      ORDER BY c.name
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/recruiters/:id/assignments — admin: assign a candidate
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/assignments', requireAdmin, async (req, res) => {
  try {
    const { employeeId, notes } = req.body;
    if (!employeeId) return res.status(400).json({ error: 'employeeId required' });

    // Verify recruiter exists
    const recCheck = await req.db.query('SELECT id FROM recruiters WHERE id = $1', [req.params.id]);
    if (!recCheck.rows[0]) return res.status(404).json({ error: 'Recruiter not found' });

    // Verify candidate exists
    const candCheck = await req.db.query('SELECT id, name FROM employees WHERE id = $1', [employeeId]);
    if (!candCheck.rows[0]) return res.status(404).json({ error: 'Candidate not found' });

    const result = await req.db.query(
      `INSERT INTO recruiter_assignments (recruiter_id, candidate_id, notes, assigned_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (recruiter_id, candidate_id) DO UPDATE SET notes = EXCLUDED.notes
       RETURNING *`,
      [req.params.id, employeeId, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/recruiters/:id/assignments/:employeeId — admin: remove assignment
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id/assignments/:employeeId', requireAdmin, async (req, res) => {
  try {
    await req.db.query(
      'DELETE FROM recruiter_assignments WHERE recruiter_id = $1 AND candidate_id = $2',
      [req.params.id, req.params.employeeId]
    );
    res.json({ message: 'Assignment removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

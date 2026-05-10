const express = require('express');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');
const { createNotification } = require('./notifications');

const router = express.Router();

// GET /api/absences
router.get('/', authenticate, injectTenantDb, async (req, res) => {
  try {
    const { candidate_id, status, year } = req.query;
    let query = `
      SELECT a.*, c.name as employee_name
      FROM absences a
      JOIN employees c ON a.candidate_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (req.user.role === 'candidate') {
      query += ' AND a.candidate_id = $' + (params.length + 1);
      params.push(req.user.employeeId);
    } else if (candidate_id) {
      query += ' AND a.candidate_id = $' + (params.length + 1);
      params.push(candidate_id);
    }

    if (status) { query += ' AND a.status = $' + (params.length + 1); params.push(status); }
    if (year) { query += ' AND (TO_CHAR(a.start_date, \'YYYY\') = $' + (params.length + 1) + ' OR TO_CHAR(a.end_date, \'YYYY\') = $' + (params.length + 2) + ')'; params.push(year, year); }

    query += ' ORDER BY a.start_date DESC';

    const result = await req.db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/absences
router.post('/', authenticate, injectTenantDb, async (req, res) => {
  try {
    const { candidate_id, start_date, end_date, type, notes } = req.body;
    if (!start_date || !end_date || !type) {
      return res.status(400).json({ error: 'start_date, end_date, and type are required' });
    }
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (!DATE_RE.test(start_date)) return res.status(400).json({ error: 'start_date must be in YYYY-MM-DD format' });
    if (!DATE_RE.test(end_date))   return res.status(400).json({ error: 'end_date must be in YYYY-MM-DD format' });
    if (new Date(end_date) < new Date(start_date)) {
      return res.status(400).json({ error: 'end_date must be after start_date' });
    }
    if (notes && notes.length > 1000) return res.status(400).json({ error: 'Notes must be 1000 characters or fewer' });

    let cid = candidate_id;
    if (req.user.role === 'candidate') cid = req.user.employeeId;
    if (!cid) return res.status(400).json({ error: 'Candidate ID required' });

    const insertResult = await req.db.query(`
      INSERT INTO absences (candidate_id, start_date, end_date, type, status, notes)
      VALUES ($1, $2, $3, $4, 'pending', $5)
      RETURNING id
    `, [cid, start_date, end_date, type, notes || null]);

    const absenceId = insertResult.rows[0].id;

    const result = await req.db.query(`
      SELECT a.*, c.name as employee_name FROM absences a
      JOIN employees c ON a.candidate_id = c.id WHERE a.id = $1
    `, [absenceId]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/absences/:id
router.put('/:id', authenticate, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const absenceResult = await req.db.query('SELECT * FROM absences WHERE id = $1', [id]);
    const absence = absenceResult.rows[0];
    if (!absence) return res.status(404).json({ error: 'Absence not found' });

    if (req.user.role === 'candidate') {
      if (absence.candidate_id !== req.user.employeeId) return res.status(403).json({ error: 'Access denied' });
      if (absence.status !== 'pending') return res.status(400).json({ error: 'Cannot edit non-pending absence' });
    }

    const { start_date, end_date, type, notes, status } = req.body;

    if (req.user.role === 'admin' && status) {
      const approvedAt = (status === 'approved' || status === 'rejected') ? new Date().toISOString() : null;
      await req.db.query('UPDATE absences SET status = $1, approved_by = $2, approved_at = $3 WHERE id = $4',
        [status, req.user.id, approvedAt, id]);

      // Notify the candidate
      const candidateResult = await req.db.query('SELECT user_id FROM employees WHERE id = $1', [absence.candidate_id]);
      const candidate = candidateResult.rows[0];
      if (candidate) {
        const label = status === 'approved' ? 'approved' : 'rejected';
        await createNotification(
          req.db,
          candidate.user_id,
          `absence_${label}`,
          `Absence Request ${label.charAt(0).toUpperCase() + label.slice(1)}`,
          `Your ${absence.type} absence (${absence.start_date} to ${absence.end_date}) has been ${label}`,
          id,
          'absence'
        );
      }
    } else {
      await req.db.query(`
        UPDATE absences SET
          start_date = COALESCE($1, start_date),
          end_date = COALESCE($2, end_date),
          type = COALESCE($3, type),
          notes = COALESCE($4, notes)
        WHERE id = $5
      `, [start_date || null, end_date || null, type || null, notes !== undefined ? notes : null, id]);
    }

    const result = await req.db.query(`
      SELECT a.*, c.name as employee_name FROM absences a
      JOIN employees c ON a.candidate_id = c.id WHERE a.id = $1
    `, [id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/absences/:id
router.delete('/:id', authenticate, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const absenceResult = await req.db.query('SELECT * FROM absences WHERE id = $1', [id]);
    const absence = absenceResult.rows[0];
    if (!absence) return res.status(404).json({ error: 'Absence not found' });

    if (req.user.role === 'candidate') {
      if (absence.candidate_id !== req.user.employeeId) return res.status(403).json({ error: 'Access denied' });
      if (absence.status !== 'pending') return res.status(400).json({ error: 'Cannot delete non-pending absence' });
    }

    await req.db.query('DELETE FROM absences WHERE id = $1', [id]);
    res.json({ message: 'Absence deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

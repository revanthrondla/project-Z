const express = require('express');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');
const { createNotification } = require('./notifications');

const router = express.Router();

// GET /api/absences
router.get('/', authenticate, injectTenantDb, async (req, res) => {
  try {
    const { candidate_id, status, year } = req.query;
    let query = `
      SELECT a.*, c.name as candidate_name
      FROM absences a
      JOIN candidates c ON a.candidate_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (req.user.role === 'candidate') {
      query += ' AND a.candidate_id = ?';
      params.push(req.user.candidateId);
    } else if (candidate_id) {
      query += ' AND a.candidate_id = ?';
      params.push(candidate_id);
    }

    if (status) { query += ' AND a.status = ?'; params.push(status); }
    if (year) { query += ' AND (TO_CHAR(a.start_date, \'YYYY\') = ? OR TO_CHAR(a.end_date, \'YYYY\') = ?)'; params.push(year, year); }

    query += ' ORDER BY a.start_date DESC';

    const absences = await req.db.prepare(query).all(...params);
    res.json(absences);
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
    if (req.user.role === 'candidate') cid = req.user.candidateId;
    if (!cid) return res.status(400).json({ error: 'Candidate ID required' });

    const result = await req.db.prepare(`
      INSERT INTO absences (candidate_id, start_date, end_date, type, status, notes)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(cid, start_date, end_date, type, notes || null);

    const absence = await req.db.prepare(`
      SELECT a.*, c.name as candidate_name FROM absences a
      JOIN candidates c ON a.candidate_id = c.id WHERE a.id = ?
    `).get(result.lastInsertRowid);
    res.status(201).json(absence);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/absences/:id
router.put('/:id', authenticate, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const absence = await req.db.prepare('SELECT * FROM absences WHERE id = ?').get(id);
    if (!absence) return res.status(404).json({ error: 'Absence not found' });

    if (req.user.role === 'candidate') {
      if (absence.candidate_id !== req.user.candidateId) return res.status(403).json({ error: 'Access denied' });
      if (absence.status !== 'pending') return res.status(400).json({ error: 'Cannot edit non-pending absence' });
    }

    const { start_date, end_date, type, notes, status } = req.body;

    if (req.user.role === 'admin' && status) {
      const approvedAt = (status === 'approved' || status === 'rejected') ? new Date().toISOString() : null;
      await req.db.prepare('UPDATE absences SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?')
        .run(status, req.user.id, approvedAt, id);

      // Notify the candidate
      const candidate = await req.db.prepare('SELECT user_id FROM candidates WHERE id = ?').get(absence.candidate_id);
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
      await req.db.prepare(`
        UPDATE absences SET
          start_date = COALESCE(?, start_date),
          end_date = COALESCE(?, end_date),
          type = COALESCE(?, type),
          notes = COALESCE(?, notes)
        WHERE id = ?
      `).run(start_date || null, end_date || null, type || null, notes !== undefined ? notes : null, id);
    }

    const updated = await req.db.prepare(`
      SELECT a.*, c.name as candidate_name FROM absences a
      JOIN candidates c ON a.candidate_id = c.id WHERE a.id = ?
    `).get(id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/absences/:id
router.delete('/:id', authenticate, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const absence = await req.db.prepare('SELECT * FROM absences WHERE id = ?').get(id);
    if (!absence) return res.status(404).json({ error: 'Absence not found' });

    if (req.user.role === 'candidate') {
      if (absence.candidate_id !== req.user.candidateId) return res.status(403).json({ error: 'Access denied' });
      if (absence.status !== 'pending') return res.status(400).json({ error: 'Cannot delete non-pending absence' });
    }

    await req.db.prepare('DELETE FROM absences WHERE id = ?').run(id);
    res.json({ message: 'Absence deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

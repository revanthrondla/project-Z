const express = require('express');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');
const { createNotification } = require('./notifications');

const router = express.Router();

// GET /api/time-entries
router.get('/', authenticate, injectTenantDb, (req, res) => {
  const { candidate_id, start_date, end_date, status, month } = req.query;
  let query = `
    SELECT te.*, c.name as candidate_name, c.hourly_rate
    FROM time_entries te
    JOIN candidates c ON te.candidate_id = c.id
    WHERE 1=1
  `;
  const params = [];

  // Candidates can only see their own
  if (req.user.role === 'candidate') {
    query += ' AND te.candidate_id = ?';
    params.push(req.user.candidateId);
  } else if (candidate_id) {
    query += ' AND te.candidate_id = ?';
    params.push(candidate_id);
  }

  if (start_date) { query += ' AND te.date >= ?'; params.push(start_date); }
  if (end_date) { query += ' AND te.date <= ?'; params.push(end_date); }
  if (status) { query += ' AND te.status = ?'; params.push(status); }
  if (month) { query += ' AND te.date LIKE ?'; params.push(`${month}%`); }

  query += ' ORDER BY te.date DESC, te.id DESC';

  const entries = req.db.prepare(query).all(...params);
  res.json(entries);
});

// POST /api/time-entries
router.post('/', authenticate, injectTenantDb, (req, res) => {
  const { candidate_id, date, hours, description, project } = req.body;

  // Validate
  if (!date || !hours) return res.status(400).json({ error: 'Date and hours are required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
  const parsedHours = parseFloat(hours);
  if (isNaN(parsedHours) || parsedHours <= 0 || parsedHours > 24) return res.status(400).json({ error: 'Hours must be between 0 and 24' });
  if (description && description.length > 1000) return res.status(400).json({ error: 'Description must be 1000 characters or fewer' });
  if (project && project.length > 255) return res.status(400).json({ error: 'Project must be 255 characters or fewer' });

  // Determine candidate_id
  let cid = candidate_id;
  if (req.user.role === 'candidate') {
    cid = req.user.candidateId;
  }
  if (!cid) return res.status(400).json({ error: 'Candidate ID required' });

  // Check for duplicate date entry (same candidate, same date)
  const existing = req.db.prepare(
    'SELECT id FROM time_entries WHERE candidate_id = ? AND date = ?'
  ).get(cid, date);
  if (existing) {
    return res.status(409).json({ error: 'A time entry already exists for this date' });
  }

  const result = req.db.prepare(`
    INSERT INTO time_entries (candidate_id, date, hours, description, project, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(cid, date, parseFloat(hours), description || null, project || null, 'pending');

  const entry = req.db.prepare(`
    SELECT te.*, c.name as candidate_name, c.hourly_rate
    FROM time_entries te JOIN candidates c ON te.candidate_id = c.id
    WHERE te.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json(entry);
});

// PUT /api/time-entries/:id
router.put('/:id', authenticate, injectTenantDb, (req, res) => {
  const id = parseInt(req.params.id);
  const entry = req.db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id);
  if (!entry) return res.status(404).json({ error: 'Time entry not found' });

  // Check ownership
  if (req.user.role === 'candidate') {
    if (entry.candidate_id !== req.user.candidateId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (entry.status !== 'pending') {
      return res.status(400).json({ error: 'Cannot edit approved or rejected entries' });
    }
  }

  const { date, hours, description, project, status } = req.body;

  if (req.user.role === 'admin' && status) {
    // Admin can approve/reject
    const approvedAt = (status === 'approved' || status === 'rejected') ? new Date().toISOString() : null;
    req.db.prepare(`
      UPDATE time_entries SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?
    `).run(status, req.user.id, approvedAt, id);

    // Notify the candidate
    const candidate = req.db.prepare(`
      SELECT c.user_id, c.name FROM candidates c WHERE c.id = ?
    `).get(entry.candidate_id);
    if (candidate) {
      const label = status === 'approved' ? 'approved' : 'rejected';
      createNotification(
        req.db,
        candidate.user_id,
        `timesheet_${label}`,
        `Timesheet ${label.charAt(0).toUpperCase() + label.slice(1)}`,
        `Your time entry for ${entry.date} (${entry.hours} hrs) has been ${label}`,
        id,
        'time_entry'
      );
    }
  } else {
    // Candidate edits
    if (hours && (hours <= 0 || hours > 24)) return res.status(400).json({ error: 'Hours must be between 0 and 24' });
    req.db.prepare(`
      UPDATE time_entries SET
        date = COALESCE(?, date),
        hours = COALESCE(?, hours),
        description = COALESCE(?, description),
        project = COALESCE(?, project)
      WHERE id = ?
    `).run(date || null, hours ? parseFloat(hours) : null, description || null, project || null, id);
  }

  const updated = req.db.prepare(`
    SELECT te.*, c.name as candidate_name, c.hourly_rate
    FROM time_entries te JOIN candidates c ON te.candidate_id = c.id
    WHERE te.id = ?
  `).get(id);
  res.json(updated);
});

// DELETE /api/time-entries/:id
router.delete('/:id', authenticate, injectTenantDb, (req, res) => {
  const id = parseInt(req.params.id);
  const entry = req.db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id);
  if (!entry) return res.status(404).json({ error: 'Time entry not found' });

  if (req.user.role === 'candidate') {
    if (entry.candidate_id !== req.user.candidateId) return res.status(403).json({ error: 'Access denied' });
    if (entry.status !== 'pending') return res.status(400).json({ error: 'Cannot delete approved entries' });
  }

  req.db.prepare('DELETE FROM time_entries WHERE id = ?').run(id);
  res.json({ message: 'Time entry deleted' });
});

// POST /api/time-entries/bulk-approve — Admin only
router.post('/bulk-approve', authenticate, requireAdmin, injectTenantDb, (req, res) => {
  const { ids, status } = req.body;
  if (!ids || !Array.isArray(ids) || !status) {
    return res.status(400).json({ error: 'IDs array and status required' });
  }
  const approvedAt = new Date().toISOString();
  const stmt = req.db.prepare('UPDATE time_entries SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?');
  const label = status === 'approved' ? 'approved' : 'rejected';

  req.db.transaction(() => {
    for (const id of ids) {
      const entry = req.db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id);
      stmt.run(status, req.user.id, approvedAt, id);
      // Notify candidate
      if (entry) {
        const candidate = req.db.prepare('SELECT user_id FROM candidates WHERE id = ?').get(entry.candidate_id);
        if (candidate) {
          createNotification(
            req.db,
            candidate.user_id,
            `timesheet_${label}`,
            `Timesheet ${label.charAt(0).toUpperCase() + label.slice(1)}`,
            `Your time entry for ${entry.date} (${entry.hours} hrs) has been ${label}`,
            id,
            'time_entry'
          );
        }
      }
    }
  });
  res.json({ message: `${ids.length} entries ${status}` });
});

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT TIMESHEET APPROVAL
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/time-entries/client-pending
// Returns ALL admin-approved entries for the client's candidates,
// with their client_approval_status (null/pending/approved/rejected).
// Filtering by status is done client-side.
router.get('/client-pending', authenticate, injectTenantDb, (req, res) => {
  if (req.user.role !== 'client' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { from, to } = req.query;
  let q = `
    SELECT
      te.*,
      c.name       AS candidate_name,
      c.hourly_rate,
      cl.name      AS client_name,
      (te.hours * c.hourly_rate) AS amount
    FROM time_entries te
    JOIN candidates c ON te.candidate_id = c.id
    LEFT JOIN clients cl ON c.client_id = cl.id
    WHERE te.status = 'approved'
  `;
  const p = [];

  // Clients only see their own candidates
  if (req.user.role === 'client') {
    const client = req.db.prepare('SELECT id FROM clients WHERE user_id = ?').get(req.user.id);
    if (!client) return res.json([]);
    q += ' AND c.client_id = ?';
    p.push(client.id);
  }

  // Optional date filter
  if (from) { q += ' AND te.date >= ?'; p.push(from); }
  if (to)   { q += ' AND te.date <= ?'; p.push(to); }

  q += ' ORDER BY te.date DESC';
  res.json(req.db.prepare(q).all(...p));
});

// Helper — verify the client user owns the candidate linked to this entry
function assertClientOwnsEntry(db, userId, entryId) {
  // Returns the entry if access is valid; null if forbidden
  const client = db.prepare('SELECT id FROM clients WHERE user_id = ?').get(userId);
  if (!client) return null;
  return db.prepare(`
    SELECT te.* FROM time_entries te
    JOIN candidates c ON te.candidate_id = c.id
    WHERE te.id = ? AND c.client_id = ?
  `).get(entryId, client.id);
}

// POST /api/time-entries/:id/client-approve
router.post('/:id/client-approve', authenticate, injectTenantDb, (req, res) => {
  if (req.user.role !== 'client' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { note } = req.body;
  const entryId = parseInt(req.params.id, 10);
  if (!entryId) return res.status(400).json({ error: 'Invalid entry id' });

  // Clients may only approve entries belonging to their candidates
  let entry;
  if (req.user.role === 'client') {
    entry = assertClientOwnsEntry(req.db, req.user.id, entryId);
    if (!entry) return res.status(403).json({ error: 'Access denied — this entry does not belong to your candidates' });
  } else {
    entry = req.db.prepare('SELECT * FROM time_entries WHERE id = ?').get(entryId);
    if (!entry) return res.status(404).json({ error: 'Time entry not found' });
  }

  if (entry.status !== 'approved') {
    return res.status(400).json({ error: 'Only admin-approved entries can be client-approved' });
  }

  req.db.prepare(`
    UPDATE time_entries SET
      client_approval_status = 'approved',
      client_approval_note   = ?,
      client_approved_at     = CURRENT_TIMESTAMP,
      client_approved_by     = ?,
      updated_at             = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(note || null, req.user.id, entryId);
  res.json(req.db.prepare('SELECT * FROM time_entries WHERE id = ?').get(entryId));
});

// POST /api/time-entries/:id/client-reject
router.post('/:id/client-reject', authenticate, injectTenantDb, (req, res) => {
  if (req.user.role !== 'client' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { note } = req.body;
  if (!note || !note.trim()) return res.status(400).json({ error: 'A note is required when rejecting' });
  const entryId = parseInt(req.params.id, 10);
  if (!entryId) return res.status(400).json({ error: 'Invalid entry id' });

  let entry;
  if (req.user.role === 'client') {
    entry = assertClientOwnsEntry(req.db, req.user.id, entryId);
    if (!entry) return res.status(403).json({ error: 'Access denied — this entry does not belong to your candidates' });
  } else {
    entry = req.db.prepare('SELECT * FROM time_entries WHERE id = ?').get(entryId);
    if (!entry) return res.status(404).json({ error: 'Time entry not found' });
  }

  if (entry.status !== 'approved') {
    return res.status(400).json({ error: 'Only admin-approved entries can be client-rejected' });
  }

  req.db.prepare(`
    UPDATE time_entries SET
      client_approval_status = 'rejected',
      client_approval_note   = ?,
      client_approved_at     = CURRENT_TIMESTAMP,
      client_approved_by     = ?,
      updated_at             = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(note.trim(), req.user.id, entryId);
  res.json(req.db.prepare('SELECT * FROM time_entries WHERE id = ?').get(entryId));
});

module.exports = router;

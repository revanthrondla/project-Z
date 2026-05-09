const express = require('express');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');
const { createNotification } = require('./notifications');

const router = express.Router();

// GET /api/time-entries
router.get('/', authenticate, injectTenantDb, async (req, res) => {
  const { candidate_id, start_date, end_date, status, month, project_id } = req.query;
  let query = `
    SELECT te.*,
           c.name as candidate_name, c.hourly_rate,
           p.name as project_name,
           pt.name as task_name
    FROM time_entries te
    JOIN candidates c ON te.candidate_id = c.id
    LEFT JOIN projects p ON p.id = te.project_id
    LEFT JOIN project_tasks pt ON pt.id = te.task_id
    WHERE 1=1
  `;
  const params = [];

  // Candidates can only see their own
  if (req.user.role === 'candidate') {
    query += ' AND te.candidate_id = $' + (params.length + 1);
    params.push(req.user.candidateId);
  } else if (candidate_id) {
    query += ' AND te.candidate_id = $' + (params.length + 1);
    params.push(candidate_id);
  }

  if (start_date) { query += ' AND te.date >= $' + (params.length + 1); params.push(start_date); }
  if (end_date) { query += ' AND te.date <= $' + (params.length + 1); params.push(end_date); }
  if (status) { query += ' AND te.status = $' + (params.length + 1); params.push(status); }
  if (month) { query += " AND TO_CHAR(te.date, 'YYYY-MM') = $" + (params.length + 1); params.push(month); }
  if (project_id) { query += ' AND te.project_id = $' + (params.length + 1); params.push(parseInt(project_id, 10)); }

  query += ' ORDER BY te.date DESC, te.id DESC';

  const result = await req.db.query(query, params);
  res.json(result.rows);
});

// POST /api/time-entries
router.post('/', authenticate, injectTenantDb, async (req, res) => {
  const {
    candidate_id, date, hours, description, project,
    project_id, task_id, is_billable, billing_notes
  } = req.body;

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

  // Check for duplicate date+project entry
  const existing = await req.db.query(
    'SELECT id FROM time_entries WHERE candidate_id = $1 AND date = $2 AND (project_id = $3 OR (project_id IS NULL AND $3 IS NULL))',
    [cid, date, project_id ? parseInt(project_id, 10) : null]
  );
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'A time entry already exists for this date and project' });
  }

  const pid = project_id ? parseInt(project_id, 10) : null;
  const tid = task_id ? parseInt(task_id, 10) : null;

  const insertResult = await req.db.query(`
    INSERT INTO time_entries (candidate_id, date, hours, description, project,
                              project_id, task_id, is_billable, billing_notes, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id
  `, [
    cid, date, parsedHours, description || null, project || null,
    pid, tid, is_billable !== false, billing_notes || null, 'pending'
  ]);

  const entryId = insertResult.rows[0].id;

  const entry = await req.db.query(`
    SELECT te.*, c.name as candidate_name, c.hourly_rate,
           p.name as project_name, pt.name as task_name
    FROM time_entries te
    JOIN candidates c ON te.candidate_id = c.id
    LEFT JOIN projects p ON p.id = te.project_id
    LEFT JOIN project_tasks pt ON pt.id = te.task_id
    WHERE te.id = $1
  `, [entryId]);

  res.status(201).json(entry.rows[0]);
});

// PUT /api/time-entries/:id
router.put('/:id', authenticate, injectTenantDb, async (req, res) => {
  const id = parseInt(req.params.id);
  const entryResult = await req.db.query('SELECT * FROM time_entries WHERE id = $1', [id]);
  const entry = entryResult.rows[0];
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

  const { date, hours, description, project, status,
          project_id, task_id, is_billable, billing_notes, rejected_reason } = req.body;

  if (req.user.role === 'admin' && status) {
    // Admin can approve/reject
    const approvedAt = (status === 'approved' || status === 'rejected') ? new Date().toISOString() : null;
    await req.db.query(`
      UPDATE time_entries SET status = $1, approved_by = $2, approved_at = $3,
        rejected_reason = CASE WHEN $1 = 'rejected' THEN $5 ELSE NULL END
      WHERE id = $4
    `, [status, req.user.id, approvedAt, id, rejected_reason || null]);

    // Notify the candidate
    const candidateResult = await req.db.query(`
      SELECT c.user_id, c.name FROM candidates c WHERE c.id = $1
    `, [entry.candidate_id]);
    const candidate = candidateResult.rows[0];
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
    // Candidate/admin non-status edits
    if (hours && (hours <= 0 || hours > 24)) return res.status(400).json({ error: 'Hours must be between 0 and 24' });
    const pid = project_id !== undefined ? (project_id ? parseInt(project_id, 10) : null) : undefined;
    const tid = task_id !== undefined ? (task_id ? parseInt(task_id, 10) : null) : undefined;
    await req.db.query(`
      UPDATE time_entries SET
        date          = COALESCE($1, date),
        hours         = COALESCE($2, hours),
        description   = COALESCE($3, description),
        project       = COALESCE($4, project),
        project_id    = CASE WHEN $5::text IS NOT NULL THEN $5::bigint ELSE project_id END,
        task_id       = CASE WHEN $6::text IS NOT NULL THEN $6::bigint ELSE task_id END,
        is_billable   = COALESCE($7, is_billable),
        billing_notes = COALESCE($8, billing_notes)
      WHERE id = $9
    `, [
      date || null, hours ? parseFloat(hours) : null,
      description !== undefined ? description : null,
      project !== undefined ? project : null,
      pid !== undefined ? (pid !== null ? String(pid) : null) : null,
      tid !== undefined ? (tid !== null ? String(tid) : null) : null,
      is_billable !== undefined ? is_billable : null,
      billing_notes !== undefined ? billing_notes : null,
      id
    ]);
  }

  const updatedResult = await req.db.query(`
    SELECT te.*, c.name as candidate_name, c.hourly_rate,
           p.name as project_name, pt.name as task_name
    FROM time_entries te
    JOIN candidates c ON te.candidate_id = c.id
    LEFT JOIN projects p ON p.id = te.project_id
    LEFT JOIN project_tasks pt ON pt.id = te.task_id
    WHERE te.id = $1
  `, [id]);
  res.json(updatedResult.rows[0]);
});

// DELETE /api/time-entries/:id
router.delete('/:id', authenticate, injectTenantDb, async (req, res) => {
  const id = parseInt(req.params.id);
  const entryResult = await req.db.query('SELECT * FROM time_entries WHERE id = $1', [id]);
  const entry = entryResult.rows[0];
  if (!entry) return res.status(404).json({ error: 'Time entry not found' });

  if (req.user.role === 'candidate') {
    if (entry.candidate_id !== req.user.candidateId) return res.status(403).json({ error: 'Access denied' });
    if (entry.status !== 'pending') return res.status(400).json({ error: 'Cannot delete approved entries' });
  }

  await req.db.query('DELETE FROM time_entries WHERE id = $1', [id]);
  res.json({ message: 'Time entry deleted' });
});

// POST /api/time-entries/bulk-approve — Admin only
router.post('/bulk-approve', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  const { ids, status } = req.body;
  if (!ids || !Array.isArray(ids) || !status) {
    return res.status(400).json({ error: 'IDs array and status required' });
  }
  const approvedAt = new Date().toISOString();
  const label = status === 'approved' ? 'approved' : 'rejected';

  await req.db.transaction(async (tx) => {
    for (const id of ids) {
      const entryResult = await tx.query('SELECT * FROM time_entries WHERE id = $1', [id]);
      const entry = entryResult.rows[0];

      await tx.query('UPDATE time_entries SET status = $1, approved_by = $2, approved_at = $3 WHERE id = $4',
        [status, req.user.id, approvedAt, id]);

      // Notify candidate
      if (entry) {
        const candidateResult = await tx.query('SELECT user_id FROM candidates WHERE id = $1', [entry.candidate_id]);
        const candidate = candidateResult.rows[0];
        if (candidate) {
          createNotification(
            tx,
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
router.get('/client-pending', authenticate, injectTenantDb, async (req, res) => {
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
    const clientResult = await req.db.query('SELECT id FROM clients WHERE user_id = $1', [req.user.id]);
    const client = clientResult.rows[0];
    if (!client) return res.json([]);
    q += ' AND c.client_id = $' + (p.length + 1);
    p.push(client.id);
  }

  // Optional date filter
  if (from) { q += ' AND te.date >= $' + (p.length + 1); p.push(from); }
  if (to)   { q += ' AND te.date <= $' + (p.length + 1); p.push(to); }

  q += ' ORDER BY te.date DESC';
  const result = await req.db.query(q, p);
  res.json(result.rows);
});

// Helper — verify the client user owns the candidate linked to this entry
async function assertClientOwnsEntry(db, userId, entryId) {
  // Returns the entry if access is valid; null if forbidden
  const clientResult = await db.query('SELECT id FROM clients WHERE user_id = $1', [userId]);
  const client = clientResult.rows[0];
  if (!client) return null;
  const entryResult = await db.query(`
    SELECT te.* FROM time_entries te
    JOIN candidates c ON te.candidate_id = c.id
    WHERE te.id = $1 AND c.client_id = $2
  `, [entryId, client.id]);
  return entryResult.rows[0];
}

// POST /api/time-entries/:id/client-approve
router.post('/:id/client-approve', authenticate, injectTenantDb, async (req, res) => {
  if (req.user.role !== 'client' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { note } = req.body;
  const entryId = parseInt(req.params.id, 10);
  if (!entryId) return res.status(400).json({ error: 'Invalid entry id' });

  // Clients may only approve entries belonging to their candidates
  let entry;
  if (req.user.role === 'client') {
    entry = await assertClientOwnsEntry(req.db, req.user.id, entryId);
    if (!entry) return res.status(403).json({ error: 'Access denied — this entry does not belong to your candidates' });
  } else {
    const entryResult = await req.db.query('SELECT * FROM time_entries WHERE id = $1', [entryId]);
    entry = entryResult.rows[0];
    if (!entry) return res.status(404).json({ error: 'Time entry not found' });
  }

  if (entry.status !== 'approved') {
    return res.status(400).json({ error: 'Only admin-approved entries can be client-approved' });
  }

  await req.db.query(`
    UPDATE time_entries SET
      client_approval_status = 'approved',
      client_approval_note   = $1,
      client_approved_at     = NOW(),
      client_approved_by     = $2,
      updated_at             = NOW()
    WHERE id = $3
  `, [note || null, req.user.id, entryId]);

  const result = await req.db.query('SELECT * FROM time_entries WHERE id = $1', [entryId]);
  res.json(result.rows[0]);
});

// POST /api/time-entries/:id/client-reject
router.post('/:id/client-reject', authenticate, injectTenantDb, async (req, res) => {
  if (req.user.role !== 'client' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { note } = req.body;
  if (!note || !note.trim()) return res.status(400).json({ error: 'A note is required when rejecting' });
  const entryId = parseInt(req.params.id, 10);
  if (!entryId) return res.status(400).json({ error: 'Invalid entry id' });

  let entry;
  if (req.user.role === 'client') {
    entry = await assertClientOwnsEntry(req.db, req.user.id, entryId);
    if (!entry) return res.status(403).json({ error: 'Access denied — this entry does not belong to your candidates' });
  } else {
    const entryResult = await req.db.query('SELECT * FROM time_entries WHERE id = $1', [entryId]);
    entry = entryResult.rows[0];
    if (!entry) return res.status(404).json({ error: 'Time entry not found' });
  }

  if (entry.status !== 'approved') {
    return res.status(400).json({ error: 'Only admin-approved entries can be client-rejected' });
  }

  await req.db.query(`
    UPDATE time_entries SET
      client_approval_status = 'rejected',
      client_approval_note   = $1,
      client_approved_at     = NOW(),
      client_approved_by     = $2,
      updated_at             = NOW()
    WHERE id = $3
  `, [note.trim(), req.user.id, entryId]);

  const result = await req.db.query('SELECT * FROM time_entries WHERE id = $1', [entryId]);
  res.json(result.rows[0]);
});

module.exports = router;

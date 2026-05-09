/**
 * Rate Cards API — Consulting billing rate management
 *
 * Rate priority (highest wins): person > project > role > client_default
 *
 * Routes:
 *   GET    /api/rate-cards              — list all rate cards
 *   POST   /api/rate-cards              — create rate card
 *   PUT    /api/rate-cards/:id          — update rate card
 *   DELETE /api/rate-cards/:id          — delete rate card
 *   GET    /api/rate-cards/resolve      — resolve the effective rate for a person/project/date
 */

const express = require('express');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');

const router = express.Router();

function clean(v) { return v === undefined ? null : (v === '' ? null : v); }
function cleanNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}
function cleanInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

// GET /api/rate-cards
router.get('/', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const { client_id, project_id, candidate_id } = req.query;
    let sql = `
      SELECT rc.*,
             ca.name  AS candidate_name,
             cl.name  AS client_name,
             pr.name  AS project_name
      FROM rate_cards rc
      LEFT JOIN candidates ca ON ca.id = rc.candidate_id
      LEFT JOIN clients    cl ON cl.id = rc.client_id
      LEFT JOIN projects   pr ON pr.id = rc.project_id
      WHERE 1=1
    `;
    const params = [];
    if (client_id)    { params.push(parseInt(client_id, 10));    sql += ` AND rc.client_id = $${params.length}`; }
    if (project_id)   { params.push(parseInt(project_id, 10));   sql += ` AND rc.project_id = $${params.length}`; }
    if (candidate_id) { params.push(parseInt(candidate_id, 10)); sql += ` AND rc.candidate_id = $${params.length}`; }
    sql += ' ORDER BY rc.effective_from DESC, rc.rate_type';

    const result = await req.db.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rate-cards/resolve?candidate_id=&project_id=&date=
// Returns the single effective bill_rate for a given context
router.get('/resolve', authenticate, injectTenantDb, async (req, res) => {
  try {
    const { candidate_id, project_id, date } = req.query;
    if (!candidate_id) return res.status(400).json({ error: 'candidate_id is required' });

    const effectiveDate = date || new Date().toISOString().slice(0, 10);
    const cid = parseInt(candidate_id, 10);
    const pid = project_id ? parseInt(project_id, 10) : null;

    // Get candidate's client_id and role for fallback
    const candResult = await req.db.query(
      'SELECT client_id, role, hourly_rate FROM candidates WHERE id = $1',
      [cid]
    );
    const candidate = candResult.rows[0];
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

    const clientId = candidate.client_id;

    // Try rate cards in priority order:
    // 1. person + project
    // 2. person (any project)
    // 3. project (any person)
    // 4. role match for this project
    // 5. client_default
    // 6. candidate.hourly_rate fallback
    const queries = [
      // 1. person+project specific
      pid ? [
        `SELECT bill_rate, cost_rate, 'person_project' AS source
         FROM rate_cards
         WHERE candidate_id=$1 AND project_id=$2
           AND effective_from <= $3
           AND (effective_to IS NULL OR effective_to >= $3)
         ORDER BY effective_from DESC LIMIT 1`,
        [cid, pid, effectiveDate]
      ] : null,
      // 2. person (any project)
      [
        `SELECT bill_rate, cost_rate, 'person' AS source
         FROM rate_cards
         WHERE candidate_id=$1 AND project_id IS NULL AND rate_type='person'
           AND effective_from <= $2
           AND (effective_to IS NULL OR effective_to >= $2)
         ORDER BY effective_from DESC LIMIT 1`,
        [cid, effectiveDate]
      ],
      // 3. project default (no candidate)
      pid ? [
        `SELECT bill_rate, cost_rate, 'project' AS source
         FROM rate_cards
         WHERE project_id=$1 AND candidate_id IS NULL AND rate_type='project'
           AND effective_from <= $2
           AND (effective_to IS NULL OR effective_to >= $2)
         ORDER BY effective_from DESC LIMIT 1`,
        [pid, effectiveDate]
      ] : null,
      // 4. role match
      [
        `SELECT bill_rate, cost_rate, 'role' AS source
         FROM rate_cards
         WHERE role_name = $1 AND rate_type='role'
           AND effective_from <= $2
           AND (effective_to IS NULL OR effective_to >= $2)
         ORDER BY effective_from DESC LIMIT 1`,
        [candidate.role, effectiveDate]
      ],
      // 5. client default
      clientId ? [
        `SELECT bill_rate, cost_rate, 'client_default' AS source
         FROM rate_cards
         WHERE client_id=$1 AND rate_type='client_default'
           AND effective_from <= $2
           AND (effective_to IS NULL OR effective_to >= $2)
         ORDER BY effective_from DESC LIMIT 1`,
        [clientId, effectiveDate]
      ] : null
    ].filter(Boolean);

    for (const [sql, params] of queries) {
      const result = await req.db.query(sql, params);
      if (result.rows[0]) {
        return res.json({
          bill_rate: result.rows[0].bill_rate,
          cost_rate: result.rows[0].cost_rate,
          source: result.rows[0].source,
          effective_date: effectiveDate
        });
      }
    }

    // Fallback to candidate's hourly_rate
    res.json({
      bill_rate: candidate.hourly_rate,
      cost_rate: null,
      source: 'candidate_default',
      effective_date: effectiveDate
    });
  } catch (err) {
    console.error('GET /rate-cards/resolve', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rate-cards
router.post('/', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const {
      name, rate_type, candidate_id, client_id, project_id,
      role_name, bill_rate, cost_rate, overtime_bill_rate,
      currency, effective_from, effective_to, notes
    } = req.body;

    if (!name || !rate_type || !bill_rate) {
      return res.status(400).json({ error: 'name, rate_type and bill_rate are required' });
    }

    const result = await req.db.query(`
      INSERT INTO rate_cards (
        name, rate_type, candidate_id, client_id, project_id,
        role_name, bill_rate, cost_rate, overtime_bill_rate,
        currency, effective_from, effective_to, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
    `, [
      name.trim(), rate_type,
      cleanInt(candidate_id), cleanInt(client_id), cleanInt(project_id),
      clean(role_name), cleanNum(bill_rate), cleanNum(cost_rate), cleanNum(overtime_bill_rate),
      currency || 'USD',
      effective_from || new Date().toISOString().slice(0, 10),
      clean(effective_to),
      clean(notes)
    ]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /rate-cards', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/rate-cards/:id
router.put('/:id', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const {
      name, rate_type, candidate_id, client_id, project_id,
      role_name, bill_rate, cost_rate, overtime_bill_rate,
      currency, effective_from, effective_to, notes
    } = req.body;

    const result = await req.db.query(`
      UPDATE rate_cards SET
        name = COALESCE($1, name),
        rate_type = COALESCE($2, rate_type),
        candidate_id = $3,
        client_id = $4,
        project_id = $5,
        role_name = $6,
        bill_rate = COALESCE($7, bill_rate),
        cost_rate = $8,
        overtime_bill_rate = $9,
        currency = COALESCE($10, currency),
        effective_from = COALESCE($11, effective_from),
        effective_to = $12,
        notes = $13,
        updated_at = NOW()
      WHERE id = $14
      RETURNING *
    `, [
      name ? name.trim() : null, rate_type || null,
      cleanInt(candidate_id), cleanInt(client_id), cleanInt(project_id),
      clean(role_name), cleanNum(bill_rate), cleanNum(cost_rate), cleanNum(overtime_bill_rate),
      currency || null,
      effective_from || null, clean(effective_to), clean(notes),
      id
    ]);

    if (!result.rows[0]) return res.status(404).json({ error: 'Rate card not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /rate-cards/:id', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/rate-cards/:id
router.delete('/:id', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    await req.db.query('DELETE FROM rate_cards WHERE id = $1', [id]);
    res.json({ message: 'Rate card deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

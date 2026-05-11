/**
 * Custom Fields API — /api/custom-fields
 *
 * Tenant admins can define up to 10 custom fields per tenant.
 * Fields appear on all employee data-entry forms and in bulk-import CSV templates.
 *
 * Field types: text | rich_text | number | date | select | radio | checkbox | multi_checkbox
 */

const express = require('express');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, injectTenantDb);

// ── Constants ─────────────────────────────────────────────────────────────────
const MAX_FIELDS  = 10;
const VALID_TYPES = ['text', 'rich_text', 'number', 'date', 'select', 'radio', 'checkbox', 'multi_checkbox'];
const OPTION_TYPES = ['select', 'radio', 'multi_checkbox']; // types that need options[]

// ── Validation ────────────────────────────────────────────────────────────────
function validateFieldDef({ label, field_type, options = [], validation = {}, formula, field_key }) {
  if (!label?.trim())                return 'label is required';
  if (label.length > 100)            return 'label must be 100 characters or fewer';
  if (!VALID_TYPES.includes(field_type))
    return `field_type must be one of: ${VALID_TYPES.join(', ')}`;

  if (field_key && !/^[a-z][a-z0-9_]{0,49}$/.test(field_key))
    return 'field_key must start with a lowercase letter and contain only lowercase letters, numbers, and underscores (max 50 chars)';

  if (OPTION_TYPES.includes(field_type)) {
    if (!Array.isArray(options) || options.length === 0)
      return `options array is required for field type "${field_type}"`;
    for (const opt of options) {
      if (!opt.label?.trim() || !opt.value?.trim())
        return 'each option must have a non-empty label and value';
    }
  }

  if (validation !== null && typeof validation !== 'object') return 'validation must be an object';
  if (formula    && typeof formula !== 'string')             return 'formula must be a string';
  return null;
}

// ── Generate a unique field_key from a label ──────────────────────────────────
async function generateKey(db, label, excludeId = null) {
  const base = label.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 44) || 'field';

  const q = excludeId
    ? await db.query("SELECT field_key FROM employee_custom_field_defs WHERE field_key LIKE $1 AND id != $2", [`${base}%`, excludeId])
    : await db.query("SELECT field_key FROM employee_custom_field_defs WHERE field_key LIKE $1",               [`${base}%`]);

  const taken = new Set(q.rows.map(r => r.field_key));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

// ── GET /api/custom-fields — list all (admin sees inactive too) ───────────────
router.get('/', async (req, res) => {
  try {
    const query = req.user.role === 'admin'
      ? 'SELECT * FROM employee_custom_field_defs ORDER BY display_order ASC, id ASC'
      : 'SELECT * FROM employee_custom_field_defs WHERE is_active = TRUE ORDER BY display_order ASC, id ASC';
    const result = await req.db.query(query);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/custom-fields/active — active fields only (used by forms/imports) ──
router.get('/active', async (req, res) => {
  try {
    const result = await req.db.query(
      'SELECT * FROM employee_custom_field_defs WHERE is_active = TRUE ORDER BY display_order ASC, id ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/custom-fields — create (admin only) ────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  try {
    const {
      label, field_type = 'text', options = [], validation = {},
      formula, placeholder, help_text, field_key,
    } = req.body;

    const validErr = validateFieldDef({ label, field_type, options, validation, formula, field_key });
    if (validErr) return res.status(400).json({ error: validErr });

    // Enforce max 10 active fields
    const countResult = await req.db.query(
      "SELECT COUNT(*) FROM employee_custom_field_defs WHERE is_active = TRUE"
    );
    if (parseInt(countResult.rows[0].count) >= MAX_FIELDS) {
      return res.status(400).json({ error: `Maximum ${MAX_FIELDS} custom fields allowed per tenant. Deactivate an existing field first.` });
    }

    // Determine key
    let key = field_key?.trim();
    if (!key) {
      key = await generateKey(req.db, label);
    } else {
      const dupCheck = await req.db.query(
        'SELECT 1 FROM employee_custom_field_defs WHERE field_key = $1', [key]
      );
      if (dupCheck.rows.length > 0)
        return res.status(400).json({ error: `field_key "${key}" already exists` });
    }

    // Next display_order
    const orderRes = await req.db.query(
      'SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM employee_custom_field_defs'
    );
    const display_order = parseInt(orderRes.rows[0].next);

    const result = await req.db.query(
      `INSERT INTO employee_custom_field_defs
         (field_key, label, field_type, options, validation, formula, placeholder, help_text, display_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        key,
        label.trim(),
        field_type,
        JSON.stringify(options),
        JSON.stringify(validation),
        formula  || null,
        placeholder || null,
        help_text   || null,
        display_order,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/custom-fields/:id — update (admin only) ─────────────────────────
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await req.db.query(
      'SELECT * FROM employee_custom_field_defs WHERE id = $1', [id]
    );
    if (!existing.rows[0]) return res.status(404).json({ error: 'Custom field not found' });
    const ex = existing.rows[0];

    // Merge provided fields with existing values
    const label       = req.body.label       ?? ex.label;
    const field_type  = req.body.field_type  ?? ex.field_type;
    const options     = req.body.options     ?? ex.options;
    const validation  = req.body.validation  ?? ex.validation;
    const formula     = req.body.formula     !== undefined ? req.body.formula     : ex.formula;
    const placeholder = req.body.placeholder !== undefined ? req.body.placeholder : ex.placeholder;
    const help_text   = req.body.help_text   !== undefined ? req.body.help_text   : ex.help_text;
    const is_active   = req.body.is_active   !== undefined ? req.body.is_active   : ex.is_active;

    // If re-activating, check max limit
    if (is_active && !ex.is_active) {
      const countResult = await req.db.query(
        "SELECT COUNT(*) FROM employee_custom_field_defs WHERE is_active = TRUE AND id != $1", [id]
      );
      if (parseInt(countResult.rows[0].count) >= MAX_FIELDS) {
        return res.status(400).json({ error: `Cannot re-activate: maximum ${MAX_FIELDS} active custom fields allowed` });
      }
    }

    const validErr = validateFieldDef({ label, field_type, options, validation, formula });
    if (validErr) return res.status(400).json({ error: validErr });

    const result = await req.db.query(
      `UPDATE employee_custom_field_defs
       SET label=$1, field_type=$2, options=$3, validation=$4, formula=$5,
           placeholder=$6, help_text=$7, is_active=$8, updated_at=NOW()
       WHERE id=$9
       RETURNING *`,
      [label, field_type, JSON.stringify(options), JSON.stringify(validation),
       formula, placeholder, help_text, is_active, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/custom-fields/:id — soft-delete (set is_active = FALSE) ──────
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await req.db.query(
      'UPDATE employee_custom_field_defs SET is_active=FALSE, updated_at=NOW() WHERE id=$1 RETURNING id',
      [id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Custom field not found' });
    res.json({ message: 'Custom field deactivated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/custom-fields/reorder — bulk display_order update ─────────────
router.patch('/reorder', requireAdmin, async (req, res) => {
  try {
    const { order } = req.body; // [{ id, display_order }, ...]
    if (!Array.isArray(order) || order.length === 0)
      return res.status(400).json({ error: 'order must be a non-empty array of { id, display_order }' });

    await req.db.query('BEGIN');
    for (const { id, display_order } of order) {
      await req.db.query(
        'UPDATE employee_custom_field_defs SET display_order=$1, updated_at=NOW() WHERE id=$2',
        [display_order, id]
      );
    }
    await req.db.query('COMMIT');

    const result = await req.db.query(
      'SELECT * FROM employee_custom_field_defs ORDER BY display_order ASC, id ASC'
    );
    res.json(result.rows);
  } catch (err) {
    await req.db.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/custom-fields/employee/:employeeId/values ──────────────────────
// Legacy alias: /candidate/:employeeId/values still works for backward compat
router.get(['/employee/:employeeId/values', '/candidate/:employeeId/values'], async (req, res) => {
  try {
    const employeeId = parseInt(req.params.employeeId);
    if (req.user.role !== 'admin' && req.user.employeeId !== employeeId)
      return res.status(403).json({ error: 'Access denied' });

    const result = await req.db.query(
      `SELECT v.field_key, v.value_text, v.value_json, v.updated_at,
              d.label, d.field_type, d.options, d.validation, d.formula,
              d.placeholder, d.help_text, d.display_order
       FROM   employee_custom_field_values v
       JOIN   employee_custom_field_defs   d ON d.field_key = v.field_key
       WHERE  v.candidate_id = $1 AND d.is_active = TRUE
       ORDER  BY d.display_order ASC, d.id ASC`,
      [employeeId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/custom-fields/employee/:employeeId/values — upsert values ──────
// Legacy alias: /candidate/:employeeId/values still works for backward compat
router.put(['/employee/:employeeId/values', '/candidate/:employeeId/values'], async (req, res) => {
  try {
    const employeeId = parseInt(req.params.employeeId);
    if (req.user.role !== 'admin' && req.user.employeeId !== employeeId)
      return res.status(403).json({ error: 'Access denied' });

    const { values } = req.body; // [{ field_key, value }]
    if (!Array.isArray(values))
      return res.status(400).json({ error: 'values must be an array of { field_key, value }' });

    // Verify candidate belongs to this tenant
    const candCheck = await req.db.query('SELECT id FROM employees WHERE id = $1', [employeeId]);
    if (!candCheck.rows[0]) return res.status(404).json({ error: 'Candidate not found' });

    // Load active field defs for validation
    const defsResult = await req.db.query(
      'SELECT field_key, field_type, validation FROM employee_custom_field_defs WHERE is_active = TRUE'
    );
    const defsByKey = {};
    defsResult.rows.forEach(d => { defsByKey[d.field_key] = d; });

    await req.db.query('BEGIN');
    for (const { field_key, value } of values) {
      if (!defsByKey[field_key]) continue; // Ignore unknown/inactive fields
      const def     = defsByKey[field_key];
      const isJson  = ['select', 'radio', 'checkbox', 'multi_checkbox'].includes(def.field_type);
      await req.db.query(
        `INSERT INTO employee_custom_field_values (candidate_id, field_key, value_text, value_json, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (candidate_id, field_key) DO UPDATE
           SET value_text = EXCLUDED.value_text,
               value_json = EXCLUDED.value_json,
               updated_at  = NOW()`,
        [
          employeeId,
          field_key,
          isJson ? null : (value == null ? null : String(value)),
          isJson ? (value == null ? null : JSON.stringify(value)) : null,
        ]
      );
    }
    await req.db.query('COMMIT');
    res.json({ message: 'Custom field values saved successfully' });
  } catch (err) {
    await req.db.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

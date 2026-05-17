/**
 * Custom Fields API — /api/custom-fields
 *
 * Multi-module: each module gets up to 10 independent custom fields.
 * Supported modules: employees, timesheets, absences, invoices, clients,
 *                    projects, expenses, contractors, jobs
 *
 * Field types: text | textarea | number | currency | select | multiselect |
 *              checkbox | date | datetime | lookup | formula
 *
 * Routes:
 *   GET    /api/custom-fields/:module/defs              — list defs for module
 *   POST   /api/custom-fields/:module/defs              — create def (admin)
 *   PATCH  /api/custom-fields/:module/defs/reorder      — bulk reorder (admin)
 *   PUT    /api/custom-fields/:module/defs/:id          — update def (admin)
 *   DELETE /api/custom-fields/:module/defs/:id          — deactivate def (admin)
 *   GET    /api/custom-fields/:module/:recordId/values  — get values for record
 *   PUT    /api/custom-fields/:module/:recordId/values  — upsert values for record
 *   GET    /api/custom-fields/lookup-options/:target    — dropdown options for lookup fields
 *   GET    /api/custom-fields/report                    — cross-module field report
 *
 * Backward-compat aliases (map to employees module):
 *   GET    /api/custom-fields/           → employees defs
 *   GET    /api/custom-fields/active     → employees active defs
 *   POST   /api/custom-fields/           → create employees def
 *   PUT    /api/custom-fields/:id        → update employees def (numeric id only)
 *   DELETE /api/custom-fields/:id        → deactivate employees def
 *   PATCH  /api/custom-fields/reorder    → reorder employees defs
 *   GET    /api/custom-fields/employee/:id/values
 *   PUT    /api/custom-fields/employee/:id/values
 *   GET    /api/custom-fields/candidate/:id/values   (legacy alias)
 *   PUT    /api/custom-fields/candidate/:id/values   (legacy alias)
 */

const express = require('express');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, injectTenantDb);

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_FIELDS = 10;

const VALID_MODULES = new Set([
  'employees', 'timesheets', 'absences', 'invoices',
  'clients', 'projects', 'expenses', 'contractors', 'jobs',
]);

const VALID_TYPES = new Set([
  'text', 'textarea', 'number', 'currency',
  'select', 'multiselect', 'checkbox',
  'date', 'datetime', 'lookup', 'formula',
]);

const OPTION_TYPES = new Set(['select', 'multiselect']);

// Maps module name → its primary table and display/value fields for lookup
const MODULE_LOOKUP = {
  employees:   { table: 'employees',    displayField: 'name',         valueField: 'id' },
  clients:     { table: 'clients',      displayField: 'company_name', valueField: 'id' },
  projects:    { table: 'projects',     displayField: 'name',         valueField: 'id' },
  jobs:        { table: 'jobs',         displayField: 'title',        valueField: 'id' },
  contractors: { table: 'contractors',  displayField: 'name',         valueField: 'id' },
};

// ── Shared validation ─────────────────────────────────────────────────────────

function validateFieldDef({ label, field_type, options = [], validation = {}, formula, field_key, lookup_config }) {
  if (!label?.trim())               return 'label is required';
  if (label.length > 100)           return 'label must be 100 characters or fewer';
  if (!VALID_TYPES.has(field_type)) return `field_type must be one of: ${[...VALID_TYPES].join(', ')}`;

  if (field_key && !/^[a-z][a-z0-9_]{0,49}$/.test(field_key))
    return 'field_key must start with a lowercase letter, contain only lowercase letters, numbers, and underscores (max 50 chars)';

  if (OPTION_TYPES.has(field_type)) {
    if (!Array.isArray(options) || options.length === 0)
      return `options array is required for field type "${field_type}"`;
    for (const opt of options) {
      if (!opt.label?.trim() || !opt.value?.trim())
        return 'each option must have a non-empty label and value';
    }
  }

  if (field_type === 'lookup') {
    if (!lookup_config?.module)
      return 'lookup_config.module is required for lookup fields';
    if (!MODULE_LOOKUP[lookup_config.module])
      return `lookup_config.module must be one of: ${Object.keys(MODULE_LOOKUP).join(', ')}`;
  }

  if (validation !== null && typeof validation !== 'object') return 'validation must be an object';
  if (formula && typeof formula !== 'string')                 return 'formula must be a string';
  return null;
}

async function generateKey(db, module, label, excludeId = null) {
  const base = label.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 44) || 'field';

  const q = excludeId
    ? await db.query(
        'SELECT field_key FROM custom_field_defs WHERE module=$1 AND field_key LIKE $2 AND id != $3',
        [module, `${base}%`, excludeId]
      )
    : await db.query(
        'SELECT field_key FROM custom_field_defs WHERE module=$1 AND field_key LIKE $2',
        [module, `${base}%`]
      );

  const taken = new Set(q.rows.map(r => r.field_key));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

// ── Module middleware ─────────────────────────────────────────────────────────

function validateModule(req, res, next) {
  const mod = req.params.module;
  if (!VALID_MODULES.has(mod)) {
    return res.status(400).json({ error: `Invalid module "${mod}". Valid modules: ${[...VALID_MODULES].join(', ')}` });
  }
  next();
}

// ═════════════════════════════════════════════════════════════════════════════
// BACKWARD-COMPAT legacy routes (must be BEFORE /:module routes)
// Map to employees module using new tables.
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/custom-fields/  — employees defs (admin sees all, others see active)
router.get('/', async (req, res) => {
  try {
    const query = req.user.role === 'admin'
      ? 'SELECT * FROM custom_field_defs WHERE module=$1 ORDER BY display_order ASC, id ASC'
      : 'SELECT * FROM custom_field_defs WHERE module=$1 AND is_active=TRUE ORDER BY display_order ASC, id ASC';
    const result = await req.db.query(query, ['employees']);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/custom-fields/active
router.get('/active', async (req, res) => {
  try {
    const result = await req.db.query(
      'SELECT * FROM custom_field_defs WHERE module=$1 AND is_active=TRUE ORDER BY display_order ASC, id ASC',
      ['employees']
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/custom-fields/reorder  — employees
router.patch('/reorder', requireAdmin, async (req, res) => {
  return reorderDefs(req, res, 'employees');
});

// GET /api/custom-fields/report  — cross-module report
router.get('/report', requireAdmin, async (req, res) => {
  try {
    const { module: mod, fields } = req.query;
    if (!mod || !VALID_MODULES.has(mod))
      return res.status(400).json({ error: 'module query param required' });

    const fieldKeys = fields ? fields.split(',').map(f => f.trim()).filter(Boolean) : null;

    const defsRes = await req.db.query(
      'SELECT * FROM custom_field_defs WHERE module=$1 AND is_active=TRUE ORDER BY display_order ASC',
      [mod]
    );
    const defs = fieldKeys
      ? defsRes.rows.filter(d => fieldKeys.includes(d.field_key))
      : defsRes.rows;

    if (!defs.length) return res.json({ defs: [], rows: [] });

    // Fetch all values for this module
    const valsRes = await req.db.query(
      'SELECT record_id, field_key, value_text, value_json FROM custom_field_values WHERE module=$1',
      [mod]
    );

    // Group values by record_id
    const byRecord = {};
    for (const v of valsRes.rows) {
      if (!byRecord[v.record_id]) byRecord[v.record_id] = {};
      byRecord[v.record_id][v.field_key] = v.value_json !== null ? v.value_json : v.value_text;
    }

    const rows = Object.entries(byRecord).map(([recordId, vals]) => ({
      record_id: parseInt(recordId),
      ...vals,
    }));

    res.json({ defs, rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/custom-fields/lookup-options/:targetModule
router.get('/lookup-options/:targetModule', async (req, res) => {
  try {
    const { targetModule } = req.params;
    const meta = MODULE_LOOKUP[targetModule];
    if (!meta) return res.status(400).json({ error: `No lookup support for module "${targetModule}"` });

    const result = await req.db.query(
      `SELECT ${meta.valueField} AS value, ${meta.displayField} AS label
       FROM ${meta.table}
       WHERE deleted_at IS NULL OR deleted_at IS NOT NULL  -- include all; adjust per module
       ORDER BY ${meta.displayField} ASC
       LIMIT 500`
    );
    res.json(result.rows);
  } catch (err) {
    // Fallback if deleted_at doesn't exist on this table
    try {
      const meta = MODULE_LOOKUP[req.params.targetModule];
      const result = await req.db.query(
        `SELECT ${meta.valueField} AS value, ${meta.displayField} AS label
         FROM ${meta.table}
         ORDER BY ${meta.displayField} ASC LIMIT 500`
      );
      res.json(result.rows);
    } catch (err2) { res.status(500).json({ error: err2.message }); }
  }
});

// GET /api/custom-fields/employee/:id/values  (and /candidate/:id/values)
router.get(['/employee/:employeeId/values', '/candidate/:employeeId/values'], async (req, res) => {
  return getValues(req, res, 'employees', parseInt(req.params.employeeId));
});

// PUT /api/custom-fields/employee/:id/values  (and /candidate/:id/values)
router.put(['/employee/:employeeId/values', '/candidate/:employeeId/values'], async (req, res) => {
  return putValues(req, res, 'employees', parseInt(req.params.employeeId));
});

// POST /api/custom-fields/  — create employees def (legacy)
router.post('/', requireAdmin, async (req, res) => {
  return createDef(req, res, 'employees');
});

// PUT /api/custom-fields/:numericId  — update employees def (legacy; only matches integers)
router.put('/:id(\\d+)', requireAdmin, async (req, res) => {
  return updateDef(req, res, 'employees', parseInt(req.params.id));
});

// DELETE /api/custom-fields/:numericId  — deactivate employees def (legacy)
router.delete('/:id(\\d+)', requireAdmin, async (req, res) => {
  return deactivateDef(req, res, 'employees', parseInt(req.params.id));
});

// ═════════════════════════════════════════════════════════════════════════════
// MODULE-SCOPED ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/custom-fields/:module/defs
router.get('/:module/defs', validateModule, async (req, res) => {
  try {
    const { module: mod } = req.params;
    const query = req.user.role === 'admin'
      ? 'SELECT * FROM custom_field_defs WHERE module=$1 ORDER BY display_order ASC, id ASC'
      : 'SELECT * FROM custom_field_defs WHERE module=$1 AND is_active=TRUE ORDER BY display_order ASC, id ASC';
    const result = await req.db.query(query, [mod]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/custom-fields/:module/defs
router.post('/:module/defs', requireAdmin, validateModule, async (req, res) => {
  return createDef(req, res, req.params.module);
});

// PATCH /api/custom-fields/:module/defs/reorder
router.patch('/:module/defs/reorder', requireAdmin, validateModule, async (req, res) => {
  return reorderDefs(req, res, req.params.module);
});

// PUT /api/custom-fields/:module/defs/:id
router.put('/:module/defs/:id', requireAdmin, validateModule, async (req, res) => {
  return updateDef(req, res, req.params.module, parseInt(req.params.id));
});

// DELETE /api/custom-fields/:module/defs/:id
router.delete('/:module/defs/:id', requireAdmin, validateModule, async (req, res) => {
  return deactivateDef(req, res, req.params.module, parseInt(req.params.id));
});

// GET /api/custom-fields/:module/:recordId/values
router.get('/:module/:recordId/values', validateModule, async (req, res) => {
  return getValues(req, res, req.params.module, parseInt(req.params.recordId));
});

// PUT /api/custom-fields/:module/:recordId/values
router.put('/:module/:recordId/values', validateModule, async (req, res) => {
  return putValues(req, res, req.params.module, parseInt(req.params.recordId));
});

// ═════════════════════════════════════════════════════════════════════════════
// SHARED HANDLER FUNCTIONS
// ═════════════════════════════════════════════════════════════════════════════

async function createDef(req, res, mod) {
  try {
    const {
      label, field_type = 'text', options = [], validation = {},
      formula, placeholder, help_text, field_key, lookup_config,
    } = req.body;

    const validErr = validateFieldDef({ label, field_type, options, validation, formula, field_key, lookup_config });
    if (validErr) return res.status(400).json({ error: validErr });

    // Enforce max 10 active fields per module
    const countRes = await req.db.query(
      'SELECT COUNT(*) FROM custom_field_defs WHERE module=$1 AND is_active=TRUE', [mod]
    );
    if (parseInt(countRes.rows[0].count) >= MAX_FIELDS) {
      return res.status(400).json({
        error: `Maximum ${MAX_FIELDS} custom fields allowed per module. Deactivate an existing field first.`,
      });
    }

    // Generate or validate field_key
    let key = field_key?.trim();
    if (!key) {
      key = await generateKey(req.db, mod, label);
    } else {
      const dup = await req.db.query(
        'SELECT 1 FROM custom_field_defs WHERE module=$1 AND field_key=$2', [mod, key]
      );
      if (dup.rows.length) return res.status(400).json({ error: `field_key "${key}" already exists for this module` });
    }

    const orderRes = await req.db.query(
      'SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM custom_field_defs WHERE module=$1', [mod]
    );
    const display_order = parseInt(orderRes.rows[0].next);

    const result = await req.db.query(
      `INSERT INTO custom_field_defs
         (module, field_key, label, field_type, options, lookup_config, formula,
          placeholder, help_text, validation, display_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        mod, key, label.trim(), field_type,
        JSON.stringify(options),
        lookup_config ? JSON.stringify(lookup_config) : null,
        formula || null,
        placeholder || null,
        help_text   || null,
        JSON.stringify(validation),
        display_order,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function updateDef(req, res, mod, id) {
  try {
    const existing = await req.db.query(
      'SELECT * FROM custom_field_defs WHERE id=$1 AND module=$2', [id, mod]
    );
    if (!existing.rows[0]) return res.status(404).json({ error: 'Custom field not found' });
    const ex = existing.rows[0];

    const label        = req.body.label        ?? ex.label;
    const field_type   = req.body.field_type   ?? ex.field_type;
    const options      = req.body.options      ?? ex.options;
    const validation   = req.body.validation   ?? ex.validation;
    const formula      = req.body.formula      !== undefined ? req.body.formula      : ex.formula;
    const placeholder  = req.body.placeholder  !== undefined ? req.body.placeholder  : ex.placeholder;
    const help_text    = req.body.help_text    !== undefined ? req.body.help_text    : ex.help_text;
    const lookup_config = req.body.lookup_config !== undefined ? req.body.lookup_config : ex.lookup_config;
    const is_active    = req.body.is_active    !== undefined ? req.body.is_active    : ex.is_active;

    // Re-activation limit check
    if (is_active && !ex.is_active) {
      const countRes = await req.db.query(
        'SELECT COUNT(*) FROM custom_field_defs WHERE module=$1 AND is_active=TRUE AND id!=$2', [mod, id]
      );
      if (parseInt(countRes.rows[0].count) >= MAX_FIELDS) {
        return res.status(400).json({ error: `Cannot re-activate: maximum ${MAX_FIELDS} active fields per module` });
      }
    }

    const validErr = validateFieldDef({ label, field_type, options, validation, formula, lookup_config });
    if (validErr) return res.status(400).json({ error: validErr });

    const result = await req.db.query(
      `UPDATE custom_field_defs SET
         label=$1, field_type=$2, options=$3, lookup_config=$4, formula=$5,
         placeholder=$6, help_text=$7, validation=$8, is_active=$9, updated_at=NOW()
       WHERE id=$10 AND module=$11
       RETURNING *`,
      [
        label, field_type,
        JSON.stringify(options),
        lookup_config ? JSON.stringify(lookup_config) : null,
        formula, placeholder, help_text,
        JSON.stringify(validation),
        is_active, id, mod,
      ]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function deactivateDef(req, res, mod, id) {
  try {
    const result = await req.db.query(
      'UPDATE custom_field_defs SET is_active=FALSE, updated_at=NOW() WHERE id=$1 AND module=$2 RETURNING id',
      [id, mod]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Custom field not found' });
    res.json({ message: 'Custom field deactivated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function reorderDefs(req, res, mod) {
  try {
    const { order } = req.body;
    if (!Array.isArray(order) || !order.length)
      return res.status(400).json({ error: 'order must be a non-empty array of { id, display_order }' });

    await req.db.query('BEGIN');
    for (const { id, display_order } of order) {
      await req.db.query(
        'UPDATE custom_field_defs SET display_order=$1, updated_at=NOW() WHERE id=$2 AND module=$3',
        [display_order, id, mod]
      );
    }
    await req.db.query('COMMIT');

    const result = await req.db.query(
      'SELECT * FROM custom_field_defs WHERE module=$1 ORDER BY display_order ASC, id ASC', [mod]
    );
    res.json(result.rows);
  } catch (err) {
    await req.db.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  }
}

async function getValues(req, res, mod, recordId) {
  try {
    // Authorization: admin can read all; employees can only read their own
    if (req.user.role !== 'admin' && mod === 'employees' && req.user.employeeId !== recordId)
      return res.status(403).json({ error: 'Access denied' });

    const result = await req.db.query(
      `SELECT v.field_key, v.value_text, v.value_json, v.updated_at,
              d.label, d.field_type, d.options, d.lookup_config, d.formula,
              d.placeholder, d.help_text, d.validation, d.display_order
       FROM   custom_field_values v
       JOIN   custom_field_defs   d ON d.module=v.module AND d.field_key=v.field_key
       WHERE  v.module=$1 AND v.record_id=$2 AND d.is_active=TRUE
       ORDER  BY d.display_order ASC, d.id ASC`,
      [mod, recordId]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function putValues(req, res, mod, recordId) {
  try {
    // Authorization
    if (req.user.role !== 'admin' && mod === 'employees' && req.user.employeeId !== recordId)
      return res.status(403).json({ error: 'Access denied' });

    const { values } = req.body;
    if (!Array.isArray(values))
      return res.status(400).json({ error: 'values must be an array of { field_key, value }' });

    // Load active defs for this module
    const defsRes = await req.db.query(
      'SELECT field_key, field_type FROM custom_field_defs WHERE module=$1 AND is_active=TRUE', [mod]
    );
    const defsByKey = {};
    defsRes.rows.forEach(d => { defsByKey[d.field_key] = d; });

    const JSON_TYPES = new Set(['select', 'multiselect', 'checkbox', 'lookup']);

    await req.db.query('BEGIN');
    for (const { field_key, value } of values) {
      if (!defsByKey[field_key]) continue;
      const def    = defsByKey[field_key];
      const isJson = JSON_TYPES.has(def.field_type);

      await req.db.query(
        `INSERT INTO custom_field_values (module, record_id, field_key, value_text, value_json, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (module, record_id, field_key) DO UPDATE
           SET value_text=EXCLUDED.value_text, value_json=EXCLUDED.value_json, updated_at=NOW()`,
        [
          mod, recordId, field_key,
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
}

module.exports = router;

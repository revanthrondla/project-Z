/**
 * aGrow API Routes
 * /api/agrow/*
 *
 * Covers: employees, products, scanned-products, scans, custom-fields,
 *         languages, analytics, and offline-sync endpoint.
 */
const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');

// All agrow routes require authentication + tenant DB
router.use(authenticate, injectTenantDb);

// ─────────────────────────────────────────────────────────────────────────────
// LANGUAGES
// ─────────────────────────────────────────────────────────────────────────────

router.get('/languages', async (req, res) => {
  try {
    const result = await req.db.query('SELECT * FROM ag_languages ORDER BY language_name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/languages', requireAdmin, async (req, res) => {
  try {
    const { language_name, language_code, is_default } = req.body;
    if (!language_name || !language_code) {
      return res.status(400).json({ error: 'language_name and language_code are required' });
    }
    if (is_default) {
      await req.db.query('UPDATE ag_languages SET is_default = FALSE');
    }
    const result = await req.db.query(
      'INSERT INTO ag_languages (language_name, language_code, is_default) VALUES ($1, $2, $3) RETURNING id',
      [language_name.trim(), language_code.toUpperCase().trim(), Boolean(is_default)]
    );
    const id = result.rows[0].id;
    const newRow = await req.db.query('SELECT * FROM ag_languages WHERE id = $1', [id]);
    res.status(201).json(newRow.rows[0]);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Language code already exists' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/languages/:id', requireAdmin, async (req, res) => {
  try {
    const { language_name, language_code, is_default } = req.body;
    if (is_default) await req.db.query('UPDATE ag_languages SET is_default = FALSE');
    await req.db.query(`
      UPDATE ag_languages SET
        language_name = COALESCE($1, language_name),
        language_code = COALESCE($2, language_code),
        is_default    = COALESCE($3, is_default)
      WHERE id = $4
    `, [language_name || null, language_code?.toUpperCase() || null, is_default != null ? Boolean(is_default) : null, req.params.id]);
    const result = await req.db.query('SELECT * FROM ag_languages WHERE id = $1', [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/languages/:id', requireAdmin, async (req, res) => {
  try {
    await req.db.query('DELETE FROM ag_languages WHERE id = $1', [req.params.id]);
    res.json({ message: 'Language removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM FIELDS
// ─────────────────────────────────────────────────────────────────────────────

router.get('/custom-fields', async (req, res) => {
  try {
    const result = await req.db.query('SELECT * FROM ag_custom_field_definitions ORDER BY sort_order, field_name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/custom-fields', requireAdmin, async (req, res) => {
  try {
    const { field_name, field_type, applies_to, options, required, sort_order } = req.body;
    if (!field_name || !field_type) {
      return res.status(400).json({ error: 'field_name and field_type are required' });
    }
    const VALID_TYPES = ['text','number','dropdown','date','time','boolean','image'];
    if (!VALID_TYPES.includes(field_type)) {
      return res.status(400).json({ error: `field_type must be one of: ${VALID_TYPES.join(', ')}` });
    }
    const result = await req.db.query(`
      INSERT INTO ag_custom_field_definitions (field_name, field_type, applies_to, options, required, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
    `, [
      field_name.trim(), field_type, applies_to || 'all',
      options ? JSON.stringify(options) : null,
      required ? true : false, sort_order || 0
    ]);
    const id = result.rows[0].id;
    const newRow = await req.db.query('SELECT * FROM ag_custom_field_definitions WHERE id = $1', [id]);
    res.status(201).json(newRow.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/custom-fields/:id', requireAdmin, async (req, res) => {
  try {
    const { field_name, field_type, applies_to, options, required, sort_order } = req.body;
    await req.db.query(`
      UPDATE ag_custom_field_definitions SET
        field_name = COALESCE($1, field_name),
        field_type = COALESCE($2, field_type),
        applies_to = COALESCE($3, applies_to),
        options    = COALESCE($4, options),
        required   = COALESCE($5, required),
        sort_order = COALESCE($6, sort_order)
      WHERE id = $7
    `, [
      field_name || null, field_type || null, applies_to || null,
      options ? JSON.stringify(options) : null,
      required != null ? (required ? true : false) : null,
      sort_order != null ? sort_order : null,
      req.params.id
    ]);
    const result = await req.db.query('SELECT * FROM ag_custom_field_definitions WHERE id = $1', [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/custom-fields/:id', requireAdmin, async (req, res) => {
  try {
    await req.db.query('DELETE FROM ag_custom_field_definitions WHERE id = $1', [req.params.id]);
    res.json({ message: 'Custom field removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// EMPLOYEES
// ─────────────────────────────────────────────────────────────────────────────

router.get('/employees', async (req, res) => {
  try {
    const { crew, search } = req.query;
    let q = 'SELECT * FROM ag_employees WHERE 1=1';
    const p = [];
    let paramIndex = 1;
    if (crew)   { q += ` AND crew_name = $${paramIndex}`; p.push(crew); paramIndex++; }
    if (search) { q += ` AND (employee_name ILIKE $${paramIndex} OR employee_number ILIKE $${paramIndex + 1})`; p.push(`%${search}%`, `%${search}%`); paramIndex += 2; }
    q += ' ORDER BY employee_name';
    const result = await req.db.query(q, p);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/employees/:id', async (req, res) => {
  try {
    const result = await req.db.query('SELECT * FROM ag_employees WHERE id = $1', [req.params.id]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'Employee not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/employees', requireAdmin, async (req, res) => {
  try {
    const {
      employee_name, employee_number, crew_name, entity_name, ranch,
      badge_number, email, gender, start_date, end_date, custom_fields
    } = req.body;
    if (!employee_name || !employee_number) {
      return res.status(400).json({ error: 'employee_name and employee_number are required' });
    }
    const result = await req.db.query(`
      INSERT INTO ag_employees
        (employee_name, employee_number, crew_name, entity_name, ranch,
         badge_number, email, gender, start_date, end_date, custom_fields)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id
    `, [
      employee_name.trim(), employee_number.trim(), crew_name || null,
      entity_name || null, ranch || null, badge_number || null,
      email || null, gender || null, start_date || null, end_date || null,
      JSON.stringify(custom_fields || {})
    ]);
    const id = result.rows[0].id;
    const newRow = await req.db.query('SELECT * FROM ag_employees WHERE id = $1', [id]);
    res.status(201).json(newRow.rows[0]);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Employee number already exists' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/employees/:id', requireAdmin, async (req, res) => {
  try {
    const {
      employee_name, employee_number, crew_name, entity_name, ranch,
      badge_number, email, gender, start_date, end_date, custom_fields
    } = req.body;
    await req.db.query(`
      UPDATE ag_employees SET
        employee_name   = COALESCE($1, employee_name),
        employee_number = COALESCE($2, employee_number),
        crew_name       = COALESCE($3, crew_name),
        entity_name     = COALESCE($4, entity_name),
        ranch           = COALESCE($5, ranch),
        badge_number    = COALESCE($6, badge_number),
        email           = COALESCE($7, email),
        gender          = COALESCE($8, gender),
        start_date      = COALESCE($9, start_date),
        end_date        = COALESCE($10, end_date),
        custom_fields   = COALESCE($11, custom_fields),
        updated_at      = NOW()
      WHERE id = $12
    `, [
      employee_name || null, employee_number || null, crew_name !== undefined ? crew_name : null,
      entity_name !== undefined ? entity_name : null, ranch !== undefined ? ranch : null,
      badge_number !== undefined ? badge_number : null, email !== undefined ? email : null,
      gender !== undefined ? gender : null, start_date !== undefined ? start_date : null,
      end_date !== undefined ? end_date : null,
      custom_fields ? JSON.stringify(custom_fields) : null,
      req.params.id
    ]);
    const result = await req.db.query('SELECT * FROM ag_employees WHERE id = $1', [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/employees/:id', requireAdmin, async (req, res) => {
  try {
    await req.db.query('DELETE FROM ag_employees WHERE id = $1', [req.params.id]);
    res.json({ message: 'Employee removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTS
// ─────────────────────────────────────────────────────────────────────────────

router.get('/products', async (req, res) => {
  try {
    const { commodity, ranch } = req.query;
    let q = 'SELECT * FROM ag_products WHERE 1=1';
    const p = [];
    let paramIndex = 1;
    if (commodity) { q += ` AND commodity = $${paramIndex}`; p.push(commodity); paramIndex++; }
    if (ranch)     { q += ` AND ranch = $${paramIndex}`; p.push(ranch); paramIndex++; }
    q += ' ORDER BY created_at DESC';
    const result = await req.db.query(q, p);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/products/:id', async (req, res) => {
  try {
    const result = await req.db.query('SELECT * FROM ag_products WHERE id = $1', [req.params.id]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'Product not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/products', async (req, res) => {
  try {
    const {
      commodity, ranch, entity, location, crate_count, metric,
      start_time, end_time, picking_average,
      highest_picking_speed, lowest_picking_speed, custom_fields
    } = req.body;
    const result = await req.db.query(`
      INSERT INTO ag_products
        (commodity, ranch, entity, location, crate_count, metric,
         start_time, end_time, picking_average,
         highest_picking_speed, lowest_picking_speed, custom_fields)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id
    `, [
      commodity || null, ranch || null, entity || null, location || null,
      crate_count || 0, metric || null,
      start_time || null, end_time || null, picking_average || null,
      highest_picking_speed || null, lowest_picking_speed || null,
      JSON.stringify(custom_fields || {})
    ]);
    const id = result.rows[0].id;
    const newRow = await req.db.query('SELECT * FROM ag_products WHERE id = $1', [id]);
    res.status(201).json(newRow.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/products/:id', requireAdmin, async (req, res) => {
  try {
    const {
      commodity, ranch, entity, location, crate_count, metric,
      start_time, end_time, picking_average,
      highest_picking_speed, lowest_picking_speed, custom_fields
    } = req.body;
    await req.db.query(`
      UPDATE ag_products SET
        commodity             = COALESCE($1, commodity),
        ranch                 = COALESCE($2, ranch),
        entity                = COALESCE($3, entity),
        location              = COALESCE($4, location),
        crate_count           = COALESCE($5, crate_count),
        metric                = COALESCE($6, metric),
        start_time            = COALESCE($7, start_time),
        end_time              = COALESCE($8, end_time),
        picking_average       = COALESCE($9, picking_average),
        highest_picking_speed = COALESCE($10, highest_picking_speed),
        lowest_picking_speed  = COALESCE($11, lowest_picking_speed),
        custom_fields         = COALESCE($12, custom_fields),
        updated_at            = NOW()
      WHERE id = $13
    `, [
      commodity||null, ranch||null, entity||null, location||null,
      crate_count!=null?crate_count:null, metric||null,
      start_time||null, end_time||null, picking_average||null,
      highest_picking_speed||null, lowest_picking_speed||null,
      custom_fields ? JSON.stringify(custom_fields) : null,
      req.params.id
    ]);
    const result = await req.db.query('SELECT * FROM ag_products WHERE id = $1', [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/products/:id', requireAdmin, async (req, res) => {
  try {
    await req.db.query('DELETE FROM ag_products WHERE id = $1', [req.params.id]);
    res.json({ message: 'Product removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SCANNED PRODUCTS
// ─────────────────────────────────────────────────────────────────────────────

router.get('/scanned-products', async (req, res) => {
  try {
    const { date, crew, synced } = req.query;
    let q = 'SELECT * FROM ag_scanned_products WHERE 1=1';
    const p = [];
    let paramIndex = 1;
    if (date)  { q += ` AND CAST(scanned_at AS DATE) = $${paramIndex}`; p.push(date); paramIndex++; }
    if (crew)  { q += ` AND crew_name = $${paramIndex}`; p.push(crew); paramIndex++; }
    if (synced != null) { q += ` AND synced = $${paramIndex}`; p.push(parseInt(synced) === 1); paramIndex++; }
    q += ' ORDER BY scanned_at DESC';
    const result = await req.db.query(q, p);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/scanned-products', async (req, res) => {
  try {
    const {
      product_name, quantity, unit, user_name, entity_name,
      crew_name, ranch, picking_average,
      highest_picking_speed, lowest_picking_speed,
      scanned_at, custom_fields
    } = req.body;
    if (!product_name) {
      return res.status(400).json({ error: 'product_name is required' });
    }
    const result = await req.db.query(`
      INSERT INTO ag_scanned_products
        (product_name, quantity, unit, user_name, entity_name,
         crew_name, ranch, picking_average, highest_picking_speed,
         lowest_picking_speed, scanned_at, synced, custom_fields)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id
    `, [
      product_name.trim(), quantity || 0, unit || 'items',
      user_name || (req.user.name || null),
      entity_name || null, crew_name || null, ranch || null,
      picking_average || null, highest_picking_speed || null,
      lowest_picking_speed || null,
      scanned_at || new Date().toISOString(),
      true,
      JSON.stringify(custom_fields || {})
    ]);
    const id = result.rows[0].id;
    const newRow = await req.db.query('SELECT * FROM ag_scanned_products WHERE id = $1', [id]);
    res.status(201).json(newRow.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/scanned-products/:id', requireAdmin, async (req, res) => {
  try {
    await req.db.query('DELETE FROM ag_scanned_products WHERE id = $1', [req.params.id]);
    res.json({ message: 'Scanned product removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk offline sync — accepts array of scanned products created offline
router.post('/scanned-products/sync', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array is required' });
    }

    const ids = [];
    const client = await req.db.connect();
    try {
      await client.query('BEGIN');
      for (const item of items) {
        const result = await client.query(`
          INSERT INTO ag_scanned_products
            (product_name, quantity, unit, user_name, entity_name,
             crew_name, ranch, picking_average, highest_picking_speed,
             lowest_picking_speed, scanned_at, synced, custom_fields)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id
        `, [
          item.product_name || 'Unknown', item.quantity || 0, item.unit || 'items',
          item.user_name || null, item.entity_name || null,
          item.crew_name || null, item.ranch || null,
          item.picking_average || null, item.highest_picking_speed || null,
          item.lowest_picking_speed || null,
          item.scanned_at || new Date().toISOString(),
          true,
          JSON.stringify(item.custom_fields || {})
        ]);
        ids.push(result.rows[0].id);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ message: `${ids.length} items synced`, ids });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────────────────────────────────────

router.get('/analytics', async (req, res) => {
  try {
    // Live aggregation from scanned_products
    const { from, to, crew } = req.query;

    let whereClause = 'WHERE 1=1';
    const p = [];
    let paramIndex = 1;
    if (from) { whereClause += ` AND CAST(scanned_at AS DATE) >= $${paramIndex}`; p.push(from); paramIndex++; }
    if (to)   { whereClause += ` AND CAST(scanned_at AS DATE) <= $${paramIndex}`; p.push(to); paramIndex++; }
    if (crew) { whereClause += ` AND crew_name = $${paramIndex}`; p.push(crew); paramIndex++; }

    const totalsResult = await req.db.query(`
      SELECT
        COUNT(*)                          AS total_scans,
        COALESCE(SUM(quantity), 0)        AS total_quantity,
        COUNT(DISTINCT product_name)      AS unique_products,
        COUNT(DISTINCT crew_name)         AS crew_count,
        COUNT(DISTINCT user_name)         AS worker_count
      FROM ag_scanned_products ${whereClause}
    `, p);
    const totals = totalsResult.rows[0];

    const byProductResult = await req.db.query(`
      SELECT product_name,
             SUM(quantity) AS total_quantity,
             COUNT(*)      AS scan_count
      FROM ag_scanned_products ${whereClause}
      GROUP BY product_name
      ORDER BY total_quantity DESC
    `, p);

    const byCrewResult = await req.db.query(`
      SELECT crew_name,
             SUM(quantity) AS total_quantity,
             COUNT(*)      AS scan_count
      FROM ag_scanned_products ${whereClause} AND crew_name IS NOT NULL
      GROUP BY crew_name
      ORDER BY total_quantity DESC
    `, p);

    const byDayResult = await req.db.query(`
      SELECT CAST(scanned_at AS DATE)   AS day,
             SUM(quantity)      AS total_quantity,
             COUNT(*)           AS scan_count
      FROM ag_scanned_products ${whereClause}
      GROUP BY CAST(scanned_at AS DATE)
      ORDER BY day ASC
    `, p);

    const byWorkerResult = await req.db.query(`
      SELECT user_name,
             SUM(quantity) AS total_quantity,
             COUNT(*)      AS scan_count
      FROM ag_scanned_products ${whereClause} AND user_name IS NOT NULL
      GROUP BY user_name
      ORDER BY total_quantity DESC
      LIMIT 10
    `, p);

    // Products table
    const productsResult = await req.db.query(`
      SELECT *
      FROM ag_products
      ORDER BY crate_count DESC
      LIMIT 20
    `);

    res.json({
      totals,
      byProduct: byProductResult.rows,
      byCrew: byCrewResult.rows,
      byDay: byDayResult.rows,
      byWorker: byWorkerResult.rows,
      products: productsResult.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/analytics/snapshots', requireAdmin, async (req, res) => {
  try {
    const result = await req.db.query('SELECT * FROM ag_analytics_snapshots ORDER BY snapshot_date DESC');
    const rows = result.rows;
    res.json(rows.map(r => ({
      ...r,
      harvesting_data: JSON.parse(r.harvesting_data || '{}'),
      metrics: JSON.parse(r.metrics || '{}'),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// REFERENCE DATA (dropdowns for the scan form)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/reference-data', async (req, res) => {
  try {
    const commoditiesResult = await req.db.query(
      "SELECT DISTINCT commodity FROM ag_products WHERE commodity IS NOT NULL ORDER BY commodity"
    );
    const commodities = commoditiesResult.rows.map(r => r.commodity);

    const ranchesResult = await req.db.query(
      "SELECT DISTINCT ranch FROM ag_products WHERE ranch IS NOT NULL UNION SELECT DISTINCT ranch FROM ag_employees WHERE ranch IS NOT NULL ORDER BY ranch"
    );
    const ranches = ranchesResult.rows.map(r => r.ranch);

    // UNION: column name is taken from the first SELECT ('entity').
    // The second SELECT (entity_name) is aliased to 'entity' implicitly.
    const entitiesResult = await req.db.query(
      "SELECT DISTINCT entity AS entity FROM ag_products WHERE entity IS NOT NULL " +
      "UNION SELECT DISTINCT entity_name AS entity FROM ag_employees WHERE entity_name IS NOT NULL " +
      "ORDER BY entity"
    );
    const entities = entitiesResult.rows.map(r => r.entity);

    const crewsResult = await req.db.query(
      "SELECT DISTINCT crew_name FROM ag_employees WHERE crew_name IS NOT NULL ORDER BY crew_name"
    );
    const crews = crewsResult.rows.map(r => r.crew_name);

    res.json({ commodities, ranches, entities, crews });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

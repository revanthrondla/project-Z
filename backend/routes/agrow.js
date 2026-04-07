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
    const rows = await req.db.prepare('SELECT * FROM ag_languages ORDER BY language_name').all();
    res.json(rows);
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
      await req.db.prepare('UPDATE ag_languages SET is_default = 0').run();
    }
    const r = await req.db.prepare(
      'INSERT INTO ag_languages (language_name, language_code, is_default) VALUES (?, ?, ?)'
    ).run(language_name.trim(), language_code.toUpperCase().trim(), is_default ? 1 : 0);
    res.status(201).json(await req.db.prepare('SELECT * FROM ag_languages WHERE id = ?').get(r.lastInsertRowid));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Language code already exists' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/languages/:id', requireAdmin, async (req, res) => {
  try {
    const { language_name, language_code, is_default } = req.body;
    if (is_default) await req.db.prepare('UPDATE ag_languages SET is_default = 0').run();
    await req.db.prepare(`
      UPDATE ag_languages SET
        language_name = COALESCE(?, language_name),
        language_code = COALESCE(?, language_code),
        is_default    = COALESCE(?, is_default)
      WHERE id = ?
    `).run(language_name || null, language_code?.toUpperCase() || null, is_default != null ? (is_default ? 1 : 0) : null, req.params.id);
    res.json(await req.db.prepare('SELECT * FROM ag_languages WHERE id = ?').get(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/languages/:id', requireAdmin, async (req, res) => {
  try {
    await req.db.prepare('DELETE FROM ag_languages WHERE id = ?').run(req.params.id);
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
    const rows = await req.db.prepare('SELECT * FROM ag_custom_field_definitions ORDER BY sort_order, field_name').all();
    res.json(rows);
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
    const r = await req.db.prepare(`
      INSERT INTO ag_custom_field_definitions (field_name, field_type, applies_to, options, required, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      field_name.trim(), field_type, applies_to || 'all',
      options ? JSON.stringify(options) : null,
      required ? 1 : 0, sort_order || 0
    );
    res.status(201).json(await req.db.prepare('SELECT * FROM ag_custom_field_definitions WHERE id = ?').get(r.lastInsertRowid));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/custom-fields/:id', requireAdmin, async (req, res) => {
  try {
    const { field_name, field_type, applies_to, options, required, sort_order } = req.body;
    await req.db.prepare(`
      UPDATE ag_custom_field_definitions SET
        field_name = COALESCE(?, field_name),
        field_type = COALESCE(?, field_type),
        applies_to = COALESCE(?, applies_to),
        options    = COALESCE(?, options),
        required   = COALESCE(?, required),
        sort_order = COALESCE(?, sort_order)
      WHERE id = ?
    `).run(
      field_name || null, field_type || null, applies_to || null,
      options ? JSON.stringify(options) : null,
      required != null ? (required ? 1 : 0) : null,
      sort_order != null ? sort_order : null,
      req.params.id
    );
    res.json(await req.db.prepare('SELECT * FROM ag_custom_field_definitions WHERE id = ?').get(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/custom-fields/:id', requireAdmin, async (req, res) => {
  try {
    await req.db.prepare('DELETE FROM ag_custom_field_definitions WHERE id = ?').run(req.params.id);
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
    if (crew)   { q += ' AND crew_name = ?'; p.push(crew); }
    if (search) { q += ' AND (employee_name LIKE ? OR employee_number LIKE ?)'; p.push(`%${search}%`, `%${search}%`); }
    q += ' ORDER BY employee_name';
    res.json(await req.db.prepare(q).all(...p));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/employees/:id', async (req, res) => {
  try {
    const row = await req.db.prepare('SELECT * FROM ag_employees WHERE id = ?').get(req.params.id);
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
    const r = await req.db.prepare(`
      INSERT INTO ag_employees
        (employee_name, employee_number, crew_name, entity_name, ranch,
         badge_number, email, gender, start_date, end_date, custom_fields)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      employee_name.trim(), employee_number.trim(), crew_name || null,
      entity_name || null, ranch || null, badge_number || null,
      email || null, gender || null, start_date || null, end_date || null,
      JSON.stringify(custom_fields || {})
    );
    res.status(201).json(await req.db.prepare('SELECT * FROM ag_employees WHERE id = ?').get(r.lastInsertRowid));
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
    await req.db.prepare(`
      UPDATE ag_employees SET
        employee_name   = COALESCE(?, employee_name),
        employee_number = COALESCE(?, employee_number),
        crew_name       = COALESCE(?, crew_name),
        entity_name     = COALESCE(?, entity_name),
        ranch           = COALESCE(?, ranch),
        badge_number    = COALESCE(?, badge_number),
        email           = COALESCE(?, email),
        gender          = COALESCE(?, gender),
        start_date      = COALESCE(?, start_date),
        end_date        = COALESCE(?, end_date),
        custom_fields   = COALESCE(?, custom_fields),
        updated_at      = NOW()
      WHERE id = ?
    `).run(
      employee_name || null, employee_number || null, crew_name !== undefined ? crew_name : null,
      entity_name !== undefined ? entity_name : null, ranch !== undefined ? ranch : null,
      badge_number !== undefined ? badge_number : null, email !== undefined ? email : null,
      gender !== undefined ? gender : null, start_date !== undefined ? start_date : null,
      end_date !== undefined ? end_date : null,
      custom_fields ? JSON.stringify(custom_fields) : null,
      req.params.id
    );
    res.json(await req.db.prepare('SELECT * FROM ag_employees WHERE id = ?').get(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/employees/:id', requireAdmin, async (req, res) => {
  try {
    await req.db.prepare('DELETE FROM ag_employees WHERE id = ?').run(req.params.id);
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
    if (commodity) { q += ' AND commodity = ?'; p.push(commodity); }
    if (ranch)     { q += ' AND ranch = ?';     p.push(ranch); }
    q += ' ORDER BY created_at DESC';
    res.json(await req.db.prepare(q).all(...p));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/products/:id', async (req, res) => {
  try {
    const row = await req.db.prepare('SELECT * FROM ag_products WHERE id = ?').get(req.params.id);
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
    const r = await req.db.prepare(`
      INSERT INTO ag_products
        (commodity, ranch, entity, location, crate_count, metric,
         start_time, end_time, picking_average,
         highest_picking_speed, lowest_picking_speed, custom_fields)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      commodity || null, ranch || null, entity || null, location || null,
      crate_count || 0, metric || null,
      start_time || null, end_time || null, picking_average || null,
      highest_picking_speed || null, lowest_picking_speed || null,
      JSON.stringify(custom_fields || {})
    );
    res.status(201).json(await req.db.prepare('SELECT * FROM ag_products WHERE id = ?').get(r.lastInsertRowid));
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
    await req.db.prepare(`
      UPDATE ag_products SET
        commodity             = COALESCE(?, commodity),
        ranch                 = COALESCE(?, ranch),
        entity                = COALESCE(?, entity),
        location              = COALESCE(?, location),
        crate_count           = COALESCE(?, crate_count),
        metric                = COALESCE(?, metric),
        start_time            = COALESCE(?, start_time),
        end_time              = COALESCE(?, end_time),
        picking_average       = COALESCE(?, picking_average),
        highest_picking_speed = COALESCE(?, highest_picking_speed),
        lowest_picking_speed  = COALESCE(?, lowest_picking_speed),
        custom_fields         = COALESCE(?, custom_fields),
        updated_at            = NOW()
      WHERE id = ?
    `).run(
      commodity||null, ranch||null, entity||null, location||null,
      crate_count!=null?crate_count:null, metric||null,
      start_time||null, end_time||null, picking_average||null,
      highest_picking_speed||null, lowest_picking_speed||null,
      custom_fields ? JSON.stringify(custom_fields) : null,
      req.params.id
    );
    res.json(await req.db.prepare('SELECT * FROM ag_products WHERE id = ?').get(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/products/:id', requireAdmin, async (req, res) => {
  try {
    await req.db.prepare('DELETE FROM ag_products WHERE id = ?').run(req.params.id);
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
    if (date)  { q += " AND CAST(scanned_at AS DATE) = ?"; p.push(date); }
    if (crew)  { q += ' AND crew_name = ?';         p.push(crew); }
    if (synced != null) { q += ' AND synced = ?';   p.push(parseInt(synced)); }
    q += ' ORDER BY scanned_at DESC';
    res.json(await req.db.prepare(q).all(...p));
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
    const r = await req.db.prepare(`
      INSERT INTO ag_scanned_products
        (product_name, quantity, unit, user_name, entity_name,
         crew_name, ranch, picking_average, highest_picking_speed,
         lowest_picking_speed, scanned_at, synced, custom_fields)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      product_name.trim(), quantity || 0, unit || 'items',
      user_name || (req.user.name || null),
      entity_name || null, crew_name || null, ranch || null,
      picking_average || null, highest_picking_speed || null,
      lowest_picking_speed || null,
      scanned_at || new Date().toISOString(),
      JSON.stringify(custom_fields || {})
    );
    res.status(201).json(await req.db.prepare('SELECT * FROM ag_scanned_products WHERE id = ?').get(r.lastInsertRowid));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/scanned-products/:id', requireAdmin, async (req, res) => {
  try {
    await req.db.prepare('DELETE FROM ag_scanned_products WHERE id = ?').run(req.params.id);
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

    const insertStmt = req.db.prepare(`
      INSERT INTO ag_scanned_products
        (product_name, quantity, unit, user_name, entity_name,
         crew_name, ranch, picking_average, highest_picking_speed,
         lowest_picking_speed, scanned_at, synced, custom_fields)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);

    const ids = [];
    await req.db.transaction(async (tx) => {
      for (const item of items) {
        const r = await tx.prepare(`
          INSERT INTO ag_scanned_products
            (product_name, quantity, unit, user_name, entity_name,
             crew_name, ranch, picking_average, highest_picking_speed,
             lowest_picking_speed, scanned_at, synced, custom_fields)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        `).run(
          item.product_name || 'Unknown', item.quantity || 0, item.unit || 'items',
          item.user_name || null, item.entity_name || null,
          item.crew_name || null, item.ranch || null,
          item.picking_average || null, item.highest_picking_speed || null,
          item.lowest_picking_speed || null,
          item.scanned_at || new Date().toISOString(),
          JSON.stringify(item.custom_fields || {})
        );
        ids.push(r.lastInsertRowid);
      }
    });

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
    if (from) { whereClause += " AND CAST(scanned_at AS DATE) >= ?"; p.push(from); }
    if (to)   { whereClause += " AND CAST(scanned_at AS DATE) <= ?"; p.push(to); }
    if (crew) { whereClause += " AND crew_name = ?"; p.push(crew); }

    const totals = await req.db.prepare(`
      SELECT
        COUNT(*)                          AS total_scans,
        COALESCE(SUM(quantity), 0)        AS total_quantity,
        COUNT(DISTINCT product_name)      AS unique_products,
        COUNT(DISTINCT crew_name)         AS crew_count,
        COUNT(DISTINCT user_name)         AS worker_count
      FROM ag_scanned_products ${whereClause}
    `).get(...p);

    const byProduct = await req.db.prepare(`
      SELECT product_name,
             SUM(quantity) AS total_quantity,
             COUNT(*)      AS scan_count
      FROM ag_scanned_products ${whereClause}
      GROUP BY product_name
      ORDER BY total_quantity DESC
    `).all(...p);

    const byCrew = await req.db.prepare(`
      SELECT crew_name,
             SUM(quantity) AS total_quantity,
             COUNT(*)      AS scan_count
      FROM ag_scanned_products ${whereClause} AND crew_name IS NOT NULL
      GROUP BY crew_name
      ORDER BY total_quantity DESC
    `).all(...p);

    const byDay = await req.db.prepare(`
      SELECT CAST(scanned_at AS DATE)   AS day,
             SUM(quantity)      AS total_quantity,
             COUNT(*)           AS scan_count
      FROM ag_scanned_products ${whereClause}
      GROUP BY CAST(scanned_at AS DATE)
      ORDER BY day ASC
    `).all(...p);

    const byWorker = await req.db.prepare(`
      SELECT user_name,
             SUM(quantity) AS total_quantity,
             COUNT(*)      AS scan_count
      FROM ag_scanned_products ${whereClause} AND user_name IS NOT NULL
      GROUP BY user_name
      ORDER BY total_quantity DESC
      LIMIT 10
    `).all(...p);

    // Products table
    const products = await req.db.prepare(`
      SELECT *
      FROM ag_products
      ORDER BY crate_count DESC
      LIMIT 20
    `).all();

    res.json({ totals, byProduct, byCrew, byDay, byWorker, products });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/analytics/snapshots', requireAdmin, async (req, res) => {
  try {
    const rows = await req.db.prepare('SELECT * FROM ag_analytics_snapshots ORDER BY snapshot_date DESC').all();
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
    const commodities = (await req.db.prepare(
      "SELECT DISTINCT commodity FROM ag_products WHERE commodity IS NOT NULL ORDER BY commodity"
    ).all()).map(r => r.commodity);

    const ranches = (await req.db.prepare(
      "SELECT DISTINCT ranch FROM ag_products WHERE ranch IS NOT NULL UNION SELECT DISTINCT ranch FROM ag_employees WHERE ranch IS NOT NULL ORDER BY ranch"
    ).all()).map(r => r.ranch);

    // UNION: column name is taken from the first SELECT ('entity').
    // The second SELECT (entity_name) is aliased to 'entity' implicitly.
    const entities = (await req.db.prepare(
      "SELECT DISTINCT entity AS entity FROM ag_products WHERE entity IS NOT NULL " +
      "UNION SELECT DISTINCT entity_name AS entity FROM ag_employees WHERE entity_name IS NOT NULL " +
      "ORDER BY entity"
    ).all()).map(r => r.entity);

    const crews = (await req.db.prepare(
      "SELECT DISTINCT crew_name FROM ag_employees WHERE crew_name IS NOT NULL ORDER BY crew_name"
    ).all()).map(r => r.crew_name);

    res.json({ commodities, ranches, entities, crews });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

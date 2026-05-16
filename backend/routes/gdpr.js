/**
 * GDPR Routes
 *
 * Art.30  — Records of Processing Activities (RoPA): /api/gdpr/ropa
 * Art.33  — Data breach register:                   /api/gdpr/breaches
 * Art.37  — DPO + GDPR settings:                    /api/gdpr/settings (GET/PUT)
 *
 * All routes require admin. Tenant-scoped via injectTenantDb.
 */
const express = require('express');
const router  = express.Router();
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');

router.use(authenticate, requireAdmin, injectTenantDb);

// ══════════════════════════════════════════════════════════════════════════════
// GDPR SETTINGS (Art.37 DPO + Art.13 lawful basis config)
// ══════════════════════════════════════════════════════════════════════════════

router.get('/settings', async (req, res) => {
  try {
    const r = await req.db.query(`
      SELECT dpo_name, dpo_email, dpo_phone,
             lawful_basis_default, consent_expiry_days,
             cross_border_transfer, cross_border_details,
             privacy_notice_url, gdpr_enabled
      FROM org_profile LIMIT 1
    `);
    res.json(r.rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const {
      dpo_name, dpo_email, dpo_phone,
      lawful_basis_default, consent_expiry_days,
      cross_border_transfer, cross_border_details,
      privacy_notice_url, gdpr_enabled,
    } = req.body;

    await req.db.query(`
      UPDATE org_profile SET
        dpo_name              = $1,
        dpo_email             = $2,
        dpo_phone             = $3,
        lawful_basis_default  = COALESCE($4, lawful_basis_default),
        consent_expiry_days   = COALESCE($5, consent_expiry_days),
        cross_border_transfer = COALESCE($6, cross_border_transfer),
        cross_border_details  = $7,
        privacy_notice_url    = $8,
        gdpr_enabled          = COALESCE($9, gdpr_enabled),
        updated_at            = NOW()
    `, [
      dpo_name || null, dpo_email || null, dpo_phone || null,
      lawful_basis_default || null, consent_expiry_days || null,
      cross_border_transfer !== undefined ? cross_border_transfer : null,
      cross_border_details || null, privacy_notice_url || null,
      gdpr_enabled !== undefined ? gdpr_enabled : null,
    ]);
    res.json({ message: 'GDPR settings saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// RECORDS OF PROCESSING ACTIVITIES (RoPA) — Art.30
// ══════════════════════════════════════════════════════════════════════════════

router.get('/ropa', async (req, res) => {
  try {
    const r = await req.db.query(
      'SELECT * FROM gdpr_processing_activities ORDER BY created_at DESC'
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ropa', async (req, res) => {
  try {
    const {
      name, purpose, lawful_basis,
      data_categories, data_subjects, recipients,
      third_countries, retention_period, security_measures,
    } = req.body;

    if (!name || !purpose || !lawful_basis) {
      return res.status(400).json({ error: 'name, purpose, and lawful_basis are required' });
    }

    const r = await req.db.query(`
      INSERT INTO gdpr_processing_activities
        (name, purpose, lawful_basis, data_categories, data_subjects,
         recipients, third_countries, retention_period, security_measures, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id
    `, [
      name, purpose, lawful_basis,
      data_categories || [],
      data_subjects || [],
      recipients || null,
      third_countries || null,
      retention_period || null,
      security_measures || null,
      req.user.id,
    ]);
    res.status(201).json({ id: r.rows[0].id, message: 'Processing activity recorded' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/ropa/:id', async (req, res) => {
  try {
    const {
      name, purpose, lawful_basis,
      data_categories, data_subjects, recipients,
      third_countries, retention_period, security_measures,
    } = req.body;

    await req.db.query(`
      UPDATE gdpr_processing_activities SET
        name              = COALESCE($1, name),
        purpose           = COALESCE($2, purpose),
        lawful_basis      = COALESCE($3, lawful_basis),
        data_categories   = COALESCE($4, data_categories),
        data_subjects     = COALESCE($5, data_subjects),
        recipients        = $6,
        third_countries   = $7,
        retention_period  = $8,
        security_measures = $9,
        updated_at        = NOW()
      WHERE id = $10
    `, [
      name || null, purpose || null, lawful_basis || null,
      data_categories || null, data_subjects || null,
      recipients || null, third_countries || null,
      retention_period || null, security_measures || null,
      req.params.id,
    ]);
    res.json({ message: 'Updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/ropa/:id', async (req, res) => {
  try {
    await req.db.query('DELETE FROM gdpr_processing_activities WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// DATA BREACH REGISTER — Art.33
// ══════════════════════════════════════════════════════════════════════════════

router.get('/breaches', async (req, res) => {
  try {
    const r = await req.db.query(
      'SELECT * FROM gdpr_breach_register ORDER BY discovered_at DESC'
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/breaches', async (req, res) => {
  try {
    const {
      title, discovered_at, severity, description,
      affected_records, data_types_affected, cause,
      containment_actions,
    } = req.body;

    if (!title) return res.status(400).json({ error: 'title is required' });

    const r = await req.db.query(`
      INSERT INTO gdpr_breach_register
        (title, discovered_at, severity, description, affected_records,
         data_types_affected, cause, containment_actions, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id
    `, [
      title,
      discovered_at || new Date().toISOString(),
      severity || 'medium',
      description || null,
      affected_records || null,
      data_types_affected || [],
      cause || null,
      containment_actions || null,
      req.user.id,
    ]);
    res.status(201).json({ id: r.rows[0].id, message: 'Breach recorded' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/breaches/:id', async (req, res) => {
  try {
    const fields = [];
    const vals   = [];
    const allowed = [
      'status','severity','resolution_notes','containment_actions',
      'dpa_notified','dpa_notification_at',
      'individuals_notified','ind_notification_at',
      'affected_records','description','reported_at',
    ];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        vals.push(req.body[key]);
        fields.push(`${key} = $${vals.length}`);
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'No updateable fields provided' });

    vals.push(new Date().toISOString());
    fields.push(`updated_at = $${vals.length}`);
    vals.push(req.params.id);

    await req.db.query(
      `UPDATE gdpr_breach_register SET ${fields.join(', ')} WHERE id = $${vals.length}`,
      vals
    );
    res.json({ message: 'Breach updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

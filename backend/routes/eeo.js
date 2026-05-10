/**
 * EEO Compliance Routes
 *
 * Covers three regulatory frameworks:
 *   - EEO-1 (EEOC)  — race/ethnicity, sex, job category; required for 100+ employees
 *                      or federal contractors with 50+ employees and $50K+ contracts
 *   - VEVRAA        — veteran status; required for federal contractors
 *   - Section 503 / ADA — disability status; required for federal contractors
 *
 * GET    /api/eeo/profile                     — fetch org-level EEO configuration
 * PUT    /api/eeo/profile                     — update org-level EEO configuration
 * GET    /api/eeo/employees                  — list candidates with EEO fields (admin)
 * GET    /api/eeo/employees/:id              — get single candidate EEO fields
 * PUT    /api/eeo/employees/:id              — update candidate EEO fields
 * POST   /api/eeo/reports/generate            — generate + store EEO-1 snapshot
 * GET    /api/eeo/reports                     — list historical EEO snapshots
 * GET    /api/eeo/reports/:year/summary       — pivot table for a specific year
 * GET    /api/eeo/workforce-stats             — live workforce breakdown (no snapshot)
 */

const express = require('express');
const router  = express.Router();
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');
const { auditLog } = require('../middleware/auditLog');

// ─── EEO label helpers ────────────────────────────────────────────────────────

const RACE_LABELS = {
  hispanic_latino:                   'Hispanic or Latino',
  white:                             'White (Not Hispanic or Latino)',
  black_african_american:            'Black or African American (Not Hispanic or Latino)',
  native_hawaiian_pacific_islander:  'Native Hawaiian or Other Pacific Islander',
  asian:                             'Asian (Not Hispanic or Latino)',
  american_indian_alaska_native:     'American Indian or Alaska Native',
  two_or_more_races:                 'Two or More Races',
  prefer_not_to_say:                 'Prefer Not to Say / Not Disclosed',
};

const JOB_CATEGORY_LABELS = {
  exec_senior_mgr:  '1.1 Executive/Senior Level Officials & Managers',
  first_mid_mgr:    '1.2 First/Mid Level Officials & Managers',
  professional:     '2. Professionals',
  technician:       '3. Technicians',
  sales:            '4. Sales Workers',
  admin_support:    '5. Administrative Support Workers',
  craft:            '6. Craft Workers',
  operative:        '7. Operatives',
  laborer_helper:   '8. Laborers & Helpers',
  service_worker:   '9. Service Workers',
  not_assigned:     'Not Assigned',
};

const VETERAN_LABELS = {
  not_veteran:                           'Not a Veteran',
  disabled_veteran:                      'Disabled Veteran',
  recently_separated_veteran:            'Recently Separated Veteran',
  active_duty_wartime_badge_veteran:     'Active Duty Wartime or Campaign Badge Veteran',
  armed_forces_service_medal_veteran:    'Armed Forces Service Medal Veteran',
  prefer_not_to_say:                     'Prefer Not to Say',
};

const DISABILITY_LABELS = {
  yes_disability:    'Yes, I have a disability',
  no_disability:     'No, I do not have a disability',
  prefer_not_to_say: 'I prefer not to answer',
};

// ─── GET /api/eeo/profile ─────────────────────────────────────────────────────
router.get('/profile', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const result = await req.db.query(`
      SELECT
        eeo_company_number, naics_code, naics_description, establishment_type,
        eeo1_filing_required, is_federal_contractor, federal_contractor_uei,
        aap_in_place, aap_effective_date, eeo_officer_name, eeo_officer_email,
        eeo_snapshot_date
      FROM org_profile
      LIMIT 1
    `);

    const profile = result.rows[0] ?? {};
    res.json({
      ...profile,
      // Enrich with display-friendly metadata
      _labels: {
        races:         RACE_LABELS,
        job_categories: JOB_CATEGORY_LABELS,
        veteran_statuses: VETERAN_LABELS,
        disability_statuses: DISABILITY_LABELS,
      },
    });
  } catch (err) {
    console.error('[eeo GET /profile]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/eeo/profile ─────────────────────────────────────────────────────
router.put('/profile', authenticate, requireAdmin, injectTenantDb, auditLog('org_profile'), async (req, res) => {
  try {
    const {
      eeo_company_number, naics_code, naics_description,
      establishment_type, eeo1_filing_required, is_federal_contractor,
      federal_contractor_uei, aap_in_place, aap_effective_date,
      eeo_officer_name, eeo_officer_email, eeo_snapshot_date,
    } = req.body;

    const VALID_ESTABLISHMENT = ['single', 'multi_hq', 'multi_establishment'];
    if (establishment_type && !VALID_ESTABLISHMENT.includes(establishment_type)) {
      return res.status(400).json({ error: `establishment_type must be one of: ${VALID_ESTABLISHMENT.join(', ')}` });
    }

    // Ensure org_profile row exists
    const exists = await req.db.query('SELECT id FROM org_profile LIMIT 1');
    if (exists.rows.length === 0) {
      await req.db.query('INSERT INTO org_profile DEFAULT VALUES');
    }

    await req.db.query(`
      UPDATE org_profile SET
        eeo_company_number    = COALESCE($1,  eeo_company_number),
        naics_code            = COALESCE($2,  naics_code),
        naics_description     = COALESCE($3,  naics_description),
        establishment_type    = COALESCE($4,  establishment_type),
        eeo1_filing_required  = COALESCE($5,  eeo1_filing_required),
        is_federal_contractor = COALESCE($6,  is_federal_contractor),
        federal_contractor_uei= COALESCE($7,  federal_contractor_uei),
        aap_in_place          = COALESCE($8,  aap_in_place),
        aap_effective_date    = COALESCE($9,  aap_effective_date),
        eeo_officer_name      = COALESCE($10, eeo_officer_name),
        eeo_officer_email     = COALESCE($11, eeo_officer_email),
        eeo_snapshot_date     = COALESCE($12, eeo_snapshot_date),
        updated_at            = NOW()
    `, [
      eeo_company_number  ?? null,
      naics_code          ?? null,
      naics_description   ?? null,
      establishment_type  ?? null,
      eeo1_filing_required !== undefined ? eeo1_filing_required : null,
      is_federal_contractor !== undefined ? is_federal_contractor : null,
      federal_contractor_uei ?? null,
      aap_in_place !== undefined ? aap_in_place : null,
      aap_effective_date  ?? null,
      eeo_officer_name    ?? null,
      eeo_officer_email   ?? null,
      eeo_snapshot_date   ?? null,
    ]);

    const updated = await req.db.query('SELECT * FROM org_profile LIMIT 1');
    res.json(updated.rows[0]);
  } catch (err) {
    console.error('[eeo PUT /profile]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/eeo/employees — paginated list with EEO completeness flag ──────
router.get('/employees', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const { page = 1, limit = 50, missing_only } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    let where = `WHERE c.deleted_at IS NULL`;
    if (missing_only === 'true') {
      where += ` AND (c.eeo_race_ethnicity IS NULL OR c.eeo_gender IS NULL OR c.eeo_job_category IS NULL)`;
    }

    const rows = await req.db.query(`
      SELECT
        c.id, c.name, c.email, c.role, c.status,
        c.eeo_race_ethnicity, c.eeo_race_self_identified,
        c.eeo_gender,
        c.eeo_job_category,
        c.veteran_status, c.veteran_self_identified,
        c.disability_status, c.disability_self_identified,
        c.eeo_self_id_date, c.eeo_data_source,
        -- completeness flags
        (c.eeo_race_ethnicity IS NOT NULL AND c.eeo_gender IS NOT NULL AND c.eeo_job_category IS NOT NULL) AS eeo_complete,
        (c.veteran_status IS NOT NULL) AS vevraa_complete,
        (c.disability_status IS NOT NULL) AS ada_complete
      FROM employees c
      ${where}
      ORDER BY c.name
      LIMIT $1 OFFSET $2
    `, [parseInt(limit, 10), offset]);

    const countResult = await req.db.query(
      `SELECT COUNT(*) FROM employees c ${where}`
    );

    res.json({
      data:  rows.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page:  parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  } catch (err) {
    console.error('[eeo GET /employees]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/eeo/employees/:id ─────────────────────────────────────────────
router.get('/employees/:id', authenticate, injectTenantDb, async (req, res) => {
  try {
    const cid = parseInt(req.params.id, 10);

    // Candidates may only view their own record
    if (req.user.role === 'candidate' && req.user.employeeId !== cid) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = await req.db.query(`
      SELECT
        id, name, email, role,
        eeo_race_ethnicity, eeo_race_self_identified,
        eeo_gender,
        eeo_job_category,
        veteran_status, veteran_self_identified,
        disability_status, disability_self_identified,
        eeo_self_id_date, eeo_data_source
      FROM employees
      WHERE id = $1 AND deleted_at IS NULL
    `, [cid]);

    if (!result.rows[0]) return res.status(404).json({ error: 'Candidate not found' });

    res.json({
      ...result.rows[0],
      _labels: { RACE_LABELS, JOB_CATEGORY_LABELS, VETERAN_LABELS, DISABILITY_LABELS },
    });
  } catch (err) {
    console.error('[eeo GET /employees/:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/eeo/employees/:id ─────────────────────────────────────────────
router.put('/employees/:id', authenticate, injectTenantDb, auditLog('employees'), async (req, res) => {
  try {
    const cid = parseInt(req.params.id, 10);

    // Candidates may only update their own record; admins can update anyone
    if (req.user.role === 'candidate' && req.user.employeeId !== cid) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const {
      eeo_race_ethnicity, eeo_race_self_identified,
      eeo_gender,
      eeo_job_category,
      veteran_status, veteran_self_identified,
      disability_status, disability_self_identified,
      eeo_data_source,
    } = req.body;

    // Validate enums
    const validRace  = Object.keys(RACE_LABELS);
    const validGender = ['male','female','nonbinary','prefer_not_to_say'];
    const validJobCat = Object.keys(JOB_CATEGORY_LABELS);
    const validVet   = Object.keys(VETERAN_LABELS);
    const validDisab = Object.keys(DISABILITY_LABELS);
    const validSrc   = ['self_identified','visual_observation','payroll_records','not_collected'];

    if (eeo_race_ethnicity  && !validRace.includes(eeo_race_ethnicity))
      return res.status(400).json({ error: `Invalid eeo_race_ethnicity. Valid values: ${validRace.join(', ')}` });
    if (eeo_gender           && !validGender.includes(eeo_gender))
      return res.status(400).json({ error: `Invalid eeo_gender. Valid values: ${validGender.join(', ')}` });
    if (eeo_job_category     && !validJobCat.includes(eeo_job_category))
      return res.status(400).json({ error: `Invalid eeo_job_category. Valid values: ${validJobCat.join(', ')}` });
    if (veteran_status       && !validVet.includes(veteran_status))
      return res.status(400).json({ error: `Invalid veteran_status. Valid values: ${validVet.join(', ')}` });
    if (disability_status    && !validDisab.includes(disability_status))
      return res.status(400).json({ error: `Invalid disability_status. Valid values: ${validDisab.join(', ')}` });
    if (eeo_data_source      && !validSrc.includes(eeo_data_source))
      return res.status(400).json({ error: `Invalid eeo_data_source. Valid values: ${validSrc.join(', ')}` });

    const result = await req.db.query(`
      UPDATE employees SET
        eeo_race_ethnicity        = COALESCE($1,  eeo_race_ethnicity),
        eeo_race_self_identified  = COALESCE($2,  eeo_race_self_identified),
        eeo_gender                = COALESCE($3,  eeo_gender),
        eeo_job_category          = COALESCE($4,  eeo_job_category),
        veteran_status            = COALESCE($5,  veteran_status),
        veteran_self_identified   = COALESCE($6,  veteran_self_identified),
        disability_status         = COALESCE($7,  disability_status),
        disability_self_identified= COALESCE($8,  disability_self_identified),
        eeo_self_id_date          = CASE
                                      WHEN $9 IS NOT NULL OR $10 IS NOT NULL OR $11 IS NOT NULL
                                      THEN CURRENT_DATE
                                      ELSE eeo_self_id_date
                                    END,
        eeo_data_source           = COALESCE($12, eeo_data_source),
        updated_at                = NOW()
      WHERE id = $13 AND deleted_at IS NULL
      RETURNING *
    `, [
      eeo_race_ethnicity         ?? null,
      eeo_race_self_identified   !== undefined ? eeo_race_self_identified : null,
      eeo_gender                 ?? null,
      eeo_job_category           ?? null,
      veteran_status             ?? null,
      veteran_self_identified    !== undefined ? veteran_self_identified : null,
      disability_status          ?? null,
      disability_self_identified !== undefined ? disability_self_identified : null,
      // $9–$11 used in CASE to auto-set eeo_self_id_date when any EEO field is saved
      eeo_race_ethnicity ?? null,
      eeo_gender         ?? null,
      veteran_status     ?? null,
      eeo_data_source    ?? null,
      cid,
    ]);

    if (!result.rows[0]) return res.status(404).json({ error: 'Candidate not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[eeo PUT /employees/:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/eeo/reports/generate — generate EEO-1 snapshot ────────────────
router.post('/reports/generate', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const snapshotDate = req.body.snapshot_date || new Date().toISOString().split('T')[0];
    const reportYear   = req.body.report_year   || new Date().getFullYear();

    // Aggregate live workforce by (job_category, race_ethnicity, gender)
    const aggResult = await req.db.query(`
      SELECT
        COALESCE(eeo_job_category, 'not_assigned')       AS job_category,
        COALESCE(eeo_race_ethnicity, 'prefer_not_to_say') AS race_ethnicity,
        COALESCE(eeo_gender, 'prefer_not_to_say')         AS gender,
        COUNT(*)::INTEGER                                  AS headcount
      FROM employees
      WHERE status = 'active' AND deleted_at IS NULL
      GROUP BY 1, 2, 3
      ORDER BY 1, 2, 3
    `);

    if (aggResult.rows.length === 0) {
      return res.status(400).json({ error: 'No active candidates found to generate a report' });
    }

    // Delete any existing snapshot for this year + date (idempotent)
    await req.db.query(
      `DELETE FROM eeo_reports WHERE report_year = $1 AND snapshot_date = $2`,
      [reportYear, snapshotDate]
    );

    // Bulk-insert new snapshot rows
    for (const row of aggResult.rows) {
      await req.db.query(`
        INSERT INTO eeo_reports (snapshot_date, report_year, job_category, race_ethnicity, gender, headcount)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [snapshotDate, reportYear, row.job_category, row.race_ethnicity, row.gender, row.headcount]);
    }

    res.status(201).json({
      message:        'EEO-1 snapshot generated',
      snapshot_date:  snapshotDate,
      report_year:    reportYear,
      rows_generated: aggResult.rows.length,
      summary:        aggResult.rows,
    });
  } catch (err) {
    console.error('[eeo POST /reports/generate]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/eeo/reports — list historical snapshots ────────────────────────
router.get('/reports', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const result = await req.db.query(`
      SELECT
        report_year,
        snapshot_date,
        SUM(headcount)::INTEGER AS total_headcount,
        COUNT(DISTINCT job_category) AS job_categories,
        MIN(created_at) AS generated_at
      FROM eeo_reports
      GROUP BY report_year, snapshot_date
      ORDER BY report_year DESC, snapshot_date DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[eeo GET /reports]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/eeo/reports/:year/summary — pivot for a specific year ──────────
router.get('/reports/:year/summary', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const year = parseInt(req.params.year, 10);
    const rows = await req.db.query(`
      SELECT job_category, race_ethnicity, gender, SUM(headcount)::INTEGER AS headcount
      FROM eeo_reports
      WHERE report_year = $1
      GROUP BY job_category, race_ethnicity, gender
      ORDER BY job_category, race_ethnicity, gender
    `, [year]);

    // Pivot into a matrix: { job_category: { race_ethnicity: { gender: count } } }
    const matrix = {};
    let grandTotal = 0;

    for (const row of rows.rows) {
      if (!matrix[row.job_category])             matrix[row.job_category] = {};
      if (!matrix[row.job_category][row.race_ethnicity]) matrix[row.job_category][row.race_ethnicity] = {};
      matrix[row.job_category][row.race_ethnicity][row.gender] = row.headcount;
      grandTotal += row.headcount;
    }

    // Flat rows for CSV / table rendering
    const flatRows = rows.rows.map(r => ({
      ...r,
      job_category_label:  JOB_CATEGORY_LABELS[r.job_category]  || r.job_category,
      race_ethnicity_label: RACE_LABELS[r.race_ethnicity]        || r.race_ethnicity,
    }));

    res.json({
      year,
      grand_total: grandTotal,
      matrix,
      rows: flatRows,
      _labels: { RACE_LABELS, JOB_CATEGORY_LABELS },
    });
  } catch (err) {
    console.error('[eeo GET /reports/:year/summary]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/eeo/workforce-stats — live breakdown (no snapshot required) ─────
router.get('/workforce-stats', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  try {
    const [byRace, byGender, byJobCat, byVeteran, byDisability, completeness] = await Promise.all([
      req.db.query(`
        SELECT COALESCE(eeo_race_ethnicity,'not_collected') AS value, COUNT(*)::INTEGER AS count
        FROM employees WHERE status='active' AND deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC
      `),
      req.db.query(`
        SELECT COALESCE(eeo_gender,'not_collected') AS value, COUNT(*)::INTEGER AS count
        FROM employees WHERE status='active' AND deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC
      `),
      req.db.query(`
        SELECT COALESCE(eeo_job_category,'not_assigned') AS value, COUNT(*)::INTEGER AS count
        FROM employees WHERE status='active' AND deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC
      `),
      req.db.query(`
        SELECT COALESCE(veteran_status,'not_collected') AS value, COUNT(*)::INTEGER AS count
        FROM employees WHERE status='active' AND deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC
      `),
      req.db.query(`
        SELECT COALESCE(disability_status,'not_collected') AS value, COUNT(*)::INTEGER AS count
        FROM employees WHERE status='active' AND deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC
      `),
      req.db.query(`
        SELECT
          COUNT(*)::INTEGER AS total,
          SUM(CASE WHEN eeo_race_ethnicity IS NOT NULL AND eeo_gender IS NOT NULL AND eeo_job_category IS NOT NULL
                   THEN 1 ELSE 0 END)::INTEGER AS eeo1_complete,
          SUM(CASE WHEN veteran_status IS NOT NULL THEN 1 ELSE 0 END)::INTEGER   AS vevraa_complete,
          SUM(CASE WHEN disability_status IS NOT NULL THEN 1 ELSE 0 END)::INTEGER AS ada_complete
        FROM employees WHERE status='active' AND deleted_at IS NULL
      `),
    ]);

    const comp = completeness.rows[0] ?? { total: 0, eeo1_complete: 0, vevraa_complete: 0, ada_complete: 0 };

    res.json({
      by_race_ethnicity: byRace.rows.map(r => ({ ...r, label: RACE_LABELS[r.value] || r.value })),
      by_gender:         byGender.rows,
      by_job_category:   byJobCat.rows.map(r => ({ ...r, label: JOB_CATEGORY_LABELS[r.value] || r.value })),
      by_veteran_status: byVeteran.rows.map(r => ({ ...r, label: VETERAN_LABELS[r.value] || r.value })),
      by_disability:     byDisability.rows.map(r => ({ ...r, label: DISABILITY_LABELS[r.value] || r.value })),
      completeness: {
        total:               comp.total,
        eeo1_complete:       comp.eeo1_complete,
        vevraa_complete:     comp.vevraa_complete,
        ada_complete:        comp.ada_complete,
        eeo1_pct:   comp.total ? Math.round((comp.eeo1_complete  / comp.total) * 100) : 0,
        vevraa_pct: comp.total ? Math.round((comp.vevraa_complete / comp.total) * 100) : 0,
        ada_pct:    comp.total ? Math.round((comp.ada_complete    / comp.total) * 100) : 0,
      },
    });
  } catch (err) {
    console.error('[eeo GET /workforce-stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

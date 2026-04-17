const express = require('express');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');
const { createNotification } = require('./notifications');

const router = express.Router();

// GET /api/jobs — all open jobs (candidates) or all jobs (admin)
router.get('/', authenticate, injectTenantDb, async (req, res) => {
  let query = `
    SELECT jp.*, cl.name as client_name,
      (SELECT COUNT(*) FROM job_applications ja WHERE ja.job_id = jp.id) as application_count
    FROM job_postings jp
    LEFT JOIN clients cl ON jp.client_id = cl.id
  `;
  if (req.user.role === 'candidate') {
    query += ` WHERE jp.status = 'open'`;
  }
  query += ' ORDER BY jp.created_at DESC';

  const result = await req.db.query(query);
  const jobs = result.rows;
  res.json(jobs);
});

// GET /api/jobs/:id — single job with applications (admin) or basic info (candidate)
router.get('/:id', authenticate, injectTenantDb, async (req, res) => {
  const id = parseInt(req.params.id);
  const result = await req.db.query(`
    SELECT jp.*, cl.name as client_name
    FROM job_postings jp
    LEFT JOIN clients cl ON jp.client_id = cl.id
    WHERE jp.id = $1
  `, [id]);
  const job = result.rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  // Attach applications for admin
  if (req.user.role === 'admin') {
    const appResult = await req.db.query(`
      SELECT ja.*, c.name as candidate_name, c.email as candidate_email,
        c.role as candidate_role, c.hourly_rate
      FROM job_applications ja
      JOIN candidates c ON ja.candidate_id = c.id
      WHERE ja.job_id = $1
      ORDER BY ja.applied_at DESC
    `, [id]);
    job.applications = appResult.rows;
  }

  // Attach candidate's own application status if candidate
  if (req.user.role === 'candidate') {
    const myResult = await req.db.query(`
      SELECT * FROM job_applications WHERE job_id = $1 AND candidate_id = $2
    `, [id, req.user.candidateId]);
    job.my_application = myResult.rows[0] || null;
  }

  res.json(job);
});

// POST /api/jobs — admin creates a job posting
router.post('/', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  const { title, description, skills, client_id, location, contract_type, hourly_rate_min, hourly_rate_max, status } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const insertResult = await req.db.query(`
    INSERT INTO job_postings (title, description, skills, client_id, location, contract_type, hourly_rate_min, hourly_rate_max, status, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id
  `, [
    title,
    description || null,
    skills || null,
    client_id || null,
    location || null,
    contract_type || 'contractor',
    hourly_rate_min || null,
    hourly_rate_max || null,
    status || 'open',
    req.user.id
  ]);

  const jobId = insertResult.rows[0].id;
  const result = await req.db.query(`
    SELECT jp.*, cl.name as client_name FROM job_postings jp
    LEFT JOIN clients cl ON jp.client_id = cl.id
    WHERE jp.id = $1
  `, [jobId]);
  const job = result.rows[0];
  res.status(201).json(job);
});

// PUT /api/jobs/:id — admin updates a job posting
router.put('/:id', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  const id = parseInt(req.params.id);
  const jobResult = await req.db.query('SELECT * FROM job_postings WHERE id = $1', [id]);
  const job = jobResult.rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const { title, description, skills, client_id, location, contract_type, hourly_rate_min, hourly_rate_max, status } = req.body;

  await req.db.query(`
    UPDATE job_postings SET
      title = COALESCE($1, title),
      description = $2,
      skills = $3,
      client_id = $4,
      location = $5,
      contract_type = COALESCE($6, contract_type),
      hourly_rate_min = $7,
      hourly_rate_max = $8,
      status = COALESCE($9, status),
      updated_at = NOW()
    WHERE id = $10
  `, [
    title || null,
    description !== undefined ? description : job.description,
    skills !== undefined ? skills : job.skills,
    client_id !== undefined ? client_id : job.client_id,
    location !== undefined ? location : job.location,
    contract_type || null,
    hourly_rate_min !== undefined ? hourly_rate_min : job.hourly_rate_min,
    hourly_rate_max !== undefined ? hourly_rate_max : job.hourly_rate_max,
    status || null,
    id
  ]);

  const result = await req.db.query(`
    SELECT jp.*, cl.name as client_name FROM job_postings jp
    LEFT JOIN clients cl ON jp.client_id = cl.id
    WHERE jp.id = $1
  `, [id]);
  const updated = result.rows[0];
  res.json(updated);
});

// DELETE /api/jobs/:id — admin deletes a job posting
router.delete('/:id', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  const id = parseInt(req.params.id);
  const jobResult = await req.db.query('SELECT id FROM job_postings WHERE id = $1', [id]);
  const job = jobResult.rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  await req.db.query('DELETE FROM job_postings WHERE id = $1', [id]);
  res.json({ message: 'Job posting deleted' });
});

// POST /api/jobs/:id/apply — candidate applies for a job
router.post('/:id/apply', authenticate, injectTenantDb, async (req, res) => {
  if (req.user.role !== 'candidate') return res.status(403).json({ error: 'Only candidates can apply' });

  const jobId = parseInt(req.params.id);
  const { cover_letter } = req.body;

  const jobResult = await req.db.query("SELECT * FROM job_postings WHERE id = $1 AND status = 'open'", [jobId]);
  const job = jobResult.rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found or not open' });

  const existingResult = await req.db.query('SELECT id FROM job_applications WHERE job_id = $1 AND candidate_id = $2', [jobId, req.user.candidateId]);
  const existing = existingResult.rows[0];
  if (existing) return res.status(409).json({ error: 'You have already applied to this job' });

  const insertResult = await req.db.query(`
    INSERT INTO job_applications (job_id, candidate_id, status, cover_letter)
    VALUES ($1, $2, 'applied', $3)
    RETURNING id
  `, [jobId, req.user.candidateId, cover_letter || null]);

  const applicationId = insertResult.rows[0].id;

  // Notify admin(s) of new application
  const adminsResult = await req.db.query("SELECT id FROM users WHERE role = 'admin'");
  const admins = adminsResult.rows;
  const candidateResult = await req.db.query('SELECT name FROM candidates WHERE id = $1', [req.user.candidateId]);
  const candidate = candidateResult.rows[0];
  for (const admin of admins) {
    createNotification(
      req.db,
      admin.id,
      'job_application_new',
      'New Job Application',
      `${candidate.name} applied for "${job.title}"`,
      applicationId,
      'job_application'
    );
  }

  const result = await req.db.query('SELECT * FROM job_applications WHERE id = $1', [applicationId]);
  const application = result.rows[0];
  res.status(201).json(application);
});

// PUT /api/jobs/:id/applications/:appId — admin updates application status
router.put('/:id/applications/:appId', authenticate, requireAdmin, injectTenantDb, async (req, res) => {
  const appId = parseInt(req.params.appId);
  const { status } = req.body;

  if (!['applied', 'reviewing', 'shortlisted', 'rejected', 'hired'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const appResult = await req.db.query(`
    SELECT ja.*, c.user_id, c.name as candidate_name, jp.title as job_title
    FROM job_applications ja
    JOIN candidates c ON ja.candidate_id = c.id
    JOIN job_postings jp ON ja.job_id = jp.id
    WHERE ja.id = $1
  `, [appId]);
  const app = appResult.rows[0];
  if (!app) return res.status(404).json({ error: 'Application not found' });

  await req.db.query('UPDATE job_applications SET status = $1, updated_at = NOW() WHERE id = $2', [status, appId]);

  // Notify candidate
  const statusLabels = {
    reviewing: 'is being reviewed',
    shortlisted: 'has been shortlisted',
    rejected: 'was not selected',
    hired: 'has been accepted — congratulations!'
  };
  if (statusLabels[status]) {
    createNotification(
      req.db,
      app.user_id,
      'job_application_update',
      'Application Status Update',
      `Your application for "${app.job_title}" ${statusLabels[status]}`,
      appId,
      'job_application'
    );
  }

  const result = await req.db.query('SELECT * FROM job_applications WHERE id = $1', [appId]);
  const updated = result.rows[0];
  res.json(updated);
});

// GET /api/jobs/my-applications — candidate views their applications
router.get('/my/applications', authenticate, injectTenantDb, async (req, res) => {
  if (req.user.role !== 'candidate') return res.status(403).json({ error: 'Candidates only' });

  const result = await req.db.query(`
    SELECT ja.*, jp.title as job_title, jp.location, jp.contract_type,
      jp.hourly_rate_min, jp.hourly_rate_max, cl.name as client_name
    FROM job_applications ja
    JOIN job_postings jp ON ja.job_id = jp.id
    LEFT JOIN clients cl ON jp.client_id = cl.id
    WHERE ja.candidate_id = $1
    ORDER BY ja.applied_at DESC
  `, [req.user.candidateId]);
  const applications = result.rows;
  res.json(applications);
});

module.exports = router;

/**
 * C2C Job Board Routes
 *
 * GET /api/c2c-jobs/me            — candidate: search jobs matching own resume
 * GET /api/c2c-jobs/:employeeId  — admin or assigned recruiter: search for a candidate
 * GET /api/c2c-jobs/recruiter/all — recruiter: jobs for all assigned candidates
 */
const express = require('express');
const { authenticate, injectTenantDb } = require('../middleware/auth');
const { searchC2CJobs, extractSkillsFromResume } = require('../services/jobSearch');

const router = express.Router();
router.use(authenticate, injectTenantDb);

/**
 * Helper: get candidate + resume, verify access
 * Returns { candidate, resume } or sends error response
 */
async function getCandidateWithResume(req, res, employeeId) {
  const candResult = await req.db.query(
    `SELECT c.*, u.email as user_email FROM employees c
     LEFT JOIN users u ON c.user_id = u.id
     WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [employeeId]
  );
  const candidate = candResult.rows[0];
  if (!candidate) {
    res.status(404).json({ error: 'Candidate not found' });
    return null;
  }

  // Access control: admin, or recruiter assigned to this candidate, or candidate themselves
  if (req.user.role === 'candidate' && req.user.employeeId !== candidate.id) {
    res.status(403).json({ error: 'Access denied' });
    return null;
  }
  if (req.user.role === 'recruiter') {
    const assignCheck = await req.db.query(
      `SELECT 1 FROM recruiter_assignments ra
       JOIN recruiters r ON ra.recruiter_id = r.id
       WHERE r.user_id = $1 AND ra.candidate_id = $2`,
      [req.user.id, candidate.id]
    );
    if (!assignCheck.rows[0]) {
      res.status(403).json({ error: 'This candidate is not assigned to you' });
      return null;
    }
  }

  const resumeResult = await req.db.query(
    'SELECT * FROM candidate_resumes WHERE candidate_id = $1',
    [candidate.id]
  );
  const resume = resumeResult.rows[0] || null;

  return { candidate, resume };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/c2c-jobs/me — candidate: jobs matching own resume
// ─────────────────────────────────────────────────────────────────────────────
router.get('/me', async (req, res) => {
  try {
    if (req.user.role !== 'candidate') {
      return res.status(403).json({ error: 'Candidate access only' });
    }
    if (!req.user.employeeId) {
      return res.status(404).json({ error: 'No candidate profile found' });
    }

    const data = await getCandidateWithResume(req, res, req.user.employeeId);
    if (!data) return; // error already sent

    const { candidate, resume } = data;
    const skills = extractSkillsFromResume(resume);
    const result = await searchC2CJobs(req.db, candidate.role, skills);

    res.json({
      candidate: {
        id:           candidate.id,
        name:         candidate.name,
        role:         candidate.role,
        marketStatus: candidate.market_status,
      },
      query:     result.query,
      fromCache: result.fromCache,
      count:     result.jobs.length,
      jobs:      result.jobs,
    });
  } catch (err) {
    console.error('[C2C /me]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/c2c-jobs/recruiter/all — recruiter: jobs for all assigned candidates
// ─────────────────────────────────────────────────────────────────────────────
router.get('/recruiter/all', async (req, res) => {
  try {
    if (!['recruiter', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Recruiter or admin access only' });
    }

    // Get all assigned candidates
    let assignmentsQuery;
    if (req.user.role === 'recruiter') {
      assignmentsQuery = await req.db.query(`
        SELECT c.id, c.name, c.role as job_title, c.market_status, c.available_date
        FROM recruiter_assignments ra
        JOIN recruiters r ON ra.recruiter_id = r.id
        JOIN employees c ON ra.candidate_id = c.id
        WHERE r.user_id = $1 AND c.deleted_at IS NULL
          AND c.market_status IN ('in_market', 'about_to_be_in_market')
        ORDER BY c.name
      `, [req.user.id]);
    } else {
      // Admin sees all in-market candidates
      assignmentsQuery = await req.db.query(`
        SELECT c.id, c.name, c.role as job_title, c.market_status, c.available_date
        FROM employees c
        WHERE c.deleted_at IS NULL
          AND c.market_status IN ('in_market', 'about_to_be_in_market')
        ORDER BY c.name
      `);
    }

    const candidates = assignmentsQuery.rows;

    // For each candidate, fetch resume + search jobs (cache makes this fast)
    const results = await Promise.all(
      employees.map(async (cand) => {
        try {
          const resumeResult = await req.db.query(
            'SELECT * FROM candidate_resumes WHERE candidate_id = $1',
            [cand.id]
          );
          const resume = resumeResult.rows[0] || null;
          const skills = extractSkillsFromResume(resume);
          const jobResult = await searchC2CJobs(req.db, cand.job_title, skills);
          return {
            candidate:    cand,
            query:        jobResult.query,
            fromCache:    jobResult.fromCache,
            count:        jobResult.jobs.length,
            jobs:         jobResult.jobs,
          };
        } catch (err) {
          console.error(`[C2C recruiter/all] Error for candidate ${cand.id}:`, err.message);
          return { candidate: cand, query: '', fromCache: false, count: 0, jobs: [] };
        }
      })
    );

    res.json({ results });
  } catch (err) {
    console.error('[C2C /recruiter/all]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/c2c-jobs/:employeeId — admin or assigned recruiter
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:employeeId', async (req, res) => {
  try {
    const employeeId = parseInt(req.params.employeeId);
    if (isNaN(employeeId)) return res.status(400).json({ error: 'Invalid employeeId' });

    const data = await getCandidateWithResume(req, res, employeeId);
    if (!data) return;

    const { candidate, resume } = data;
    const skills = extractSkillsFromResume(resume);
    const result = await searchC2CJobs(req.db, candidate.role, skills);

    res.json({
      candidate: {
        id:           candidate.id,
        name:         candidate.name,
        role:         candidate.role,
        marketStatus: candidate.market_status,
        availableDate: candidate.available_date,
      },
      query:     result.query,
      fromCache: result.fromCache,
      count:     result.jobs.length,
      jobs:      result.jobs,
    });
  } catch (err) {
    console.error('[C2C /:employeeId]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

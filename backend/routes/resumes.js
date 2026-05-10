/**
 * Resume Builder Routes
 * GET /api/resumes/:employeeId   — get resume (admin or owner)
 * PUT /api/resumes/:employeeId   — create/update resume
 * GET /api/resumes/:employeeId/pdf — download as PDF
 */
const express = require('express');
const PDFDocument = require('pdfkit');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, injectTenantDb);

function parseJson(str, fallback) {
  try { return JSON.parse(str || '[]'); } catch { return fallback; }
}

// ── Candidate self-service routes (/me) ──────────────────────────────────────

async function getCandidateForUser(db, userId) {
  const result = await db.query('SELECT * FROM employees WHERE user_id = $1', [userId]);
  return result.rows[0];
}

// GET /api/resumes/me
router.get('/me', async (req, res) => {
  if (req.user.role !== 'candidate') return res.status(403).json({ error: 'Candidate only' });
  const candidate = await getCandidateForUser(req.db, req.user.id);
  if (!candidate) return res.status(404).json({ error: 'Candidate profile not found' });

  const resumeResult = await req.db.query('SELECT * FROM candidate_resumes WHERE candidate_id = $1', [candidate.id]);
  let resume = resumeResult.rows[0];
  if (!resume) {
    return res.json({
      candidate_id: candidate.id, employee_name: candidate.name,
      headline: '', summary: '',
      experience: [], education: [], skills: [], certifications: [], languages: [],
    });
  }
  res.json({
    ...resume, employee_name: candidate.name,
    experience:     parseJson(resume.experience, []),
    education:      parseJson(resume.education, []),
    skills:         parseJson(resume.skills, []),
    certifications: parseJson(resume.certifications, []),
    languages:      parseJson(resume.languages, []),
  });
});

// PUT /api/resumes/me
router.put('/me', async (req, res) => {
  if (req.user.role !== 'candidate') return res.status(403).json({ error: 'Candidate only' });
  const candidate = await getCandidateForUser(req.db, req.user.id);
  if (!candidate) return res.status(404).json({ error: 'Candidate profile not found' });

  const { headline, summary, experience, education, skills, certifications, languages } = req.body;
  await req.db.query(`
    INSERT INTO candidate_resumes (candidate_id, headline, summary, experience, education, skills, certifications, languages, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    ON CONFLICT(candidate_id) DO UPDATE SET
      headline = excluded.headline, summary = excluded.summary,
      experience = excluded.experience, education = excluded.education,
      skills = excluded.skills, certifications = excluded.certifications,
      languages = excluded.languages, updated_at = NOW()
  `, [
    candidate.id, headline || null, summary || null,
    JSON.stringify(Array.isArray(experience) ? experience : []),
    JSON.stringify(Array.isArray(education)  ? education  : []),
    JSON.stringify(Array.isArray(skills)     ? skills     : []),
    JSON.stringify(Array.isArray(certifications) ? certifications : []),
    JSON.stringify(Array.isArray(languages)  ? languages  : []),
  ]);

  const savedResult = await req.db.query('SELECT * FROM candidate_resumes WHERE candidate_id = $1', [candidate.id]);
  const saved = savedResult.rows[0];
  res.json({
    ...saved, employee_name: candidate.name,
    experience:     parseJson(saved.experience, []),
    education:      parseJson(saved.education, []),
    skills:         parseJson(saved.skills, []),
    certifications: parseJson(saved.certifications, []),
    languages:      parseJson(saved.languages, []),
  });
});

// GET /api/resumes/me/pdf
router.get('/me/pdf', async (req, res) => {
  if (req.user.role !== 'candidate') return res.status(403).json({ error: 'Candidate only' });
  const candidate = await getCandidateForUser(req.db, req.user.id);
  if (!candidate) return res.status(404).json({ error: 'Candidate profile not found' });

  const resumeResult = await req.db.query('SELECT * FROM candidate_resumes WHERE candidate_id = $1', [candidate.id]);
  const resume = resumeResult.rows[0];
  const exp    = parseJson(resume?.experience, []);
  const edu    = parseJson(resume?.education, []);
  const skills = parseJson(resume?.skills, []);
  const certs  = parseJson(resume?.certifications, []);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="resume-${candidate.name.replace(/\s+/g,'-')}.pdf"`);
  doc.pipe(res);
  buildResumePdf(doc, candidate, resume, exp, edu, skills, certs);
  doc.end();
});

// ── Shared PDF builder ────────────────────────────────────────────────────────
function buildResumePdf(doc, candidate, resume, exp, edu, skills, certs) {
  const GREEN = '#16a34a';
  const DARK  = '#111827';

  doc.rect(0, 0, doc.page.width, 110).fill(GREEN);
  doc.fill('white').fontSize(26).font('Helvetica-Bold').text(candidate.name, 50, 30);
  if (resume?.headline) doc.fontSize(13).font('Helvetica').text(resume.headline, 50, 62);
  const contact = [candidate.email, candidate.phone].filter(Boolean).join('  ·  ');
  if (contact) doc.fontSize(10).text(contact, 50, 84);

  let y = 130;
  const sectionTitle = (title) => {
    doc.fill(GREEN).rect(50, y, doc.page.width - 100, 2).fill();
    y += 6;
    doc.fill(GREEN).fontSize(13).font('Helvetica-Bold').text(title.toUpperCase(), 50, y);
    y += 20;
    doc.fill(DARK);
  };
  const bodyText = (text, indent = 0) => {
    doc.fill(DARK).fontSize(10).font('Helvetica').text(text, 50 + indent, y, { width: doc.page.width - 100 - indent });
    y += doc.currentLineHeight() + 4;
  };

  if (resume?.summary) { sectionTitle('Professional Summary'); bodyText(resume.summary); y += 10; }

  if (exp.length > 0) {
    sectionTitle('Work Experience');
    for (const e of exp) {
      doc.fill(DARK).fontSize(11).font('Helvetica-Bold').text(e.title || 'Role', 50, y);
      const period = [e.company, [e.start, e.end].filter(Boolean).join(' – ')].filter(Boolean).join('  |  ');
      doc.fill('#6b7280').fontSize(10).font('Helvetica').text(period, 50, y + 14, { width: doc.page.width - 100 });
      y += 32;
      if (e.description) { bodyText(e.description, 10); }
      y += 6;
    }
  }

  if (edu.length > 0) {
    sectionTitle('Education');
    for (const e of edu) {
      doc.fill(DARK).fontSize(11).font('Helvetica-Bold').text(e.degree || 'Degree', 50, y);
      const meta = [e.institution, e.year].filter(Boolean).join('  |  ');
      doc.fill('#6b7280').fontSize(10).font('Helvetica').text(meta, 50, y + 14, { width: doc.page.width - 100 });
      y += 30;
    }
  }

  if (skills.length > 0) { sectionTitle('Skills'); bodyText(skills.join('  ·  ')); y += 6; }

  if (certs.length > 0) {
    sectionTitle('Certifications');
    for (const c of certs) { bodyText(`${c.name || c}${c.year ? `  (${c.year})` : ''}`, 10); }
  }
}

// ── Admin / shared routes ─────────────────────────────────────────────────────

// GET /api/resumes/:employeeId
router.get('/:employeeId', async (req, res) => {
  const { employeeId } = req.params;
  const candResult = await req.db.query('SELECT * FROM employees WHERE id = $1', [employeeId]);
  const candidate = candResult.rows[0];
  if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

  // Candidates can only read their own resume
  if (req.user.role === 'candidate') {
    const meResult = await req.db.query('SELECT id FROM employees WHERE user_id = $1', [req.user.id]);
    const me = meResult.rows[0];
    if (!me || String(me.id) !== String(employeeId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }

  const resumeResult = await req.db.query('SELECT * FROM candidate_resumes WHERE candidate_id = $1', [employeeId]);
  let resume = resumeResult.rows[0];
  if (!resume) {
    // Return an empty template
    return res.json({
      candidate_id: parseInt(employeeId),
      employee_name: candidate.name,
      headline: '', summary: '',
      experience: [], education: [], skills: [], certifications: [], languages: [],
    });
  }

  res.json({
    ...resume,
    employee_name: candidate.name,
    experience:     parseJson(resume.experience, []),
    education:      parseJson(resume.education, []),
    skills:         parseJson(resume.skills, []),
    certifications: parseJson(resume.certifications, []),
    languages:      parseJson(resume.languages, []),
  });
});

// PUT /api/resumes/:employeeId — create or full replace
router.put('/:employeeId', async (req, res) => {
  const { employeeId } = req.params;
  const candResult = await req.db.query('SELECT * FROM employees WHERE id = $1', [employeeId]);
  const candidate = candResult.rows[0];
  if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

  // Candidate can update own resume; admin can update any
  if (req.user.role === 'candidate') {
    const meResult = await req.db.query('SELECT id FROM employees WHERE user_id = $1', [req.user.id]);
    const me = meResult.rows[0];
    if (!me || String(me.id) !== String(employeeId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }

  const { headline, summary, experience, education, skills, certifications, languages } = req.body;

  await req.db.query(`
    INSERT INTO candidate_resumes (candidate_id, headline, summary, experience, education, skills, certifications, languages, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    ON CONFLICT(candidate_id) DO UPDATE SET
      headline       = excluded.headline,
      summary        = excluded.summary,
      experience     = excluded.experience,
      education      = excluded.education,
      skills         = excluded.skills,
      certifications = excluded.certifications,
      languages      = excluded.languages,
      updated_at     = NOW()
  `, [
    employeeId,
    headline || null,
    summary || null,
    JSON.stringify(Array.isArray(experience) ? experience : []),
    JSON.stringify(Array.isArray(education)  ? education  : []),
    JSON.stringify(Array.isArray(skills)     ? skills     : []),
    JSON.stringify(Array.isArray(certifications) ? certifications : []),
    JSON.stringify(Array.isArray(languages)  ? languages  : []),
  ]);

  const savedResult = await req.db.query('SELECT * FROM candidate_resumes WHERE candidate_id = $1', [employeeId]);
  const saved = savedResult.rows[0];
  res.json({
    ...saved,
    employee_name: candidate.name,
    experience:     parseJson(saved.experience, []),
    education:      parseJson(saved.education, []),
    skills:         parseJson(saved.skills, []),
    certifications: parseJson(saved.certifications, []),
    languages:      parseJson(saved.languages, []),
  });
});

// GET /api/resumes/:employeeId/pdf
router.get('/:employeeId/pdf', async (req, res) => {
  const { employeeId } = req.params;
  const candResult = await req.db.query('SELECT * FROM employees WHERE id = $1', [employeeId]);
  const candidate = candResult.rows[0];
  if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

  const resumeResult = await req.db.query('SELECT * FROM candidate_resumes WHERE candidate_id = $1', [employeeId]);
  const resume = resumeResult.rows[0];
  const exp    = parseJson(resume?.experience, []);
  const edu    = parseJson(resume?.education, []);
  const skills = parseJson(resume?.skills, []);
  const certs  = parseJson(resume?.certifications, []);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="resume-${candidate.name.replace(/\s+/g,'-')}.pdf"`);
  doc.pipe(res);
  buildResumePdf(doc, candidate, resume, exp, edu, skills, certs);
  doc.end();
});

module.exports = router;

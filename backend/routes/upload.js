const express = require('express');
const router = express.Router();
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const bcrypt = require('bcryptjs');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');

// ── Multer: memory storage, CSV only, max 5MB ──────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_, file, cb) {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) cb(null, true);
    else cb(new Error('Only .csv files are accepted'));
  },
});

// ── Helpers ────────────────────────────────────────────────────────────────
// Validation helpers now centralised in validators.js
const { isValidDate, isValidEmail } = require('../middleware/validators');

/**
 * Validate that a buffer is plain text (CSV), not a disguised binary file.
 * Checks for:
 *  - Null bytes (universal binary indicator)
 *  - Known binary magic byte sequences (PDF, JPEG, PNG, ZIP, OLE)
 *
 * CSVs have no magic bytes of their own, but these checks reject all common
 * binary formats that could be uploaded with a .csv extension or text/csv MIME.
 */
function validateCsvMagicBytes(buffer) {
  const BINARY_MAGIC = [
    [0x25, 0x50, 0x44, 0x46],       // %PDF
    [0xFF, 0xD8, 0xFF],              // JPEG SOI
    [0x89, 0x50, 0x4E, 0x47],       // PNG
    [0x47, 0x49, 0x46, 0x38],       // GIF
    [0x50, 0x4B, 0x03, 0x04],       // ZIP / XLSX / DOCX
    [0xD0, 0xCF, 0x11, 0xE0],       // OLE2 compound (DOC, XLS)
    [0x42, 0x4D],                    // BMP
    [0x1F, 0x8B],                    // GZip
  ];

  // Check for binary magic sequences at start of file
  for (const sig of BINARY_MAGIC) {
    if (sig.every((byte, i) => buffer[i] === byte)) {
      throw new Error('File content does not appear to be a CSV (detected binary format)');
    }
  }

  // Check first 512 bytes for null bytes (strong indicator of binary data)
  const sample = Math.min(buffer.length, 512);
  for (let i = 0; i < sample; i++) {
    if (buffer[i] === 0x00) {
      throw new Error('File contains binary data (null bytes) — only plain-text CSV files are accepted');
    }
  }
}

function parseCSV(buffer) {
  validateCsvMagicBytes(buffer);
  return parse(buffer.toString('utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    comment: '#',
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATE DOWNLOADS
// ═══════════════════════════════════════════════════════════════════════════

const TEMPLATES = {
  candidates: `# HireIQ Employee Import Template
# Required columns: name, email, role, hourly_rate
# Optional columns: phone, alt_phone, personal_email, home_street, home_city, home_state, home_postcode, home_country
#                   client_name, start_date, end_date, status, contract_type, password
# status values: active | inactive | pending
# contract_type values: contractor | employee | part-time
name,email,role,hourly_rate,phone,alt_phone,personal_email,home_street,home_city,home_state,home_postcode,home_country,client_name,start_date,end_date,status,contract_type,password
Jane Smith,jane@example.com,Frontend Developer,80,+1-555-0200,+1-555-0299,jane.personal@gmail.com,123 Main St,New York,NY,10001,US,Acme Corporation,2026-01-01,,active,contractor,password123
John Doe,john@example.com,DevOps Engineer,90,+1-555-0201,,john@personal.com,456 Oak Ave,Austin,TX,78701,US,Tech Solutions Ltd,2026-01-15,,active,contractor,password123
`,

  emergency_contacts: `# HireIQ Emergency Contacts Import Template
# Required columns: employee_email, name, phone1
# Optional columns: relationship, phone2
employee_email,name,relationship,phone1,phone2
jane@example.com,Sarah Smith,Spouse,+1-555-9100,+1-555-9101
john@example.com,Mary Doe,Mother,+1-555-9200,
`,

  employment_history: `# HireIQ Employment History Import Template
# Required columns: employee_email, position_title, start_date
# Optional columns: end_date, remuneration, currency, frequency, notes
# frequency values: hourly | daily | weekly | monthly | annual
# currency: ISO 4217 code (USD, GBP, EUR, AUD, etc.)
employee_email,position_title,start_date,end_date,remuneration,currency,frequency,notes
jane@example.com,Junior Developer,2024-01-01,2025-06-30,60000,USD,annual,Initial hire
jane@example.com,Frontend Developer,2025-07-01,,80000,USD,annual,Promotion
john@example.com,DevOps Engineer,2026-01-15,,90,USD,hourly,Contract role
`,

  training_records: `# HireIQ Training Records Import Template
# Required columns: employee_email, training_date, name
# Optional columns: content, results
# date format: YYYY-MM-DD
employee_email,training_date,name,content,results
jane@example.com,2025-03-15,React Advanced Patterns,Hooks and context architecture,Passed — 92%
jane@example.com,2025-09-10,TypeScript Fundamentals,Type safety and generics,Completed
john@example.com,2026-02-20,AWS Solutions Architect,Cloud architecture and services,Passed — 88%
`,

  timesheets: `# HireIQ Timesheet Import Template
# Required columns: candidate_email, date, hours
# Optional columns: description, project, status
# status values: pending | approved | rejected
# date format: YYYY-MM-DD
candidate_email,date,hours,description,project,status
alice@hireiq.com,2026-03-25,8,API development work,Backend API,pending
alice@hireiq.com,2026-03-26,7.5,Code review and testing,Backend API,pending
bob@hireiq.com,2026-03-25,8,UI component work,Design System,pending
`,

  absences: `# HireIQ Absence Import Template
# Required columns: candidate_email, start_date, end_date, type
# Optional columns: status, notes
# type values: vacation | sick | personal | public_holiday | other
# status values: pending | approved | rejected
# date format: YYYY-MM-DD
candidate_email,start_date,end_date,type,status,notes
alice@hireiq.com,2026-04-01,2026-04-03,vacation,pending,Easter break
bob@hireiq.com,2026-04-10,2026-04-10,sick,pending,Doctor appointment
`,

  jobs: `# HireIQ Job Posting Import Template
# Required columns: title
# Optional columns: description, skills, client_name, location, contract_type, hourly_rate_min, hourly_rate_max, status
# contract_type values: contractor | employee | part-time
# status values: open | closed | draft
title,description,skills,client_name,location,contract_type,hourly_rate_min,hourly_rate_max,status
Senior React Developer,Build modern web apps with React and TypeScript,"React,TypeScript,Node.js",Acme Corporation,Remote,contractor,80,100,open
Cloud DevOps Engineer,Manage AWS infrastructure and CI/CD pipelines,"AWS,Terraform,Docker",Tech Solutions Ltd,New York NY,contractor,90,110,open
`,
};

router.get('/template/:type', authenticate, requireAdmin, injectTenantDb, (req, res) => {
  const { type } = req.params;
  if (!TEMPLATES[type]) return res.status(404).json({ error: 'Unknown template type' });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="hireiq_${type}_template.csv"`);
  res.send(TEMPLATES[type]);
});

// ═══════════════════════════════════════════════════════════════════════════
// CANDIDATES UPLOAD
// ═══════════════════════════════════════════════════════════════════════════

router.post('/candidates', authenticate, requireAdmin, injectTenantDb, upload.single('file'), (req, res) => {
  try {
    const rows = parseCSV(req.file.buffer);
    const imported = [], failed = [];

    // Build client name → id map
    const clientMap = {};
    req.db.prepare('SELECT id, name FROM clients').all().forEach(c => {
      clientMap[c.name.toLowerCase()] = c.id;
    });

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2; // 1-based + header
      try {
        // Validate required
        if (!r.name?.trim()) throw new Error('name is required');
        if (!r.email?.trim()) throw new Error('email is required');
        if (!isValidEmail(r.email)) throw new Error('invalid email format');
        if (!r.role?.trim()) throw new Error('role is required');
        const rate = parseFloat(r.hourly_rate);
        if (isNaN(rate) || rate < 0) throw new Error('hourly_rate must be a positive number');

        // Resolve client
        let client_id = null;
        if (r.client_name?.trim()) {
          client_id = clientMap[r.client_name.trim().toLowerCase()];
          if (!client_id) throw new Error(`client "${r.client_name}" not found — create it first`);
        }

        // Validate optional dates
        if (r.start_date && !isValidDate(r.start_date)) throw new Error('start_date must be YYYY-MM-DD');
        if (r.end_date && !isValidDate(r.end_date)) throw new Error('end_date must be YYYY-MM-DD');

        // Validate enums
        const validStatuses = ['active', 'inactive', 'pending'];
        const status = (r.status?.trim() || 'active');
        if (!validStatuses.includes(status)) throw new Error(`status must be one of: ${validStatuses.join(', ')}`);

        const validContractTypes = ['contractor', 'employee', 'part-time'];
        const contractType = (r.contract_type?.trim() || 'contractor');
        if (!validContractTypes.includes(contractType)) throw new Error(`contract_type must be one of: ${validContractTypes.join(', ')}`);

        // Check duplicate email
        const existingUser = req.db.prepare('SELECT id FROM users WHERE email = ?').get(r.email.trim().toLowerCase());
        if (existingUser) throw new Error(`email already exists: ${r.email}`);

        // Create user + candidate
        const password = r.password?.trim() || 'candidate123';
        const hash = bcrypt.hashSync(password, 10);
        const userResult = req.db.prepare(
          'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
        ).run(r.name.trim(), r.email.trim().toLowerCase(), hash, 'candidate');

        req.db.prepare(
          `INSERT INTO candidates (user_id, name, email, phone, role, hourly_rate, client_id, start_date, end_date, status, contract_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          userResult.lastInsertRowid,
          r.name.trim(),
          r.email.trim().toLowerCase(),
          r.phone?.trim() || null,
          r.role.trim(),
          rate,
          client_id,
          r.start_date?.trim() || null,
          r.end_date?.trim() || null,
          status,
          contractType,
        );

        const candRow = req.db.prepare('SELECT id FROM candidates WHERE email = ?').get(r.email.trim().toLowerCase());

        // Insert extended contact info if any extended fields provided
        if (candRow && (r.alt_phone || r.personal_email || r.home_street || r.home_city || r.home_state || r.home_postcode || r.home_country)) {
          req.db.prepare(`
            INSERT OR IGNORE INTO employee_contact_ext
              (candidate_id, alt_phone, personal_email, home_street, home_city, home_state, home_postcode, home_country)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            candRow.id,
            r.alt_phone?.trim() || null,
            r.personal_email?.trim() || null,
            r.home_street?.trim() || null,
            r.home_city?.trim() || null,
            r.home_state?.trim() || null,
            r.home_postcode?.trim() || null,
            r.home_country?.trim() || null,
          );
        }

        imported.push({ row: rowNum, name: r.name, email: r.email });
      } catch (err) {
        failed.push({ row: rowNum, data: r, error: err.message });
      }
    }

    res.json({
      total: rows.length,
      imported: imported.length,
      failed: failed.length,
      results: imported,
      errors: failed,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TIMESHEETS UPLOAD
// ═══════════════════════════════════════════════════════════════════════════

router.post('/timesheets', authenticate, requireAdmin, injectTenantDb, upload.single('file'), (req, res) => {
  try {
    const rows = parseCSV(req.file.buffer);
    const imported = [], failed = [];

    // Build email → candidate_id map
    const candidateMap = {};
    req.db.prepare('SELECT id, email FROM candidates').all().forEach(c => {
      candidateMap[c.email.toLowerCase()] = c.id;
    });

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;
      try {
        if (!r.candidate_email?.trim()) throw new Error('candidate_email is required');
        if (!isValidEmail(r.candidate_email)) throw new Error('invalid candidate_email');
        if (!r.date?.trim()) throw new Error('date is required');
        if (!isValidDate(r.date)) throw new Error('date must be YYYY-MM-DD');
        const hours = parseFloat(r.hours);
        if (isNaN(hours) || hours <= 0 || hours > 24) throw new Error('hours must be between 0 and 24');

        const candidateId = candidateMap[r.candidate_email.trim().toLowerCase()];
        if (!candidateId) throw new Error(`candidate "${r.candidate_email}" not found`);

        const validStatuses = ['pending', 'approved', 'rejected'];
        const status = r.status?.trim() || 'pending';
        if (!validStatuses.includes(status)) throw new Error(`status must be one of: ${validStatuses.join(', ')}`);

        req.db.prepare(
          'INSERT INTO time_entries (candidate_id, date, hours, description, project, status) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(candidateId, r.date.trim(), hours, r.description?.trim() || null, r.project?.trim() || null, status);

        imported.push({ row: rowNum, candidate: r.candidate_email, date: r.date, hours });
      } catch (err) {
        failed.push({ row: rowNum, data: r, error: err.message });
      }
    }

    res.json({ total: rows.length, imported: imported.length, failed: failed.length, results: imported, errors: failed });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ABSENCES UPLOAD
// ═══════════════════════════════════════════════════════════════════════════

router.post('/absences', authenticate, requireAdmin, injectTenantDb, upload.single('file'), (req, res) => {
  try {
    const rows = parseCSV(req.file.buffer);
    const imported = [], failed = [];

    const candidateMap = {};
    req.db.prepare('SELECT id, email FROM candidates').all().forEach(c => {
      candidateMap[c.email.toLowerCase()] = c.id;
    });

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;
      try {
        if (!r.candidate_email?.trim()) throw new Error('candidate_email is required');
        if (!r.start_date?.trim() || !isValidDate(r.start_date)) throw new Error('start_date must be YYYY-MM-DD');
        if (!r.end_date?.trim() || !isValidDate(r.end_date)) throw new Error('end_date must be YYYY-MM-DD');
        if (r.end_date < r.start_date) throw new Error('end_date cannot be before start_date');

        const validTypes = ['vacation', 'sick', 'personal', 'public_holiday', 'other'];
        const type = r.type?.trim();
        if (!type || !validTypes.includes(type)) throw new Error(`type must be one of: ${validTypes.join(', ')}`);

        const validStatuses = ['pending', 'approved', 'rejected'];
        const status = r.status?.trim() || 'pending';
        if (!validStatuses.includes(status)) throw new Error(`status must be one of: ${validStatuses.join(', ')}`);

        const candidateId = candidateMap[r.candidate_email.trim().toLowerCase()];
        if (!candidateId) throw new Error(`candidate "${r.candidate_email}" not found`);

        req.db.prepare(
          'INSERT INTO absences (candidate_id, start_date, end_date, type, status, notes) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(candidateId, r.start_date.trim(), r.end_date.trim(), type, status, r.notes?.trim() || null);

        imported.push({ row: rowNum, candidate: r.candidate_email, start_date: r.start_date, type });
      } catch (err) {
        failed.push({ row: rowNum, data: r, error: err.message });
      }
    }

    res.json({ total: rows.length, imported: imported.length, failed: failed.length, results: imported, errors: failed });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// JOBS UPLOAD
// ═══════════════════════════════════════════════════════════════════════════

router.post('/jobs', authenticate, requireAdmin, injectTenantDb, upload.single('file'), (req, res) => {
  try {
    const rows = parseCSV(req.file.buffer);
    const imported = [], failed = [];

    const clientMap = {};
    req.db.prepare('SELECT id, name FROM clients').all().forEach(c => {
      clientMap[c.name.toLowerCase()] = c.id;
    });

    const adminId = req.db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get()?.id;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;
      try {
        if (!r.title?.trim()) throw new Error('title is required');

        let client_id = null;
        if (r.client_name?.trim()) {
          client_id = clientMap[r.client_name.trim().toLowerCase()];
          if (!client_id) throw new Error(`client "${r.client_name}" not found`);
        }

        const validContractTypes = ['contractor', 'employee', 'part-time'];
        const contractType = r.contract_type?.trim() || 'contractor';
        if (!validContractTypes.includes(contractType)) throw new Error(`contract_type must be one of: ${validContractTypes.join(', ')}`);

        const validStatuses = ['open', 'closed', 'draft'];
        const status = r.status?.trim() || 'open';
        if (!validStatuses.includes(status)) throw new Error(`status must be one of: ${validStatuses.join(', ')}`);

        const rateMin = r.hourly_rate_min ? parseFloat(r.hourly_rate_min) : null;
        const rateMax = r.hourly_rate_max ? parseFloat(r.hourly_rate_max) : null;
        if (rateMin !== null && isNaN(rateMin)) throw new Error('hourly_rate_min must be a number');
        if (rateMax !== null && isNaN(rateMax)) throw new Error('hourly_rate_max must be a number');

        req.db.prepare(
          `INSERT INTO job_postings (title, description, skills, client_id, location, contract_type, hourly_rate_min, hourly_rate_max, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          r.title.trim(),
          r.description?.trim() || null,
          r.skills?.trim() || null,
          client_id,
          r.location?.trim() || null,
          contractType,
          rateMin,
          rateMax,
          status,
          adminId,
        );

        imported.push({ row: rowNum, title: r.title });
      } catch (err) {
        failed.push({ row: rowNum, data: r, error: err.message });
      }
    }

    res.json({ total: rows.length, imported: imported.length, failed: failed.length, results: imported, errors: failed });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// EMERGENCY CONTACTS UPLOAD
// ═══════════════════════════════════════════════════════════════════════════

router.post('/emergency-contacts', authenticate, requireAdmin, injectTenantDb, upload.single('file'), (req, res) => {
  try {
    const rows = parseCSV(req.file.buffer);
    const db = req.tenantDb;
    const imported = [], failed = [];

    rows.forEach((r, idx) => {
      const rowNum = idx + 2;
      try {
        if (!r.employee_email) throw new Error('employee_email is required');
        if (!r.name) throw new Error('name is required');
        if (!r.phone1) throw new Error('phone1 is required');

        const cand = db.prepare('SELECT id FROM candidates WHERE email = ? AND deleted_at IS NULL').get(r.employee_email.trim());
        if (!cand) throw new Error(`No employee found with email: ${r.employee_email}`);

        db.prepare('INSERT INTO emergency_contacts (candidate_id, name, relationship, phone1, phone2) VALUES (?, ?, ?, ?, ?)')
          .run(cand.id, r.name.trim(), r.relationship?.trim() || null, r.phone1.trim(), r.phone2?.trim() || null);

        imported.push({ row: rowNum, employee: r.employee_email, contact: r.name });
      } catch (err) {
        failed.push({ row: rowNum, data: r, error: err.message });
      }
    });

    res.json({ total: rows.length, imported: imported.length, failed: failed.length, results: imported, errors: failed });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// EMPLOYMENT HISTORY UPLOAD
// ═══════════════════════════════════════════════════════════════════════════

router.post('/employment-history', authenticate, requireAdmin, injectTenantDb, upload.single('file'), (req, res) => {
  try {
    const rows = parseCSV(req.file.buffer);
    const db = req.tenantDb;
    const imported = [], failed = [];
    const VALID_FREQ = ['hourly', 'daily', 'weekly', 'monthly', 'annual'];

    rows.forEach((r, idx) => {
      const rowNum = idx + 2;
      try {
        if (!r.employee_email) throw new Error('employee_email is required');
        if (!r.position_title) throw new Error('position_title is required');
        if (!r.start_date) throw new Error('start_date is required');

        const cand = db.prepare('SELECT id FROM candidates WHERE email = ? AND deleted_at IS NULL').get(r.employee_email.trim());
        if (!cand) throw new Error(`No employee found with email: ${r.employee_email}`);

        const frequency = r.frequency?.trim() || 'annual';
        if (!VALID_FREQ.includes(frequency)) throw new Error(`Invalid frequency. Must be one of: ${VALID_FREQ.join(', ')}`);

        db.prepare(`
          INSERT INTO employment_history (candidate_id, position_title, start_date, end_date, remuneration, currency, frequency, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          cand.id,
          r.position_title.trim(),
          r.start_date.trim(),
          r.end_date?.trim() || null,
          r.remuneration ? parseFloat(r.remuneration) : null,
          r.currency?.trim() || 'USD',
          frequency,
          r.notes?.trim() || null,
        );

        imported.push({ row: rowNum, employee: r.employee_email, position: r.position_title });
      } catch (err) {
        failed.push({ row: rowNum, data: r, error: err.message });
      }
    });

    res.json({ total: rows.length, imported: imported.length, failed: failed.length, results: imported, errors: failed });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TRAINING RECORDS UPLOAD
// ═══════════════════════════════════════════════════════════════════════════

router.post('/training-records', authenticate, requireAdmin, injectTenantDb, upload.single('file'), (req, res) => {
  try {
    const rows = parseCSV(req.file.buffer);
    const db = req.tenantDb;
    const imported = [], failed = [];

    rows.forEach((r, idx) => {
      const rowNum = idx + 2;
      try {
        if (!r.employee_email) throw new Error('employee_email is required');
        if (!r.training_date)  throw new Error('training_date is required');
        if (!r.name)           throw new Error('name (training name) is required');

        const cand = db.prepare('SELECT id FROM candidates WHERE email = ? AND deleted_at IS NULL').get(r.employee_email.trim());
        if (!cand) throw new Error(`No employee found with email: ${r.employee_email}`);

        db.prepare('INSERT INTO training_records (candidate_id, training_date, name, content, results) VALUES (?, ?, ?, ?, ?)')
          .run(cand.id, r.training_date.trim(), r.name.trim(), r.content?.trim() || null, r.results?.trim() || null);

        imported.push({ row: rowNum, employee: r.employee_email, training: r.name });
      } catch (err) {
        failed.push({ row: rowNum, data: r, error: err.message });
      }
    });

    res.json({ total: rows.length, imported: imported.length, failed: failed.length, results: imported, errors: failed });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

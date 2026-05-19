/**
 * ID Scan Routes — OCR-based bulk hiring  (module: hr_id_scan)
 *
 * POST  /api/id-scan/extract         — upload ID image/PDF → extract structured fields
 * POST  /api/id-scan/confirm         — link scan log to a newly-hired employee
 * PUT   /api/id-scan/logs/:id/skip   — mark a scan as skipped (no hire)
 * GET   /api/id-scan/logs            — admin: paginated scan audit log
 *
 * ── Vision provider resolution order ────────────────────────────────────────
 *  1. Ollama   — open-source, self-hosted (set OLLAMA_URL in env or tenant settings)
 *  2. Tesseract.js — zero-config local OCR + smart MRZ/pattern parsing (always available)
 *  3. Anthropic Claude — cloud (if ANTHROPIC_API_KEY / tenant api_key configured)
 *  4. OpenAI   — cloud (if OPENAI_API_KEY / tenant api_key configured)
 *
 * ── Security ─────────────────────────────────────────────────────────────────
 *  ID number is NEVER stored — only a SHA-256 hash is kept in id_scan_logs.
 *  Raw id_number is returned once in the extract response for the current session.
 */

'use strict';

const express  = require('express');
const multer   = require('multer');
const crypto   = require('crypto');
const { authenticate, requireAdmin, injectTenantDb, requireModule } = require('../middleware/auth');
const { masterDb } = require('../masterDatabase');

const router = express.Router();
router.use(authenticate, injectTenantDb, requireModule('hr_id_scan'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const OK = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    OK.includes(file.mimetype) ? cb(null, true) : cb(new Error(`Unsupported type: ${file.mimetype}`));
  },
});

// ── Utilities ─────────────────────────────────────────────────────────────────

function hashIdNumber(n) {
  if (!n) return null;
  return crypto.createHash('sha256').update(String(n).replace(/\s/g, '')).digest('hex');
}

function cleanJson(raw = '') {
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

/** Normalise any date string to YYYY-MM-DD.  Returns null if unparseable. */
function normaliseDate(str) {
  if (!str) return null;
  str = String(str).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;          // already ISO
  // DD/MM/YYYY or DD-MM-YYYY
  const m1 = str.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;
  // MM/DD/YYYY
  const m2 = str.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (m2) return `${m2[3]}-${m2[1]}-${m2[2]}`;
  // DD MMM YYYY  e.g. 01 JAN 2025
  const MONTHS = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12 };
  const m3 = str.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (m3) {
    const mo = MONTHS[m3[2].toUpperCase()];
    if (mo) return `${m3[3]}-${String(mo).padStart(2,'0')}-${m3[1].padStart(2,'0')}`;
  }
  // Try native Date parser as last resort
  const d = new Date(str);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return null;
}

// ── MRZ Parser (ICAO 9303) ────────────────────────────────────────────────────
// Highly accurate for passports & ID cards if the OCR picks up the MRZ zone.

function parseMrz(line1, line2) {
  if (!line1 || !line2) return null;
  const l1 = line1.replace(/\s/g, '').toUpperCase();
  const l2 = line2.replace(/\s/g, '').toUpperCase();

  // TD3 Passport: two lines of 44 chars
  if (l1.length === 44 && l2.length === 44 && l1.startsWith('P')) {
    const [surname, given] = l1.slice(5).split('<<');
    const first_name  = (given  || '').replace(/</g, ' ').trim() || null;
    const last_name   = (surname|| '').replace(/</g, ' ').trim() || null;
    const id_number   = l2.slice(0, 9).replace(/</g, '');
    const dob_raw     = l2.slice(13, 19); // YYMMDD
    const expiry_raw  = l2.slice(21, 27);
    const nationality = l2.slice(10, 13).replace(/</g, '');
    const gender_code = l2[20];

    const parseYYMMDD = (s) => {
      if (!s || s.length !== 6) return null;
      const yy = parseInt(s.slice(0,2), 10);
      const mm = s.slice(2,4);
      const dd = s.slice(4,6);
      const year = yy <= new Date().getFullYear() % 100 ? 2000 + yy : 1900 + yy;
      return `${year}-${mm}-${dd}`;
    };

    return {
      id_type:          'passport',
      id_number:        id_number || null,
      first_name,
      last_name,
      full_name:        [first_name, last_name].filter(Boolean).join(' ') || null,
      date_of_birth:    parseYYMMDD(dob_raw),
      expiry_date:      parseYYMMDD(expiry_raw),
      nationality:      nationality || null,
      gender:           gender_code === 'M' ? 'male' : gender_code === 'F' ? 'female' : null,
      mrz_line1:        l1,
      mrz_line2:        l2,
      confidence:       0.92,   // MRZ data is highly reliable
    };
  }
  return null;
}

// ── Pattern-based field extraction from raw OCR text ────────────────────────
// Used when Tesseract is the provider — we parse raw text into structured fields.

function extractFieldsFromText(text) {
  const t = text.replace(/\r/g, '\n');
  const upper = t.toUpperCase();
  const fields = {
    id_type: null, full_name: null, first_name: null, middle_name: null, last_name: null,
    date_of_birth: null, gender: null, id_number: null, expiry_date: null, issue_date: null,
    issuing_country: null, nationality: null,
    address_line1: null, address_line2: null, city: null, state: null, postcode: null, country: null,
    mrz_line1: null, mrz_line2: null, confidence: 0.55,
  };

  // ── Detect ID type ──────────────────────────────────────────────────────────
  if (/PASSPORT|PASSEPORT/i.test(t))               fields.id_type = 'passport';
  else if (/DRIVER.S\s+LICEN[SC]E|DRIVING\s+LICEN/i.test(t)) fields.id_type = 'drivers_license';
  else if (/NATIONAL\s+ID|IDENTITY\s+CARD|CARTE\s+NATIONALE/i.test(t)) fields.id_type = 'national_id';
  else if (/RESIDENCE\s+CARD|RESIDENT\s+ALIEN|GREEN\s+CARD/i.test(t)) fields.id_type = 'residence_card';
  else fields.id_type = 'other';

  // ── MRZ lines (40+ chars of mostly uppercase + < chars) ─────────────────────
  const mrzRe = /^[A-Z0-9<]{30,44}$/;
  const mrzCandidates = t.split('\n').map(l => l.trim()).filter(l => mrzRe.test(l));
  if (mrzCandidates.length >= 2) {
    fields.mrz_line1 = mrzCandidates[0];
    fields.mrz_line2 = mrzCandidates[1];
    const mrzParsed = parseMrz(mrzCandidates[0], mrzCandidates[1]);
    if (mrzParsed) {
      return { ...fields, ...mrzParsed };   // MRZ is authoritative — use it
    }
  }

  // ── Surname / Given name labels ──────────────────────────────────────────────
  const surnameMatch  = t.match(/(?:SURNAME|LAST\s+NAME|FAMILY\s+NAME)[:\s]+([A-Za-z\s\-']+)/i);
  const givenMatch    = t.match(/(?:GIVEN\s+NAMES?|FIRST\s+NAME|FORENAME|PRENOM)[:\s]+([A-Za-z\s\-']+)/i);
  if (surnameMatch) fields.last_name  = surnameMatch[1].trim().split('\n')[0];
  if (givenMatch)  fields.first_name = givenMatch[1].trim().split('\n')[0];
  if (fields.first_name || fields.last_name) {
    fields.full_name = [fields.first_name, fields.last_name].filter(Boolean).join(' ');
  }

  // ── Date of Birth ────────────────────────────────────────────────────────────
  const dobMatch = t.match(/(?:DATE\s+OF\s+BIRTH|DOB|BIRTH\s+DATE|BORN|NAISS|NACIMIENTO)[:\s]+([0-9A-Za-z\/\-\. ]+)/i);
  if (dobMatch) fields.date_of_birth = normaliseDate(dobMatch[1].trim().split('\n')[0].split(' ').slice(0,3).join(' '));

  // ── Expiry date ──────────────────────────────────────────────────────────────
  const expMatch = t.match(/(?:EXPIRY|EXPIRATION|EXPIRES?|VALID\s+UNTIL|DATE\s+D.EXPIRATION)[:\s]+([0-9A-Za-z\/\-\. ]+)/i);
  if (expMatch) fields.expiry_date = normaliseDate(expMatch[1].trim().split('\n')[0].split(' ').slice(0,3).join(' '));

  // ── Issue date ───────────────────────────────────────────────────────────────
  const issMatch = t.match(/(?:DATE\s+OF\s+ISSUE|ISSUED\s+ON|DATE\s+ISSUED|DATE\s+D.EMISSION)[:\s]+([0-9A-Za-z\/\-\. ]+)/i);
  if (issMatch) fields.issue_date = normaliseDate(issMatch[1].trim().split('\n')[0].split(' ').slice(0,3).join(' '));

  // ── Gender ───────────────────────────────────────────────────────────────────
  const genderMatch = t.match(/(?:SEX|GENDER|SEXE)[:\s]+([MFX])/i);
  if (genderMatch) {
    const g = genderMatch[1].toUpperCase();
    fields.gender = g === 'M' ? 'male' : g === 'F' ? 'female' : 'other';
  }

  // ── Document number ──────────────────────────────────────────────────────────
  const numMatch = t.match(/(?:PASSPORT\s+NO\.?|DOCUMENT\s+NO\.?|LICENCE\s+NO\.?|ID\s+NO\.?|NO\.?\s+)[:\s]+([A-Z0-9]{6,20})/i);
  if (numMatch) fields.id_number = numMatch[1];

  // ── Nationality ──────────────────────────────────────────────────────────────
  const natMatch = t.match(/(?:NATIONALITY|NATIONALITE)[:\s]+([A-Za-z ]+)/i);
  if (natMatch) fields.nationality = natMatch[1].trim().split('\n')[0];

  // ── Address ──────────────────────────────────────────────────────────────────
  const addrMatch = t.match(/(?:ADDRESS|ADRESSE|DOMICILE|RESIDENCE)[:\s]+([^\n]+)/i);
  if (addrMatch) fields.address_line1 = addrMatch[1].trim();
  const postcodeMatch = t.match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}|\d{4,6})\b/);
  if (postcodeMatch) fields.postcode = postcodeMatch[1];

  return fields;
}

// ── AI Extraction Prompt ──────────────────────────────────────────────────────
const EXTRACTION_PROMPT = `You are an expert identity document analyst. Examine the provided document and extract every readable field.

Return ONLY a valid JSON object — no markdown, no explanation — with these exact fields (null if not found):

{
  "id_type": "passport|drivers_license|national_id|residence_card|other",
  "full_name": "complete name as printed",
  "first_name": "given/first name",
  "middle_name": "middle name or null",
  "last_name": "family/surname",
  "date_of_birth": "YYYY-MM-DD",
  "gender": "male|female|other|null",
  "id_number": "document number exactly as shown",
  "expiry_date": "YYYY-MM-DD",
  "issue_date": "YYYY-MM-DD",
  "issuing_country": "full country name",
  "nationality": "nationality or null",
  "address_line1": "street address or null",
  "address_line2": "apt/suite or null",
  "city": "city or null",
  "state": "state/province or null",
  "postcode": "postal code or null",
  "country": "country of address or null",
  "mrz_line1": "first MRZ line verbatim if visible or null",
  "mrz_line2": "second MRZ line verbatim if visible or null",
  "confidence": 0.0
}

Normalise all dates to YYYY-MM-DD. confidence: 1.0=fully legible, 0.5=partial, 0.1=very poor.
Return ONLY the JSON.`;

// ── Vision providers ──────────────────────────────────────────────────────────

/** 1. Ollama — open-source, self-hosted */
async function extractWithOllama(baseUrl, model, fileBuffer, mimeType) {
  if (!mimeType.startsWith('image/')) {
    throw new Error('Ollama vision requires an image (JPEG/PNG). Please convert the PDF to an image first.');
  }
  const base64 = fileBuffer.toString('base64');
  const url = `${baseUrl.replace(/\/$/, '')}/api/generate`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:  model || 'llama3.2-vision',
      prompt: EXTRACTION_PROMPT,
      images: [base64],
      stream: false,
      format: 'json',
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Ollama error ${response.status}: ${err}`);
  }

  const data  = await response.json();
  const raw   = data.response || '';
  return JSON.parse(cleanJson(raw));
}

/** 2. Tesseract.js — always available, zero-config, open-source */
async function extractWithTesseract(fileBuffer, mimeType) {
  if (mimeType === 'application/pdf') {
    throw new Error('Tesseract mode does not support PDFs directly. Please upload a JPEG or PNG image.');
  }
  const { createWorker } = require('tesseract.js');
  const worker = await createWorker('eng', 1, { logger: () => {} });
  try {
    const { data: { text, confidence } } = await worker.recognize(fileBuffer);
    const fields = extractFieldsFromText(text);
    // Tesseract returns confidence 0–100; normalise to 0–1
    if (!fields.confidence || fields.confidence < 0.1) {
      fields.confidence = Math.round((confidence / 100) * 0.8 * 100) / 100; // cap at 0.8 for text-only
    }
    return fields;
  } finally {
    await worker.terminate();
  }
}

/** 3. Anthropic Claude Vision */
async function extractWithClaude(apiKey, fileBuffer, mimeType) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic({ apiKey });
  const base64    = fileBuffer.toString('base64');
  const isImage   = mimeType.startsWith('image/');

  const contentBlock = isImage
    ? { type: 'image',    source: { type: 'base64', media_type: mimeType, data: base64 } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };

  const resp = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: EXTRACTION_PROMPT }] }],
  });

  const raw = resp.content.find(b => b.type === 'text')?.text || '';
  return JSON.parse(cleanJson(raw));
}

/** 4. OpenAI Vision */
async function extractWithOpenAI(apiKey, fileBuffer, mimeType) {
  if (!mimeType.startsWith('image/')) {
    throw new Error('OpenAI vision requires an image file.');
  }
  const OpenAI  = require('openai');
  const client  = new OpenAI({ apiKey });
  const base64  = fileBuffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const resp = await client.chat.completions.create({
    model:      'gpt-4o',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
        { type: 'text', text: EXTRACTION_PROMPT },
      ],
    }],
  });

  const raw = resp.choices[0]?.message?.content || '';
  return JSON.parse(cleanJson(raw));
}

// ── Provider resolution ───────────────────────────────────────────────────────

async function resolveOcr(db, fileBuffer, mimeType) {
  const ollamaModel = process.env.OLLAMA_VISION_MODEL || 'llama3.2-vision';

  // 1. Ollama (open-source, self-hosted) — best quality, zero cost
  const ollamaUrl = process.env.OLLAMA_URL;
  if (ollamaUrl) {
    return extractWithOllama(ollamaUrl, ollamaModel, fileBuffer, mimeType);
  }
  try {
    const r = await db.query('SELECT ollama_url, ollama_model FROM ai_settings WHERE id=1');
    const row = r.rows[0];
    if (row?.ollama_url) {
      return extractWithOllama(row.ollama_url, row.ollama_model || ollamaModel, fileBuffer, mimeType);
    }
  } catch { /* ai_settings may not exist yet */ }

  // 2. Anthropic Claude Vision — far more accurate than Tesseract for ID docs
  //    Check env var first, then tenant settings, then platform config
  try {
    const anthropicKey = await getCloudKey(db, 'anthropic');
    if (anthropicKey) {
      console.log('[id-scan] Using Claude Vision');
      return await extractWithClaude(anthropicKey, fileBuffer, mimeType);
    }
  } catch (err) {
    console.warn('[id-scan] Claude fallback failed:', err.message);
  }

  // 3. OpenAI GPT-4o Vision
  try {
    const openaiKey = await getCloudKey(db, 'openai');
    if (openaiKey) {
      console.log('[id-scan] Using OpenAI Vision');
      return await extractWithOpenAI(openaiKey, fileBuffer, mimeType);
    }
  } catch (err) {
    console.warn('[id-scan] OpenAI fallback failed:', err.message);
  }

  // 4. Tesseract.js — last resort, text-only OCR (limited accuracy for IDs)
  if (mimeType.startsWith('image/')) {
    console.log('[id-scan] Falling back to Tesseract.js (limited accuracy — configure an AI key for better results)');
    try {
      return await extractWithTesseract(fileBuffer, mimeType);
    } catch (tessErr) {
      console.warn('[id-scan] Tesseract failed:', tessErr.message);
    }
  }

  throw new Error('No OCR provider available. Configure ANTHROPIC_API_KEY or OLLAMA_URL in Railway environment variables for accurate ID extraction.');
}

async function getCloudKey(db, provider) {
  try {
    const r = await db.query('SELECT api_key, provider FROM ai_settings WHERE id=1');
    const row = r.rows[0];
    if (row?.api_key && (row.provider || 'anthropic') === provider) return row.api_key;
  } catch { /* ignore */ }
  try {
    const r = await masterDb.query('SELECT api_key, provider FROM platform_ai_config WHERE id=1');
    const row = r.rows[0];
    if (row?.api_key && (row.provider || 'anthropic') === provider) return row.api_key;
  } catch { /* ignore */ }
  const envKey = provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
  return envKey || null;
}

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/id-scan/extract
// ═════════════════════════════════════════════════════════════════════════════
router.post('/extract', requireAdmin, upload.single('id_image'), async (req, res) => {
  const db = req.db;
  let scanLogId = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Send an image or PDF as field "id_image".' });
    }

    let extracted;
    try {
      extracted = await resolveOcr(db, req.file.buffer, req.file.mimetype);
    } catch (ocrErr) {
      const logRes = await db.query(
        `INSERT INTO id_scan_logs (scanned_by, outcome, error_message) VALUES ($1,'failed',$2) RETURNING id`,
        [req.user.id, ocrErr.message]
      );
      return res.status(422).json({ error: ocrErr.message, scan_log_id: logRes.rows[0]?.id });
    }

    // Normalise dates that AI might have returned in non-ISO formats
    ['date_of_birth', 'expiry_date', 'issue_date'].forEach(k => {
      if (extracted[k]) extracted[k] = normaliseDate(extracted[k]) ?? extracted[k];
    });

    // Hash ID number — never persist plaintext
    const idHash = hashIdNumber(extracted.id_number);

    const logRes = await db.query(`
      INSERT INTO id_scan_logs (scanned_by, id_type, id_number_hash, outcome, extracted_name, confidence)
      VALUES ($1, $2, $3, 'extracted', $4, $5) RETURNING id
    `, [req.user.id, extracted.id_type || null, idHash, extracted.full_name || null, extracted.confidence || null]);
    scanLogId = logRes.rows[0]?.id;

    // Build warnings
    const warnings = [];
    if (!extracted.confidence || extracted.confidence < 0.5)  warnings.push('Low confidence — verify all fields.');
    if (!extracted.first_name && !extracted.full_name)        warnings.push('Name not detected — document may be unclear.');
    if (!extracted.date_of_birth)                             warnings.push('Date of birth not found.');
    if (!extracted.id_number)                                 warnings.push('ID number not found.');

    res.json({ scan_log_id: scanLogId, extracted, warnings });

  } catch (err) {
    console.error('[id-scan/extract]', err.message);
    res.status(500).json({ error: err.message, scan_log_id: scanLogId });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/id-scan/confirm
// Body: { scan_log_id, employee_id }
// ═════════════════════════════════════════════════════════════════════════════
router.post('/confirm', requireAdmin, async (req, res) => {
  const { scan_log_id, employee_id } = req.body;
  if (!scan_log_id || !employee_id) {
    return res.status(400).json({ error: 'scan_log_id and employee_id are required' });
  }
  try {
    const result = await req.db.query(
      `UPDATE id_scan_logs SET outcome='hired', employee_id=$2 WHERE id=$1 RETURNING id, outcome, employee_id`,
      [scan_log_id, employee_id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Scan log not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// PUT /api/id-scan/logs/:id/skip
// ═════════════════════════════════════════════════════════════════════════════
router.put('/logs/:id/skip', requireAdmin, async (req, res) => {
  try {
    const r = await req.db.query(
      `UPDATE id_scan_logs SET outcome='skipped' WHERE id=$1 RETURNING id, outcome`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Scan log not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/id-scan/logs?page=1&limit=50
// ═════════════════════════════════════════════════════════════════════════════
router.get('/logs', requireAdmin, async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit  = Math.min(100, parseInt(req.query.limit || '50', 10));
    const offset = (page - 1) * limit;

    const rows = await req.db.query(`
      SELECT sl.id, sl.scan_time, sl.id_type, sl.outcome,
             sl.extracted_name, sl.confidence, sl.error_message, sl.employee_id,
             e.name  AS employee_name,
             u.email AS scanned_by_email
      FROM id_scan_logs sl
      LEFT JOIN users     u ON u.id = sl.scanned_by
      LEFT JOIN employees e ON e.id = sl.employee_id
      ORDER BY sl.scan_time DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const countRes = await req.db.query('SELECT COUNT(*) FROM id_scan_logs');
    const total    = parseInt(countRes.rows[0].count, 10);

    res.json({ logs: rows.rows, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/id-scan/config — which OCR provider is active
// ═════════════════════════════════════════════════════════════════════════════
router.get('/config', requireAdmin, async (req, res) => {
  try {
    const ollamaUrl = process.env.OLLAMA_URL || null;
    const anthropicKey = await getCloudKey(req.db, 'anthropic');
    const openaiKey    = await getCloudKey(req.db, 'openai');

    // Check tenant Ollama config
    let tenantOllamaUrl = null;
    try {
      const r = await req.db.query('SELECT ollama_url FROM ai_settings WHERE id=1');
      tenantOllamaUrl = r.rows[0]?.ollama_url || null;
    } catch { /* ignore */ }

    const providers = [];
    if (ollamaUrl || tenantOllamaUrl) providers.push({ name: 'Ollama (open-source)', status: 'active', url: ollamaUrl || tenantOllamaUrl });
    providers.push({ name: 'Tesseract.js (open-source, local)', status: 'active', note: 'Always available for image files' });
    if (anthropicKey) providers.push({ name: 'Claude Vision', status: 'configured' });
    if (openaiKey)    providers.push({ name: 'OpenAI GPT-4o', status: 'configured' });

    res.json({ providers, active: providers[0]?.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

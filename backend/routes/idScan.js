/**
 * ID Scan Routes — OCR-based bulk hiring  (module: hr_id_scan)
 *
 * POST  /api/id-scan/extract         — upload ID image/PDF → extract structured fields
 * POST  /api/id-scan/confirm         — link scan log to a newly-hired employee
 * PUT   /api/id-scan/logs/:id/skip   — mark a scan as skipped (no hire)
 * GET   /api/id-scan/logs            — admin: paginated scan audit log
 * GET   /api/id-scan/supported-docs  — list supported countries + ID types
 * GET   /api/id-scan/config          — which OCR provider is active
 *
 * ── Vision provider resolution order ────────────────────────────────────────
 *  1. Ollama   — open-source, self-hosted (set OLLAMA_URL in env or tenant settings)
 *  2. Anthropic Claude — cloud vision AI (if ANTHROPIC_API_KEY configured)
 *  3. OpenAI   — cloud vision AI (if OPENAI_API_KEY configured)
 *  4. Tesseract.js — zero-config local OCR with Sharp preprocessing + country templates
 *
 * ── Tesseract pipeline ────────────────────────────────────────────────────────
 *  Raw image → Sharp preprocess (grayscale/contrast/upscale) → initial Tesseract
 *  pass (eng) → detectTemplate() → re-run Tesseract with country language hint →
 *  applyTemplate() for country-specific field extraction → MRZ parse if present
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
const {
  detectTemplate,
  detectTemplateWithRegion,
  applyTemplate,
  getTessLang,
  getSupportedDocuments,
  getSupportedDocumentsWithRegions,
  getRegionCodes,
} = require('../services/idTemplates');

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
// Two-pass approach:
//   1. Labeled extraction  — regex for "SURNAME: Smith" style labels (accurate when present)
//   2. Unlabeled heuristics — smart patterns for IDs that don't print field labels

const DOC_NOISE_WORDS = new Set([
  'PASSPORT','PASSEPORT','REISEPASS','DRIVING','DRIVER','LICENCE','LICENSE','NATIONAL',
  'IDENTITY','CARD','CARTE','NATIONALE','REPUBLIC','REPUBLIQUE','AUSTRALIA','AUSTRALIAN',
  'UNITED','KINGDOM','STATES','AMERICA','FRANCE','GERMANY','INDIA','SINGAPORE','CANADA',
  'ZEALAND','SOUTH','AFRICA','EMIRATES','ARAB','PHILIPPINES','GOVERNMENT','DEPARTMENT',
  'TRANSPORT','VTROADS','ICROADS','DVLA','NZTA','UIDAI','AADHAAR','PHILSYS',
  'BUNDESREPUBLIK','DEUTSCHLAND','PERSONALAUSWEIS','AUTHORITY','MINISTRY','BUREAU',
  'PLACE','OF','BIRTH','DATE','EXPIRY','ISSUE','ISSUED','VALID','THROUGH','UNTIL',
  'SEX','GENDER','NATIONALITY','SIGNATURE','HEIGHT','EYES','HAIR','WEIGHT','CLASS',
  'ENDORSEMENTS','RESTRICTIONS','DONOR','ORGAN','VETERAN','VETERAN','FEDERAL',
]);

function extractFieldsFromText(text) {
  const t = text.replace(/\r/g, '\n');
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
  const fields = {
    id_type: null, full_name: null, first_name: null, middle_name: null, last_name: null,
    date_of_birth: null, gender: null, id_number: null, expiry_date: null, issue_date: null,
    issuing_country: null, nationality: null,
    address_line1: null, address_line2: null, city: null, state: null, postcode: null, country: null,
    mrz_line1: null, mrz_line2: null, confidence: 0.55,
  };

  // ── Detect ID type ──────────────────────────────────────────────────────────
  if (/PASSPORT|PASSEPORT|REISEPASS/i.test(t))          fields.id_type = 'passport';
  else if (/DRIVER.S?\s+LICEN[SC]E|DRIVING\s+LICEN/i.test(t)) fields.id_type = 'drivers_license';
  else if (/NATIONAL\s+ID|IDENTITY\s+CARD|CARTE\s+NATIONALE|NRIC|AADHAAR|PHILSYS|EMIRATES\s+ID|PERSONALAUSWEIS/i.test(t)) fields.id_type = 'national_id';
  else if (/RESIDENCE\s+CARD|RESIDENT\s+ALIEN|GREEN\s+CARD/i.test(t)) fields.id_type = 'residence_card';
  else fields.id_type = 'other';

  // ── MRZ lines (30–44 chars of uppercase + < chars) ──────────────────────────
  const mrzRe = /^[A-Z0-9<]{30,44}$/;
  const mrzCandidates = lines.filter(l => mrzRe.test(l));
  if (mrzCandidates.length >= 2) {
    fields.mrz_line1 = mrzCandidates[0];
    fields.mrz_line2 = mrzCandidates[1];
    const mrzParsed = parseMrz(mrzCandidates[0], mrzCandidates[1]);
    if (mrzParsed) {
      return { ...fields, ...mrzParsed };   // MRZ is authoritative
    }
  }

  // ── PASS 1: Labeled field extraction ─────────────────────────────────────────
  const surnameMatch  = t.match(/(?:SURNAME|LAST\s+NAME|FAMILY\s+NAME|NOM(?!\s+DE\s+NAISSANCE)|NACHNAME)[:\s]+([A-Za-zÀ-ÿ\s\-']+)/i);
  const givenMatch    = t.match(/(?:GIVEN\s+NAMES?|FIRST\s+NAME|FORENAMES?|PRENOM|VORNAME)[:\s]+([A-Za-zÀ-ÿ\s\-']+)/i);
  const fullNameMatch = t.match(/(?:^|\n)NAME[:\s]+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\-']+)(?:\n|$)/im);

  if (surnameMatch) fields.last_name  = surnameMatch[1].trim().split('\n')[0].replace(/\s+/g,' ');
  if (givenMatch)   fields.first_name = givenMatch[1].trim().split('\n')[0].replace(/\s+/g,' ');
  if (fullNameMatch && !fields.last_name && !fields.first_name) {
    fields.full_name = fullNameMatch[1].trim().replace(/\s+/g,' ');
  }
  if (fields.first_name || fields.last_name) {
    fields.full_name = [fields.first_name, fields.last_name].filter(Boolean).join(' ');
  }

  // ── Labeled dates ────────────────────────────────────────────────────────────
  const dobMatch = t.match(/(?:DATE\s+OF\s+BIRTH|D\.?O\.?B\.?|BIRTH\s+DATE|BORN|NÉ\(?E?\)?[\s,]+LE|DATE\s+DE\s+NAISSANCE|GEBURTSDATUM)[:\s]+([0-9A-Za-z\/\-\. ]+)/i);
  const expMatch = t.match(/(?:EXPIR(?:Y|ATION|ES?)|VALID\s+(?:UNTIL|THRU?|TO)|DATE\s+D.EXPIR|GÜLTIG\s+BIS|VALIDE)[:\s]+([0-9A-Za-z\/\-\. ]+)/i);
  const issMatch = t.match(/(?:DATE\s+OF\s+ISSUE|DATE\s+ISSUED|ISSUED\s+ON|DATE\s+D.ÉMISSION|AUSSTELLUNGSDATUM)[:\s]+([0-9A-Za-z\/\-\. ]+)/i);

  if (dobMatch) fields.date_of_birth = normaliseDate(dobMatch[1].trim().split('\n')[0].replace(/\s+/g,' ').split(' ').slice(0,3).join(' '));
  if (expMatch) fields.expiry_date   = normaliseDate(expMatch[1].trim().split('\n')[0].replace(/\s+/g,' ').split(' ').slice(0,3).join(' '));
  if (issMatch) fields.issue_date    = normaliseDate(issMatch[1].trim().split('\n')[0].replace(/\s+/g,' ').split(' ').slice(0,3).join(' '));

  // ── Labeled doc number ───────────────────────────────────────────────────────
  const numMatch = t.match(/(?:PASSPORT\s+NO\.?|DOCUMENT\s+NO\.?|LICENCE\s+NO\.?|DL\s*(?:#|NO\.?)|ID\s+NO\.?|NO\.?\s*)[:\s]+([A-Z0-9]{5,20})/i);
  if (numMatch) fields.id_number = numMatch[1];

  // ── Labeled gender ────────────────────────────────────────────────────────────
  const genderMatch = t.match(/(?:SEX|GENDER|SEXE|GESCHLECHT)[:\s]+([MFX])\b/i);
  if (genderMatch) {
    const g = genderMatch[1].toUpperCase();
    fields.gender = g === 'M' ? 'male' : g === 'F' ? 'female' : 'other';
  } else if (/\bMALE\b/i.test(t) && !/\bFEMALE\b/i.test(t)) {
    fields.gender = 'male';
  } else if (/\bFEMALE\b/i.test(t)) {
    fields.gender = 'female';
  }

  // ── PASS 2: Unlabeled heuristics (for IDs without field labels) ──────────────
  // Collect ALL date-looking strings from the entire text
  const ALL_DATE_PATTERNS = [
    /\b(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})\b/g,   // DD/MM/YYYY or MM/DD/YYYY
    /\b(\d{4}[\/\-]\d{2}[\/\-]\d{2})\b/g,         // YYYY-MM-DD
    /\b(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+\d{4})\b/ig,
    /\b(\d{2}[\/\.]\d{2}[\/\.]\d{2})\b/g,         // DD/MM/YY
  ];
  const foundDates = [];
  for (const re of ALL_DATE_PATTERNS) {
    let m;
    while ((m = re.exec(t)) !== null) {
      const norm = normaliseDate(m[1]);
      if (norm && !foundDates.includes(norm)) foundDates.push(norm);
    }
  }

  // Assign unlabeled dates by plausibility
  // DOB: should be ≥18 years ago and ≤120 years ago
  const now = new Date();
  const dobCandidates = foundDates.filter(d => {
    const diff = (now - new Date(d)) / (365.25 * 24 * 3600 * 1000);
    return diff >= 16 && diff <= 120;
  });
  const futureOrRecent = foundDates.filter(d => new Date(d) >= new Date(now.getFullYear() - 2, 0, 1));

  if (!fields.date_of_birth && dobCandidates.length > 0) {
    fields.date_of_birth = dobCandidates[0];
  }
  if (!fields.expiry_date && futureOrRecent.length > 0) {
    // prefer expiry to be most-future date
    fields.expiry_date = futureOrRecent.sort().reverse()[0];
  }

  // ── Unlabeled name heuristics ─────────────────────────────────────────────────
  // Find lines that look like a person's name: 2-4 words, all alpha, Title Case or ALL CAPS,
  // no doc-noise words, length 4–40 chars per word
  if (!fields.full_name) {
    const nameCandidates = lines.filter(line => {
      const words = line.split(/\s+/);
      if (words.length < 2 || words.length > 5) return false;
      // All words should be alphabetic (allow hyphens, apostrophes)
      if (!words.every(w => /^[A-ZÀ-Ÿa-zà-ÿ][A-ZÀ-Ÿa-zà-ÿ\-']{1,30}$/.test(w))) return false;
      // No doc-noise words
      if (words.some(w => DOC_NOISE_WORDS.has(w.toUpperCase()))) return false;
      // Must be either all-caps or title case (not mixed-digit)
      if (!/[A-Za-zÀ-ÿ]/.test(line)) return false;
      // Should not look like an address (contains numbers)
      if (/\d/.test(line)) return false;
      return true;
    });

    if (nameCandidates.length > 0) {
      // Prefer lines near the top (after doc type) and that are longer
      const best = nameCandidates[0];
      fields.full_name = best.replace(/\s+/g, ' ').trim();
      const parts = fields.full_name.split(' ');
      if (parts.length >= 2) {
        // Normalise to Title Case
        const toTitle = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
        fields.first_name = toTitle(parts[0]);
        fields.last_name  = toTitle(parts[parts.length - 1]);
        if (parts.length > 2) {
          fields.middle_name = parts.slice(1, -1).map(toTitle).join(' ');
        }
        fields.full_name = parts.map(toTitle).join(' ');
      }
    }
  }

  // ── Unlabeled doc number heuristics ──────────────────────────────────────────
  if (!fields.id_number) {
    // Passport: one letter + 7–8 digits
    const passportNo = t.match(/\b([A-Z]\d{7,8})\b/);
    if (passportNo && fields.id_type === 'passport') {
      fields.id_number = passportNo[1];
    }
    // Generic alphanumeric code 6–12 chars on its own line
    if (!fields.id_number) {
      const standalone = lines.find(l => /^[A-Z0-9]{6,15}$/.test(l) && !/^[A-Z]{2,4}$/.test(l));
      if (standalone) fields.id_number = standalone;
    }
  }

  // ── Nationality ──────────────────────────────────────────────────────────────
  const natMatch = t.match(/(?:NATIONALITY|NATIONALITÉ|STAATSANGEHÖRIGKEIT)[:\s]+([A-Za-zÀ-ÿ ]+)/i);
  if (natMatch) fields.nationality = natMatch[1].trim().split('\n')[0].replace(/\s+/g,' ');

  // ── Address ──────────────────────────────────────────────────────────────────
  const addrMatch = t.match(/(?:ADDRESS|ADRESSE|DOMICILE|RESIDENCE)[:\s]+([^\n]+)/i);
  if (addrMatch) fields.address_line1 = addrMatch[1].trim();
  // UK/AU postcode or US ZIP
  const postcodeMatch = t.match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}|\d{4,5}(?:-\d{4})?)\b/);
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

// ── Sharp image preprocessing ─────────────────────────────────────────────────
// Dramatically improves Tesseract accuracy on ID photos taken with a camera.
// Pipeline: resize-to-min-300dpi-equivalent → grayscale → normalise → sharpen →
//           adaptive threshold (binarise text) → output as PNG for Tesseract.

async function preprocessImageForOcr(fileBuffer) {
  try {
    const sharp = require('sharp');
    const metadata = await sharp(fileBuffer).metadata();
    const w = metadata.width || 0;
    const h = metadata.height || 0;

    // Scale up if the image is smaller than ~1200px on the longest axis
    // (typical ID photo from a phone at ≥300dpi will be ~1800×1200)
    const minDim = Math.max(w, h);
    const scaleFactor = minDim < 1200 ? Math.min(3, 1200 / minDim) : 1;

    const processed = await sharp(fileBuffer)
      .resize(
        Math.round(w * scaleFactor),
        Math.round(h * scaleFactor),
        { fit: 'fill', kernel: 'lanczos3' }
      )
      .grayscale()
      .normalise()                          // auto-levels: boost contrast
      .sharpen({ sigma: 1.5 })             // crisp text edges
      .threshold(128)                       // binarise — pure B&W is faster for Tesseract
      .png()
      .toBuffer();

    console.log(`[id-scan/preprocess] ${w}×${h} → ${Math.round(w*scaleFactor)}×${Math.round(h*scaleFactor)}, scale=${scaleFactor.toFixed(2)}`);
    return processed;
  } catch (err) {
    console.warn('[id-scan/preprocess] Sharp preprocessing failed, using raw buffer:', err.message);
    return fileBuffer;   // fall back to unprocessed image
  }
}

/**
 * 4. Tesseract.js — local OCR with Sharp preprocessing + country-aware templates
 *
 * @param {Buffer}  fileBuffer
 * @param {string}  mimeType
 * @param {object}  [hints]             — { countryCode, idType } from the frontend picker
 */
async function extractWithTesseract(fileBuffer, mimeType, hints = {}) {
  if (mimeType === 'application/pdf') {
    throw new Error('Tesseract mode does not support PDFs directly. Please upload a JPEG or PNG image.');
  }

  const { createWorker } = require('tesseract.js');

  // ── Step 1: Preprocess image ──────────────────────────────────────────────────
  const preprocessed = await preprocessImageForOcr(fileBuffer);

  // ── Step 2: Determine initial Tesseract language ──────────────────────────────
  // If a country hint was provided, skip initial detection pass and use its lang.
  const hintedLang = hints.countryCode ? getTessLang(hints.countryCode) : 'eng';
  const startLang  = hintedLang !== 'eng' ? `eng+${hintedLang}` : 'eng';

  let rawText = '';
  let tessConfidence = 0;
  try {
    const worker = await createWorker(startLang, 1, { logger: () => {} });
    try {
      const { data } = await worker.recognize(preprocessed);
      rawText        = data.text;
      tessConfidence = data.confidence;
    } finally {
      await worker.terminate();
    }
  } catch {
    // startLang may not be installed — fall back to eng
    const worker = await createWorker('eng', 1, { logger: () => {} });
    try {
      const { data } = await worker.recognize(preprocessed);
      rawText        = data.text;
      tessConfidence = data.confidence;
    } finally {
      await worker.terminate();
    }
  }

  console.log(`[id-scan/tesseract] Initial pass (${startLang}) confidence: ${tessConfidence.toFixed(1)}%`);

  // ── Step 3: Template + region detection ──────────────────────────────────────
  // detectTemplateWithRegion() handles both country-level template selection and
  // state/province-level refinement (ID number format, date format, Tesseract lang).
  const templateMatch = detectTemplateWithRegion(rawText, {
    countryCode: hints.countryCode,
    idType:      hints.idType,
    regionCode:  hints.regionCode,
  });

  if (templateMatch) {
    const regionLabel = templateMatch.regionCode ? ` / ${templateMatch.regionCode}` : '';
    console.log(`[id-scan/tesseract] Template: ${templateMatch.countryCode}${regionLabel} / ${templateMatch.idType}`);
  } else {
    console.log('[id-scan/tesseract] No template matched — using generic extraction');
  }

  const finalText = rawText;

  // ── Step 4: Apply template or generic extraction ──────────────────────────────
  let fields;
  if (templateMatch) {
    const templateFields = applyTemplate(finalText, templateMatch);
    const dateFormat = templateFields._dateFormat || 'DD/MM/YYYY';
    for (const dk of ['date_of_birth', 'expiry_date', 'issue_date']) {
      if (templateFields[dk]) {
        templateFields[dk] = normaliseDateWithFormat(templateFields[dk], dateFormat);
      }
    }

    // Generic extraction fills in any fields the template missed
    const genericFields = extractFieldsFromText(finalText);

    // Merge: template wins over generic, but generic fills nulls
    fields = {
      ...genericFields,
      ...Object.fromEntries(Object.entries(templateFields).filter(([, v]) => v !== null && v !== undefined)),
    };
    delete fields._dateFormat;
    delete fields._hasMrz;

    const normalised = Math.round((tessConfidence / 100) * 0.85 * 100) / 100;
    fields.confidence = Math.max(normalised, 0.6);
  } else {
    fields = extractFieldsFromText(finalText);
    fields.confidence = Math.round((tessConfidence / 100) * 0.75 * 100) / 100;
  }

  // Override id_type from hint if the template/generic detection still left it as 'other'
  if (hints.idType && (!fields.id_type || fields.id_type === 'other')) {
    fields.id_type = hints.idType;
  }

  return fields;
}

/**
 * Normalise a date string given a known source format.
 * Falls back to the generic normaliser when format-specific parse fails.
 */
function normaliseDateWithFormat(str, format) {
  if (!str) return null;
  str = String(str).trim();

  try {
    if (format === 'DD/MM/YYYY' || format === 'DD-MM-YYYY') {
      const m = str.match(/^(\d{2})[\/\-\.](\d{2})[\/\-\.](\d{4})$/);
      if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    }
    if (format === 'MM/DD/YYYY') {
      const m = str.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
      if (m) return `${m[3]}-${m[1]}-${m[2]}`;
    }
    if (format === 'YYYY-MM-DD') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    }
    if (format === 'DD MMM YYYY') {
      const MONTHS = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12 };
      const m = str.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
      if (m) {
        const mo = MONTHS[m[2].toUpperCase()];
        if (mo) return `${m[3]}-${String(mo).padStart(2,'0')}-${m[1].padStart(2,'0')}`;
      }
    }
    if (format === 'DD.MM.YYYY') {
      const m = str.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    }
    if (format === 'YYMMDD') {
      const m = str.match(/^(\d{2})(\d{2})(\d{2})$/);
      if (m) {
        const yy = parseInt(m[1], 10);
        const year = yy <= new Date().getFullYear() % 100 ? 2000 + yy : 1900 + yy;
        return `${year}-${m[2]}-${m[3]}`;
      }
    }
  } catch {}

  return normaliseDate(str);   // generic fallback
}

// ── AWS Textract AnalyzeID ────────────────────────────────────────────────────
// Purpose-built, AWS-trained model for government ID documents.
// Returns labeled structured fields (FIRST_NAME, LAST_NAME, DATE_OF_BIRTH, etc.)
// with per-field confidence scores. Works for DLs + passports from all countries.
//
// Required env vars: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION

// Map Textract field type → our field names
const TEXTRACT_FIELD_MAP = {
  FIRST_NAME:        'first_name',
  LAST_NAME:         'last_name',
  MIDDLE_NAME:       'middle_name',
  SUFFIX:            null,
  DATE_OF_BIRTH:     'date_of_birth',
  DATE_OF_EXPIRY:    'expiry_date',
  DATE_OF_ISSUE:     'issue_date',
  DOCUMENT_NUMBER:   'id_number',
  ID_TYPE:           null,   // handled separately
  ADDRESS:           'address_line1',
  COUNTY:            'state',
  PLACE_OF_BIRTH:    null,
  GENDER:            'gender',
  EYE_COLOR:         null,
  HEIGHT:            null,
  WEIGHT:            null,
  RACE:              null,
  ENDORSEMENTS:      null,
  RESTRICTIONS:      null,
  VEHICLE_RESTRICTIONS: null,
  CLASS:             null,
  MRZ_CODE:          'mrz_line1',
};

async function extractWithTextract(fileBuffer) {
  const { TextractClient, AnalyzeIDCommand } = require('@aws-sdk/client-textract');

  const client = new TextractClient({
    region:      process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const command = new AnalyzeIDCommand({
    DocumentPages: [{ Bytes: fileBuffer }],
  });

  const response = await client.send(command);
  const doc = response.IdentityDocuments?.[0];
  if (!doc) throw new Error('Textract returned no identity document');

  const fields = {
    id_type: null, full_name: null, first_name: null, middle_name: null, last_name: null,
    date_of_birth: null, gender: null, id_number: null, expiry_date: null, issue_date: null,
    issuing_country: null, nationality: null,
    address_line1: null, address_line2: null, city: null, state: null, postcode: null, country: null,
    mrz_line1: null, mrz_line2: null,
  };

  let totalConf = 0, confCount = 0;

  for (const f of (doc.IdentityDocumentFields || [])) {
    const typeKey  = f.Type?.Text;
    const value    = f.ValueDetection?.Text;
    const conf     = f.ValueDetection?.Confidence ?? 0;
    if (!typeKey || !value) continue;

    const ourKey = TEXTRACT_FIELD_MAP[typeKey];
    if (ourKey) {
      fields[ourKey] = value.trim();
      totalConf += conf;
      confCount++;
    }

    // ID type from Textract
    if (typeKey === 'ID_TYPE') {
      const v = value.toUpperCase();
      if (v.includes('PASSPORT'))    fields.id_type = 'passport';
      else if (v.includes('DRIVER')) fields.id_type = 'drivers_license';
      else if (v.includes('ID'))     fields.id_type = 'national_id';
    }
  }

  // Normalise gender
  if (fields.gender) {
    const g = fields.gender.toUpperCase();
    fields.gender = g === 'M' || g === 'MALE' ? 'male'
                  : g === 'F' || g === 'FEMALE' ? 'female' : 'other';
  }

  // Normalise dates
  for (const dk of ['date_of_birth', 'expiry_date', 'issue_date']) {
    if (fields[dk]) fields[dk] = normaliseDate(fields[dk]) ?? fields[dk];
  }

  // Build full_name
  if (fields.first_name || fields.last_name) {
    fields.full_name = [fields.first_name, fields.middle_name, fields.last_name].filter(Boolean).join(' ');
  }

  // Try MRZ if Textract found one
  if (fields.mrz_line1 && fields.mrz_line1.includes('<')) {
    const lines = fields.mrz_line1.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length >= 2) {
      const mrzParsed = parseMrz(lines[0], lines[1]);
      if (mrzParsed) Object.assign(fields, mrzParsed);
    }
  }

  const avgConf = confCount > 0 ? (totalConf / confCount) / 100 : 0.7;
  fields.confidence = Math.round(avgConf * 100) / 100;

  console.log(`[id-scan/textract] Extracted ${confCount} fields, avg confidence ${(avgConf*100).toFixed(1)}%`);
  return fields;
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

/**
 * @param {object} [hints] — { countryCode, idType } forwarded from frontend picker
 */
async function resolveOcr(db, fileBuffer, mimeType, hints = {}) {
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

  // 2. AWS Textract AnalyzeID — purpose-built trained model for identity documents
  //    Highest accuracy for DL + passport, all countries. Configure via Railway env vars:
  //    AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && mimeType.startsWith('image/')) {
    try {
      console.log('[id-scan] Using AWS Textract AnalyzeID');
      return await extractWithTextract(fileBuffer);
    } catch (err) {
      console.warn('[id-scan] Textract failed, trying next provider:', err.message);
    }
  }

  // 3. Anthropic Claude Vision
  try {
    const anthropicKey = await getCloudKey(db, 'anthropic');
    if (anthropicKey) {
      console.log('[id-scan] Using Claude Vision');
      return await extractWithClaude(anthropicKey, fileBuffer, mimeType);
    }
  } catch (err) {
    console.warn('[id-scan] Claude fallback failed:', err.message);
  }

  // 4. OpenAI GPT-4o Vision
  try {
    const openaiKey = await getCloudKey(db, 'openai');
    if (openaiKey) {
      console.log('[id-scan] Using OpenAI Vision');
      return await extractWithOpenAI(openaiKey, fileBuffer, mimeType);
    }
  } catch (err) {
    console.warn('[id-scan] OpenAI fallback failed:', err.message);
  }

  // 5. Tesseract.js — local OCR with Sharp preprocessing + country/state ID templates
  if (mimeType.startsWith('image/')) {
    console.log('[id-scan] Using Tesseract.js with Sharp preprocessing + country templates'
      + (hints.countryCode ? ` (hint: ${hints.countryCode}/${hints.idType || 'auto'})` : ''));
    try {
      return await extractWithTesseract(fileBuffer, mimeType, hints);
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

    // Optional hints from the frontend document-type picker
    const hints = {
      countryCode: (req.body?.country_hint  || '').trim().toUpperCase() || null,
      idType:      (req.body?.id_type_hint  || '').trim().toLowerCase() || null,
      regionCode:  (req.body?.region_hint   || '').trim().toUpperCase() || null,
    };

    let extracted;
    try {
      extracted = await resolveOcr(db, req.file.buffer, req.file.mimetype, hints);
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
// GET /api/id-scan/supported-docs
// Returns all countries + ID types known to the template engine
// ═════════════════════════════════════════════════════════════════════════════
router.get('/supported-docs', requireAdmin, (req, res) => {
  try {
    res.json({ documents: getSupportedDocumentsWithRegions() });
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

    const textractKey = process.env.AWS_ACCESS_KEY_ID;
    const providers = [];
    if (ollamaUrl || tenantOllamaUrl)  providers.push({ name: 'Ollama (open-source)', status: 'active', url: ollamaUrl || tenantOllamaUrl });
    if (textractKey)                   providers.push({ name: 'AWS Textract AnalyzeID', status: 'configured', note: 'Purpose-built trained model for government IDs' });
    if (anthropicKey)                  providers.push({ name: 'Claude Vision', status: 'configured' });
    if (openaiKey)                     providers.push({ name: 'OpenAI GPT-4o', status: 'configured' });
    providers.push({
      name: 'Tesseract.js (local)',
      status: 'active',
      note: 'Always available — Sharp preprocessing + country/state templates',
      supportedCountries: getSupportedDocuments().map(d => d.countryCode),
    });

    res.json({ providers, active: providers[0]?.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

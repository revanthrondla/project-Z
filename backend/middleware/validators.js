/**
 * Centralized validation helpers
 * Import these instead of redefining regex patterns in every route.
 */

// ── Regex constants ────────────────────────────────────────────────────────────
const EMAIL_RE        = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE         = /^\d{4}-\d{2}-\d{2}$/;
const INVOICE_NUM_RE  = /^[A-Z0-9\-]{4,30}$/i;
const PHONE_RE        = /^\+?[\d\s\-().]{7,20}$/;

// ── Field validators ──────────────────────────────────────────────────────────
function isValidEmail(s)         { return typeof s === 'string' && EMAIL_RE.test(s.trim()); }
function isValidDate(s)          { return typeof s === 'string' && DATE_RE.test(s.trim()); }
function isValidInvoiceNumber(s) { return typeof s === 'string' && INVOICE_NUM_RE.test(s.trim()); }
function isValidPhone(s)         { return typeof s === 'string' && PHONE_RE.test(s.trim()); }

/**
 * Parse a float; throw a 400-annotated error if invalid.
 */
function requirePositiveNumber(val, fieldName) {
  const n = parseFloat(val);
  if (isNaN(n) || n < 0) {
    throw Object.assign(new Error(`${fieldName} must be a positive number`), { status: 400 });
  }
  return n;
}

/**
 * Validate an enum field; throw if value is not in the allowed list.
 */
function requireEnum(val, allowed, fieldName) {
  if (!allowed.includes(val)) {
    throw Object.assign(
      new Error(`${fieldName} must be one of: ${allowed.join(', ')}`),
      { status: 400 }
    );
  }
  return val;
}

/**
 * Sanitize a query-param enum: return null if absent, validated value if present.
 * Throws a 400-annotated error for unrecognised values (prevents unexpected DB queries).
 */
function sanitizeQueryEnum(val, allowed, fieldName = 'filter', fallback = null) {
  if (val === undefined || val === null || val === '') return fallback;
  if (allowed.includes(val)) return val;
  throw Object.assign(
    new Error(`Invalid ${fieldName}: "${val}". Allowed: ${allowed.join(', ')}`),
    { status: 400 }
  );
}

/**
 * Sanitize a date query param: return null if absent, validated string if present.
 */
function sanitizeQueryDate(val, fieldName = 'date') {
  if (!val) return null;
  if (!isValidDate(val)) {
    throw Object.assign(
      new Error(`${fieldName} must be YYYY-MM-DD`),
      { status: 400 }
    );
  }
  return val;
}

/**
 * Sanitize a query-param integer (e.g. candidate_id, client_id).
 * Returns null if absent, positive integer if valid.
 */
function sanitizeQueryInt(val, fieldName = 'id') {
  if (!val) return null;
  const n = parseInt(val, 10);
  if (isNaN(n) || n <= 0) {
    throw Object.assign(
      new Error(`${fieldName} must be a positive integer`),
      { status: 400 }
    );
  }
  return n;
}

module.exports = {
  // Regex constants (for cases needing raw regex)
  EMAIL_RE,
  DATE_RE,
  INVOICE_NUM_RE,
  PHONE_RE,

  // Boolean validators
  isValidEmail,
  isValidDate,
  isValidInvoiceNumber,
  isValidPhone,

  // Throwing validators
  requirePositiveNumber,
  requireEnum,

  // Query-param sanitizers (return null or throw 400)
  sanitizeQueryEnum,
  sanitizeQueryDate,
  sanitizeQueryInt,
};

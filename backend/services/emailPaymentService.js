/**
 * emailPaymentService.js
 * Polls an IMAP inbox (Gmail or Outlook) for payment confirmation emails,
 * parses email body + PDF attachments, extracts payment fields, and
 * auto-matches to existing Flow invoices.
 */

const Imap   = require('imap');
const { simpleParser } = require('mailparser');
// pdf-parse is loaded lazily inside extractPdfText() to avoid a startup crash:
// pdf-parse v2 references browser globals (DOMMatrix, Path2D, ImageData) at
// module-load time via its bundled pdfjs-dist, which throws in Node.js unless
// a canvas polyfill is present.  Deferring the require() means the error only
// surfaces when actually parsing a PDF attachment (and is caught), not on every
// server start.

// ── Provider presets ────────────────────────────────────────────────────────
const PROVIDER_DEFAULTS = {
  gmail:   { host: 'imap.gmail.com',         port: 993, tls: true },
  outlook: { host: 'outlook.office365.com',  port: 993, tls: true },
  imap:    { host: null, port: 993, tls: true },
};

// ── Field extraction helpers ────────────────────────────────────────────────

/**
 * Extract a dollar amount from text.
 * Handles: $1,234.56  USD 1234.56  1,234.56 USD  Amount: 1234.56
 */
function extractAmount(text) {
  const patterns = [
    /(?:total|amount|paid|payment|sum|remittance)[^\d$]{0,30}[\$USD\s]*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i,
    /\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/,
    /([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)\s*(?:USD|usd)/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const n = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(n) && n > 0 && n < 10_000_000) return n;
    }
  }
  return null;
}

/**
 * Extract a date string from text near payment/paid/received keywords.
 * Returns ISO date YYYY-MM-DD or null.
 */
function extractDate(text) {
  const patterns = [
    // ISO: 2024-03-15
    /(?:payment\s*date|paid\s*on|received\s*on|date)[^\d]{0,20}(\d{4}-\d{2}-\d{2})/i,
    // DD/MM/YYYY or MM/DD/YYYY
    /(?:payment\s*date|paid\s*on|received\s*on|date)[^\d]{0,20}(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
    // Month DD, YYYY
    /(?:payment\s*date|paid\s*on|received\s*on|date)[^\d]{0,20}([A-Za-z]+ \d{1,2},?\s+\d{4})/i,
    // Fallback: any ISO date in text
    /(\d{4}-\d{2}-\d{2})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const d = new Date(m[1]);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

/**
 * Extract invoice/reference number.
 */
function extractInvoiceNumber(text) {
  const m = text.match(/(?:invoice|inv)[\s#\-.:]*([A-Z0-9\-]{4,20})/i);
  return m ? m[1].trim() : null;
}

/**
 * Extract a reference/transaction ID.
 */
function extractReference(text) {
  const patterns = [
    /(?:reference|ref|transaction\s*id|txn|confirmation)[^\w]{0,10}([A-Z0-9\-]{6,30})/i,
    /(?:bank\s*ref|wire\s*ref)[^\w]{0,10}([A-Z0-9\-]{6,30})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * Extract period start / end dates (e.g. "period: 2024-01-01 to 2024-01-31").
 */
function extractPeriod(text) {
  // Pattern: <date> to/through <date>
  const m = text.match(/(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})\s*(?:to|through|–|-)\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i);
  if (m) {
    const s = new Date(m[1]);
    const e = new Date(m[2]);
    if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
      return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
    }
  }
  return null;
}

/**
 * Extract a client/company name from common patterns.
 */
function extractClientName(text, emailFrom = '') {
  // From the FROM address domain
  const domainMatch = emailFrom.match(/@([a-zA-Z0-9\-]+)\.[a-zA-Z]{2,}/);
  const domainHint = domainMatch ? domainMatch[1].replace(/-/g, ' ') : '';

  const patterns = [
    /(?:from|client|company|payer|remitter)[:\s]+([A-Z][A-Za-z0-9 &,.']{2,50})/,
    /([A-Z][A-Za-z0-9 &,.']{2,50})\s+(?:has paid|has sent|payment|remittance)/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return domainHint ? domainHint.charAt(0).toUpperCase() + domainHint.slice(1) : null;
}

/**
 * Extract employee/candidate names (lines near "for", "re:", "services for").
 */
function extractEmployeeNames(text) {
  const names = [];
  const patterns = [
    /(?:services\s+for|payment\s+for|re\s*:|hours\s+for)[:\s]+([A-Z][a-z]+ [A-Z][a-z]+(?:,\s*[A-Z][a-z]+ [A-Z][a-z]+)*)/i,
    /employee[s]?[:\s]+([A-Z][a-z]+ [A-Z][a-z]+(?:,\s*[A-Z][a-z]+ [A-Z][a-z]+)*)/i,
    /consultant[s]?[:\s]+([A-Z][a-z]+ [A-Z][a-z]+(?:,\s*[A-Z][a-z]+ [A-Z][a-z]+)*)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      m[1].split(/,\s*/).forEach(n => {
        const t = n.trim();
        if (t.length > 3 && !names.includes(t)) names.push(t);
      });
    }
  }
  return names;
}

/**
 * Extract all text from a PDF Buffer.
 */
async function extractPdfText(buffer) {
  try {
    // Lazy-load pdf-parse so its pdfjs-dist bundle (which touches DOMMatrix,
    // Path2D, ImageData) is only evaluated when we actually need it, not at
    // server startup.
    const pdfParse = require('pdf-parse'); // eslint-disable-line global-require
    const data = await pdfParse(buffer);
    return data.text || '';
  } catch (e) {
    console.warn('[EmailPayments] PDF parse error:', e.message);
    return '';
  }
}

// ── Invoice matching ────────────────────────────────────────────────────────

/**
 * Find the best matching invoice and compute mismatch flags.
 * Returns { invoice, confidence, mismatches }.
 */
function matchInvoice(db, parsed) {
  const { parsed_amount, parsed_client_name, parsed_invoice_number,
          parsed_period_start, parsed_period_end } = parsed;

  const invoices = db.prepare(`
    SELECT i.*, c.name AS candidate_name, cl.name AS client_name
    FROM invoices i
    JOIN candidates c ON i.candidate_id = c.id
    LEFT JOIN clients cl ON i.client_id = cl.id
    WHERE i.status IN ('sent', 'client_approved', 'draft', 'overdue')
    ORDER BY i.created_at DESC
    LIMIT 100
  `).all();

  if (!invoices.length) return { invoice: null, confidence: 'none', mismatches: [] };

  let best = null;
  let bestScore = 0;

  for (const inv of invoices) {
    let score = 0;

    // Invoice number exact match = very strong signal
    if (parsed_invoice_number && inv.invoice_number &&
        inv.invoice_number.toLowerCase() === parsed_invoice_number.toLowerCase()) {
      score += 50;
    }

    // Amount match within 0.01
    if (parsed_amount != null && Math.abs(inv.total_amount - parsed_amount) < 0.01) {
      score += 30;
    } else if (parsed_amount != null && Math.abs(inv.total_amount - parsed_amount) / (inv.total_amount || 1) < 0.05) {
      score += 15; // within 5%
    }

    // Client name fuzzy match
    if (parsed_client_name && inv.client_name) {
      const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (norm(inv.client_name).includes(norm(parsed_client_name)) ||
          norm(parsed_client_name).includes(norm(inv.client_name))) {
        score += 20;
      }
    }

    // Period overlap
    if (parsed_period_start && parsed_period_end && inv.period_start && inv.period_end) {
      if (inv.period_start === parsed_period_start && inv.period_end === parsed_period_end) {
        score += 15;
      } else if (inv.period_start <= parsed_period_end && inv.period_end >= parsed_period_start) {
        score += 7; // partial overlap
      }
    }

    if (score > bestScore) { bestScore = score; best = inv; }
  }

  // Determine confidence
  let confidence = 'none';
  if (bestScore >= 70) confidence = 'high';
  else if (bestScore >= 40) confidence = 'medium';
  else if (bestScore >= 20) confidence = 'low';

  if (!best || confidence === 'none') return { invoice: null, confidence: 'none', mismatches: [] };

  // Compute mismatch flags
  const mismatches = [];
  if (parsed_amount != null && Math.abs(best.total_amount - parsed_amount) > 0.01) {
    mismatches.push(`Amount mismatch: email shows $${parsed_amount.toFixed(2)}, invoice is $${best.total_amount.toFixed(2)}`);
  }
  if (parsed_period_start && best.period_start !== parsed_period_start) {
    mismatches.push(`Period start mismatch: email shows ${parsed_period_start}, invoice is ${best.period_start}`);
  }
  if (parsed_period_end && best.period_end !== parsed_period_end) {
    mismatches.push(`Period end mismatch: email shows ${parsed_period_end}, invoice is ${best.period_end}`);
  }

  return { invoice: best, confidence, mismatches };
}

// ── IMAP polling ────────────────────────────────────────────────────────────

/**
 * Poll IMAP inbox once, fetch unseen payment emails, parse them,
 * and insert pending imports into the tenant DB.
 *
 * @param {object} settings  - row from email_settings
 * @param {object} db        - tenant DatabaseSync instance
 * @returns {Promise<{processed: number, errors: string[]}>}
 */
function pollInbox(settings, db) {
  return new Promise((resolve) => {
    const provider = PROVIDER_DEFAULTS[settings.provider] || PROVIDER_DEFAULTS.imap;
    const host = settings.imap_host || provider.host;

    if (!host || !settings.imap_user || !settings.imap_password) {
      return resolve({ processed: 0, errors: ['IMAP credentials not configured'] });
    }

    const imap = new Imap({
      user:     settings.imap_user,
      password: settings.imap_password,
      host,
      port:     settings.imap_port || provider.port,
      tls:      provider.tls,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 15000,
      authTimeout: 15000,
    });

    const results = { processed: 0, errors: [] };

    imap.once('ready', () => {
      imap.openBox(settings.imap_folder || 'INBOX', false, (err) => {
        if (err) {
          results.errors.push(`Cannot open mailbox: ${err.message}`);
          imap.end();
          return;
        }

        // Search for UNSEEN messages with the configured subject keyword
        const searchSubject = settings.search_subject || 'payment';
        const criteria = ['UNSEEN', ['SUBJECT', searchSubject]];

        imap.search(criteria, async (err, uids) => {
          if (err) {
            results.errors.push(`Search error: ${err.message}`);
            imap.end();
            return;
          }

          if (!uids || uids.length === 0) {
            imap.end();
            return resolve(results);
          }

          // Filter already-processed UIDs
          const existingUids = new Set(
            db.prepare('SELECT email_message_uid FROM email_payment_imports').all()
              .map(r => r.email_message_uid)
          );
          const newUids = uids.filter(uid => !existingUids.has(String(uid)));

          if (newUids.length === 0) {
            imap.end();
            return resolve(results);
          }

          const fetch = imap.fetch(newUids, { bodies: '', markSeen: false });
          const mailPromises = [];

          fetch.on('message', (msg, seqno) => {
            let uid = null;
            msg.on('attributes', attrs => { uid = attrs.uid; });

            const mailPromise = new Promise((res) => {
              const chunks = [];
              msg.on('body', (stream) => {
                stream.on('data', chunk => chunks.push(chunk));
              });
              msg.once('end', async () => {
                try {
                  const raw = Buffer.concat(chunks);
                  const parsed = await simpleParser(raw);
                  await processEmail(parsed, uid, db, settings);
                  results.processed++;
                } catch (e) {
                  results.errors.push(`UID ${uid}: ${e.message}`);
                }
                res();
              });
            });
            mailPromises.push(mailPromise);
          });

          fetch.once('end', async () => {
            await Promise.all(mailPromises);
            // Update last_polled_at
            db.prepare(`UPDATE email_settings SET last_polled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = 1`).run();
            imap.end();
            resolve(results);
          });

          fetch.once('error', (err) => {
            results.errors.push(`Fetch error: ${err.message}`);
            imap.end();
            resolve(results);
          });
        });
      });
    });

    imap.once('error', (err) => {
      results.errors.push(`IMAP connection error: ${err.message}`);
      resolve(results);
    });

    imap.once('end', () => {
      // resolved by fetch.once('end') or earlier
    });

    imap.connect();
  });
}

/**
 * Process a single parsed email: extract text (body + PDF), parse fields,
 * match to invoice, and insert a pending import record.
 */
async function processEmail(parsed, uid, db, settings) {
  const subject  = parsed.subject || '';
  const from     = parsed.from?.text || '';
  const dateStr  = parsed.date ? new Date(parsed.date).toISOString().slice(0, 10) : null;

  // Collect text: email body
  let text = (parsed.text || parsed.html || '').replace(/<[^>]+>/g, ' ');

  // Collect PDF attachment text
  let hasAttachment = false;
  for (const att of (parsed.attachments || [])) {
    if (att.contentType === 'application/pdf' || att.filename?.endsWith('.pdf')) {
      hasAttachment = true;
      const pdfText = await extractPdfText(att.content);
      text += '\n' + pdfText;
    }
  }

  // Parse fields from combined text
  const amount       = extractAmount(text);
  const clientName   = extractClientName(text, from);
  const invNumber    = extractInvoiceNumber(text) || extractInvoiceNumber(subject);
  const reference    = extractReference(text);
  const paymentDate  = extractDate(text) || dateStr;
  const period       = extractPeriod(text);
  const employees    = extractEmployeeNames(text);

  // Match to invoice
  const { invoice, confidence, mismatches } = matchInvoice(db, {
    parsed_amount: amount,
    parsed_client_name: clientName,
    parsed_invoice_number: invNumber,
    parsed_period_start: period?.start || null,
    parsed_period_end:   period?.end   || null,
  });

  // Insert import record
  db.prepare(`
    INSERT OR IGNORE INTO email_payment_imports
      (email_message_uid, email_subject, email_from, email_date,
       has_attachment, raw_extracted_text,
       parsed_amount, parsed_client_name, parsed_invoice_number,
       parsed_payment_date, parsed_period_start, parsed_period_end,
       parsed_reference, parsed_employee_names,
       matched_invoice_id, match_confidence, mismatch_flags, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    String(uid), subject, from, dateStr,
    hasAttachment ? 1 : 0,
    text.slice(0, 10000),
    amount, clientName, invNumber,
    paymentDate,
    period?.start || null,
    period?.end   || null,
    reference,
    JSON.stringify(employees),
    invoice?.id   || null,
    confidence,
    JSON.stringify(mismatches)
  );
}

// ── Test IMAP connection ────────────────────────────────────────────────────
function testConnection(settings) {
  return new Promise((resolve) => {
    const provider = PROVIDER_DEFAULTS[settings.provider] || PROVIDER_DEFAULTS.imap;
    const host = settings.imap_host || provider.host;

    const imap = new Imap({
      user:     settings.imap_user,
      password: settings.imap_password,
      host,
      port:     settings.imap_port || provider.port,
      tls:      provider.tls,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 10000,
      authTimeout: 10000,
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err) => {
        imap.end();
        if (err) resolve({ ok: false, message: `Connected but cannot open INBOX: ${err.message}` });
        else     resolve({ ok: true,  message: 'Connection successful! INBOX opened.' });
      });
    });

    imap.once('error', (err) => {
      resolve({ ok: false, message: err.message });
    });

    imap.connect();
  });
}

module.exports = { pollInbox, testConnection, matchInvoice, PROVIDER_DEFAULTS };

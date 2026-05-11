/**
 * Integrations API — /api/integrations
 *
 * Covers two sub-resources:
 *   • API Keys  — generate, list, revoke personal access tokens
 *   • Webhooks  — create, update, delete, test outbound event subscriptions
 *
 * Security:
 *   - API keys are stored as SHA-256 hashes; the plaintext is returned ONCE on creation.
 *   - Webhook secrets are stored as SHA-256 hashes for HMAC signature verification.
 */

const express  = require('express');
const crypto   = require('crypto');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, injectTenantDb);

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Generate a cryptographically-random token of the form `hiq_<32 hex chars>` */
function generateApiKey() {
  const raw = crypto.randomBytes(32).toString('hex');
  return { key: `hiq_${raw}`, prefix: `hiq_${raw.slice(0, 8)}` };
}

/** Generate a random webhook signing secret */
function generateWebhookSecret() {
  return crypto.randomBytes(24).toString('hex');
}

const VALID_SCOPES = ['read', 'write', 'admin'];
const VALID_EVENTS = [
  'employee.created', 'employee.updated', 'employee.deleted',
  'timesheet.submitted', 'timesheet.approved', 'timesheet.rejected',
  'invoice.created', 'invoice.sent', 'invoice.paid',
  'absence.requested', 'absence.approved', 'absence.rejected',
  'expense.submitted', 'expense.approved',
];

// ════════════════════════════════════════════════════════════════════════════
// API KEYS
// ════════════════════════════════════════════════════════════════════════════

// GET /api/integrations/api-keys — list active keys (never return hash)
router.get('/api-keys', requireAdmin, async (req, res) => {
  try {
    const result = await req.db.query(
      `SELECT id, name, key_prefix, scopes, last_used_at, expires_at, created_by, is_active, created_at
       FROM   api_keys
       WHERE  is_active = TRUE
       ORDER  BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/integrations/api-keys — create and return plaintext key (ONCE)
router.post('/api-keys', requireAdmin, async (req, res) => {
  try {
    const { name, scopes = 'read', expires_at } = req.body;

    if (!name?.trim())
      return res.status(400).json({ error: 'name is required' });

    const scopeList = (typeof scopes === 'string' ? scopes.split(',') : scopes)
      .map(s => s.trim())
      .filter(Boolean);

    for (const s of scopeList) {
      if (!VALID_SCOPES.includes(s))
        return res.status(400).json({ error: `Invalid scope "${s}". Valid: ${VALID_SCOPES.join(', ')}` });
    }

    const { key, prefix } = generateApiKey();
    const hash = sha256(key);

    const result = await req.db.query(
      `INSERT INTO api_keys (name, key_prefix, key_hash, scopes, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, key_prefix, scopes, expires_at, created_at`,
      [name.trim(), prefix, hash, scopeList.join(','), expires_at || null, req.user.id]
    );

    // Return the plaintext key — this is the ONLY time it is shown
    res.status(201).json({ ...result.rows[0], key });
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'A key with that name already exists' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/integrations/api-keys/:id — revoke (soft-delete)
router.delete('/api-keys/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await req.db.query(
      `UPDATE api_keys SET is_active = FALSE WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!result.rows[0])
      return res.status(404).json({ error: 'API key not found' });
    res.json({ message: 'API key revoked' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// WEBHOOKS
// ════════════════════════════════════════════════════════════════════════════

// GET /api/integrations/webhooks
router.get('/webhooks', requireAdmin, async (req, res) => {
  try {
    const result = await req.db.query(
      `SELECT id, name, url, events, is_active, last_fired_at, failure_count, created_at, updated_at
       FROM   webhooks
       ORDER  BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/integrations/webhooks — create
router.post('/webhooks', requireAdmin, async (req, res) => {
  try {
    const { name, url, events = [], generate_secret = false } = req.body;

    if (!name?.trim())  return res.status(400).json({ error: 'name is required' });
    if (!url?.trim())   return res.status(400).json({ error: 'url is required' });

    try { new URL(url); } catch {
      return res.status(400).json({ error: 'url must be a valid URL' });
    }

    const evtList = Array.isArray(events) ? events : [];
    for (const e of evtList) {
      if (!VALID_EVENTS.includes(e))
        return res.status(400).json({ error: `Unknown event "${e}"` });
    }

    let secret = null;
    let secret_hash = null;
    if (generate_secret) {
      secret = generateWebhookSecret();
      secret_hash = sha256(secret);
    }

    const result = await req.db.query(
      `INSERT INTO webhooks (name, url, events, secret_hash, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, url, events, is_active, last_fired_at, failure_count, created_at`,
      [name.trim(), url.trim(), JSON.stringify(evtList), secret_hash, req.user.id]
    );

    const row = result.rows[0];
    if (secret) row.secret = secret; // shown ONCE if generated

    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/integrations/webhooks/:id — update
router.put('/webhooks/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    const existing = await req.db.query('SELECT * FROM webhooks WHERE id = $1', [id]);
    if (!existing.rows[0])
      return res.status(404).json({ error: 'Webhook not found' });
    const ex = existing.rows[0];

    const name      = req.body.name      !== undefined ? req.body.name      : ex.name;
    const url       = req.body.url       !== undefined ? req.body.url       : ex.url;
    const events    = req.body.events    !== undefined ? req.body.events    : ex.events;
    const is_active = req.body.is_active !== undefined ? req.body.is_active : ex.is_active;

    if (!name?.trim())  return res.status(400).json({ error: 'name is required' });
    if (!url?.trim())   return res.status(400).json({ error: 'url is required' });

    try { new URL(url); } catch {
      return res.status(400).json({ error: 'url must be a valid URL' });
    }

    const evtList = Array.isArray(events) ? events : ex.events;
    for (const e of evtList) {
      if (!VALID_EVENTS.includes(e))
        return res.status(400).json({ error: `Unknown event "${e}"` });
    }

    // Optionally regenerate secret
    let secret_hash = ex.secret_hash;
    let newSecret = null;
    if (req.body.regenerate_secret) {
      newSecret = generateWebhookSecret();
      secret_hash = sha256(newSecret);
    }

    const result = await req.db.query(
      `UPDATE webhooks
       SET name=$1, url=$2, events=$3, is_active=$4, secret_hash=$5, updated_at=NOW()
       WHERE id=$6
       RETURNING id, name, url, events, is_active, last_fired_at, failure_count, updated_at`,
      [name.trim(), url.trim(), JSON.stringify(evtList), is_active, secret_hash, id]
    );

    const row = result.rows[0];
    if (newSecret) row.secret = newSecret;
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/integrations/webhooks/:id
router.delete('/webhooks/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await req.db.query(
      'DELETE FROM webhooks WHERE id = $1 RETURNING id', [id]
    );
    if (!result.rows[0])
      return res.status(404).json({ error: 'Webhook not found' });
    res.json({ message: 'Webhook deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/integrations/webhooks/:id/test — fire a test ping
router.post('/webhooks/:id/test', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await req.db.query('SELECT * FROM webhooks WHERE id = $1', [id]);
    if (!result.rows[0])
      return res.status(404).json({ error: 'Webhook not found' });

    const wh = result.rows[0];
    const payload = {
      event:     'webhook.test',
      timestamp: new Date().toISOString(),
      webhook_id: wh.id,
      message:   'This is a test delivery from HireIQ.',
    };

    const body = JSON.stringify(payload);
    const headers = {
      'Content-Type': 'application/json',
      'X-HireIQ-Event': 'webhook.test',
      'User-Agent': 'HireIQ-Webhooks/1.0',
    };

    // Add HMAC signature if secret is stored
    if (wh.secret_hash) {
      // We store the hash, not the secret, so we use the payload hash as the signature token
      // In production the raw secret would be stored encrypted; for now we sign with our app secret
      const appSecret = process.env.JWT_SECRET || 'hireiq-webhook-secret';
      const sig = crypto.createHmac('sha256', appSecret).update(body).digest('hex');
      headers['X-HireIQ-Signature'] = `sha256=${sig}`;
    }

    let deliveryStatus = 'delivered';
    let responseCode   = null;
    let error_message  = null;

    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 10000);
      const resp = await fetch(wh.url, { method: 'POST', headers, body, signal: ctrl.signal });
      clearTimeout(timeout);
      responseCode = resp.status;
      if (!resp.ok) {
        deliveryStatus = 'failed';
        error_message  = `Received HTTP ${resp.status}`;
      }
    } catch (fetchErr) {
      deliveryStatus = 'failed';
      error_message  = fetchErr.message;
    }

    // Update last_fired_at and failure_count
    if (deliveryStatus === 'delivered') {
      await req.db.query(
        'UPDATE webhooks SET last_fired_at=NOW(), failure_count=0 WHERE id=$1', [id]
      );
    } else {
      await req.db.query(
        'UPDATE webhooks SET last_fired_at=NOW(), failure_count=failure_count+1 WHERE id=$1', [id]
      );
    }

    res.json({ status: deliveryStatus, response_code: responseCode, error: error_message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/integrations/events — list valid event names (for UI dropdowns)
router.get('/events', async (req, res) => {
  res.json(VALID_EVENTS);
});

module.exports = router;

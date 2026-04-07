/**
 * AI Chat Routes — HireIQ AI Assistant
 *
 * POST   /api/ai-chat/message                 — send a message (start or continue conversation)
 * GET    /api/ai-chat/conversations            — list conversations for current user
 * DELETE /api/ai-chat/conversations/:id        — delete a conversation
 * GET    /api/ai-chat/documents                — list knowledge-base docs (admin)
 * POST   /api/ai-chat/documents                — upload a document (admin, multipart)
 * DELETE /api/ai-chat/documents/:id            — delete a document (admin)
 * GET    /api/ai-chat/settings                 — get tenant AI config (admin)
 * PUT    /api/ai-chat/settings                 — update tenant AI config (admin)
 * GET    /api/ai-chat/config                   — lightweight config status check
 */
const express = require('express');
const multer  = require('multer');
const { authenticate, requireAdmin, injectTenantDb, requireModule } = require('../middleware/auth');
const { masterDb } = require('../masterDatabase');
const { runAgenticLoop, resolveAIConfig, PROVIDER_MODELS } = require('../services/llmService');

const router = express.Router();
router.use(authenticate, injectTenantDb, requireModule('ai_assistant'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Helper: read tenant AI settings ──────────────────────────────────────────

function getTenantAISettings(db) {
  try { return db.prepare('SELECT * FROM ai_settings WHERE id=1').get(); } catch { return null; }
}

function getPlatformAIConfig() {
  try { return masterDb.prepare('SELECT * FROM platform_ai_config WHERE id=1').get(); } catch { return null; }
}

/** FTS document search — returns top-3 relevant snippets */
function searchDocuments(db, query) {
  try {
    const rows = db.prepare(`
      SELECT d.title, snippet(ai_documents_fts, 1, '', '', '…', 32) AS excerpt
      FROM ai_documents_fts f
      JOIN ai_documents d ON d.id = f.rowid
      WHERE ai_documents_fts MATCH ?
      ORDER BY rank
      LIMIT 3
    `).all(query.replace(/[^a-zA-Z0-9 ]/g, ' ').trim() + '*');
    return rows;
  } catch { return []; }
}

/** Pull a concise snapshot of tenant data the AI can use as context */
function buildDataContext(db) {
  try {
    const employees = db.prepare(`
      SELECT name, job_title, hourly_rate, status
      FROM candidates WHERE deleted_at IS NULL LIMIT 20
    `).all();

    const clients = db.prepare(`
      SELECT name, contact_name, email FROM clients LIMIT 10
    `).all();

    const pendingTS = db.prepare(`
      SELECT COUNT(*) as count FROM time_entries WHERE status='pending'
    `).get();

    const pendingAbs = db.prepare(`
      SELECT COUNT(*) as count FROM absences WHERE status='pending'
    `).get();

    return { employees, clients, pendingTimesheets: pendingTS?.count || 0, pendingAbsences: pendingAbs?.count || 0 };
  } catch { return { employees: [], clients: [], pendingTimesheets: 0, pendingAbsences: 0 }; }
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_headcount',
    description: 'Get employee headcount statistics — total, active, inactive, by job title',
    input_schema: {
      type: 'object',
      properties: {
        breakdown: { type: 'string', enum: ['total', 'by_status', 'by_job_title'], description: 'Type of breakdown' }
      },
      required: []
    }
  },
  {
    name: 'list_employees',
    description: 'List employees with their details — name, job title, rate, status',
    input_schema: {
      type: 'object',
      properties: {
        status:    { type: 'string', description: 'Filter by status: active or inactive' },
        job_title: { type: 'string', description: 'Filter by job title (partial match)' },
        limit:     { type: 'number', description: 'Max results to return (default 10)' }
      },
      required: []
    }
  },
  {
    name: 'list_clients',
    description: 'List clients with their contact details',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default 10)' }
      },
      required: []
    }
  },
  {
    name: 'get_timesheet_summary',
    description: 'Get timesheet summary — pending approvals, hours logged this month, recent entries',
    input_schema: {
      type: 'object',
      properties: {
        employee_name: { type: 'string', description: 'Filter by employee name (optional)' }
      },
      required: []
    }
  },
  {
    name: 'get_absence_summary',
    description: 'Get absence request summary — pending requests, approved absences, upcoming',
    input_schema: {
      type: 'object',
      properties: {
        employee_name: { type: 'string', description: 'Filter by employee name (optional)' },
        status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'all'], description: 'Status filter' }
      },
      required: []
    }
  },
  {
    name: 'get_revenue_report',
    description: 'Get revenue and invoice report — total billed, paid, outstanding',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', description: 'Period like "this month", "last month", "this year"' }
      },
      required: []
    }
  },
  {
    name: 'create_employee',
    description: 'Create a new employee/candidate record',
    input_schema: {
      type: 'object',
      properties: {
        name:        { type: 'string',  description: 'Full name' },
        email:       { type: 'string',  description: 'Email address' },
        hourly_rate: { type: 'number',  description: 'Hourly rate in dollars' },
        job_title:   { type: 'string',  description: 'Job title / position' },
        phone:       { type: 'string',  description: 'Phone number (optional)' },
        start_date:  { type: 'string',  description: 'Start date in YYYY-MM-DD format (optional)' }
      },
      required: ['name', 'email', 'hourly_rate']
    }
  },
  {
    name: 'generate_invoice',
    description: 'Generate a new invoice for a client',
    input_schema: {
      type: 'object',
      properties: {
        client_name:  { type: 'string', description: 'Client company name (will match against existing clients)' },
        description:  { type: 'string', description: 'Invoice description / services rendered' },
        hours_worked: { type: 'number', description: 'Number of hours worked' },
        rate:         { type: 'number', description: 'Hourly rate in dollars' },
        period_start: { type: 'string', description: 'Billing period start date (YYYY-MM-DD)' },
        period_end:   { type: 'string', description: 'Billing period end date (YYYY-MM-DD)' }
      },
      required: ['client_name', 'description', 'hours_worked', 'rate']
    }
  },
  {
    name: 'send_report',
    description: 'Generate and display a summary report',
    input_schema: {
      type: 'object',
      properties: {
        report_type: {
          type: 'string',
          enum: ['headcount', 'timesheets', 'absences', 'revenue', 'invoices'],
          description: 'Type of report to generate'
        },
        period: { type: 'string', description: 'Period: "this month", "last month", "this year", or a date range' }
      },
      required: ['report_type']
    }
  }
];

// ── Tool executor ─────────────────────────────────────────────────────────────

function executeTool(db, toolName, input, userId) {
  try {
    switch (toolName) {
      case 'get_headcount': {
        const total   = db.prepare("SELECT COUNT(*) as c FROM candidates WHERE deleted_at IS NULL").get();
        const active  = db.prepare("SELECT COUNT(*) as c FROM candidates WHERE deleted_at IS NULL AND status='active'").get();
        const byTitle = db.prepare(`
          SELECT job_title, COUNT(*) as count FROM candidates
          WHERE deleted_at IS NULL AND job_title IS NOT NULL AND job_title != ''
          GROUP BY job_title ORDER BY count DESC LIMIT 8
        `).all();
        return { total: total?.c || 0, active: active?.c || 0, inactive: (total?.c || 0) - (active?.c || 0), by_job_title: byTitle };
      }

      case 'list_employees': {
        const { status, job_title, limit = 10 } = input;
        let sql = `SELECT name, email, job_title, hourly_rate, status, phone FROM candidates WHERE deleted_at IS NULL`;
        const params = [];
        if (status) { sql += ` AND status = ?`; params.push(status); }
        if (job_title) { sql += ` AND job_title LIKE ?`; params.push(`%${job_title}%`); }
        sql += ` ORDER BY name LIMIT ?`;
        params.push(Math.min(limit, 50));
        return { employees: db.prepare(sql).all(...params) };
      }

      case 'list_clients': {
        const { limit = 10 } = input;
        const clients = db.prepare(
          `SELECT name, contact_name, email, phone FROM clients ORDER BY name LIMIT ?`
        ).all(Math.min(limit, 50));
        return { clients };
      }

      case 'get_timesheet_summary': {
        const { employee_name } = input;
        const month = new Date().toISOString().slice(0, 7);
        let pending = db.prepare(`
          SELECT te.id, c.name as employee, te.date, te.hours, te.status, te.project
          FROM time_entries te JOIN candidates c ON te.candidate_id = c.id
          WHERE te.status = 'pending'
          ${employee_name ? "AND c.name LIKE ?" : ''}
          ORDER BY te.date DESC LIMIT 10
        `).all(...(employee_name ? [`%${employee_name}%`] : []));

        const monthlyHours = db.prepare(`
          SELECT COALESCE(SUM(te.hours),0) as hours, COUNT(*) as entries
          FROM time_entries te
          ${employee_name ? 'JOIN candidates c ON te.candidate_id=c.id' : ''}
          WHERE te.date LIKE ? AND te.status != 'rejected'
          ${employee_name ? 'AND c.name LIKE ?' : ''}
        `).get(...[`${month}%`, ...(employee_name ? [`%${employee_name}%`] : [])]);

        return { pending_approvals: pending, monthly_hours: monthlyHours?.hours || 0, monthly_entries: monthlyHours?.entries || 0 };
      }

      case 'get_absence_summary': {
        const { employee_name, status = 'all' } = input;
        let sql = `
          SELECT a.id, c.name as employee, a.type, a.start_date, a.end_date, a.status, a.reason
          FROM absences a JOIN candidates c ON a.candidate_id = c.id
          WHERE 1=1
        `;
        const params = [];
        if (status !== 'all') { sql += ` AND a.status = ?`; params.push(status); }
        if (employee_name) { sql += ` AND c.name LIKE ?`; params.push(`%${employee_name}%`); }
        sql += ` ORDER BY a.created_at DESC LIMIT 15`;
        return { absences: db.prepare(sql).all(...params) };
      }

      case 'get_revenue_report': {
        const now = new Date();
        const month = now.toISOString().slice(0, 7);
        const year  = now.getFullYear();
        const totals = db.prepare(`
          SELECT
            COUNT(*) as total_invoices,
            COALESCE(SUM(total_amount),0) as total_billed,
            COALESCE(SUM(CASE WHEN status='paid' THEN total_amount ELSE 0 END),0) as total_paid,
            COALESCE(SUM(CASE WHEN status IN ('sent','viewed') THEN total_amount ELSE 0 END),0) as outstanding
          FROM invoices WHERE period_start LIKE ?
        `).get(`${month}%`);
        const byClient = db.prepare(`
          SELECT cl.name as client, COALESCE(SUM(i.total_amount),0) as billed, i.status
          FROM invoices i JOIN clients cl ON i.client_id = cl.id
          WHERE i.period_start LIKE ?
          GROUP BY cl.name, i.status ORDER BY billed DESC LIMIT 8
        `).all(`${month}%`);
        return { period: `${month} (current month)`, ...totals, by_client: byClient };
      }

      case 'create_employee': {
        const { name, email, hourly_rate, job_title = '', phone = '', start_date = null } = input;

        // Check duplicate email
        const existing = db.prepare('SELECT id FROM candidates WHERE email = ?').get(email);
        if (existing) return { success: false, error: `An employee with email ${email} already exists.` };

        // Create user account
        const bcrypt = require('bcryptjs');
        const tempPw = `HireIQ_${Math.random().toString(36).slice(2, 10)}`;
        const hash   = bcrypt.hashSync(tempPw, 10);

        const userRes = db.prepare(`
          INSERT INTO users (name, email, password_hash, role, must_change_password)
          VALUES (?, ?, ?, 'candidate', 1)
        `).run(name, email, hash);
        const userId = userRes.lastInsertRowid;

        db.prepare(`
          INSERT INTO candidates (user_id, name, email, phone, job_title, hourly_rate, status, start_date)
          VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
        `).run(userId, name, email, phone, job_title, hourly_rate, start_date);

        return {
          success: true,
          employee: { name, email, job_title, hourly_rate, phone, start_date },
          message: `Employee ${name} created successfully. Temporary password: ${tempPw} (they will be prompted to change on first login).`
        };
      }

      case 'generate_invoice': {
        const { client_name, description, hours_worked, rate, period_start, period_end } = input;

        // Find client
        const client = db.prepare(`SELECT id, name FROM clients WHERE name LIKE ? LIMIT 1`).get(`%${client_name}%`);
        if (!client) return { success: false, error: `No client found matching "${client_name}". Use list_clients to see available clients.` };

        const total_amount = parseFloat((hours_worked * rate).toFixed(2));
        const now = new Date().toISOString().slice(0, 10);
        const invoiceNum = `INV-${Date.now().toString().slice(-6)}`;

        db.prepare(`
          INSERT INTO invoices (invoice_number, client_id, description, hours, rate, total_amount, status, period_start, period_end, due_date)
          VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, date('now', '+30 days'))
        `).run(invoiceNum, client.id, description, hours_worked, rate, total_amount,
               period_start || now, period_end || now);

        return {
          success: true,
          invoice: { number: invoiceNum, client: client.name, description, hours_worked, rate, total_amount, status: 'draft' },
          message: `Invoice ${invoiceNum} created as draft for ${client.name} — $${total_amount.toLocaleString()} (${hours_worked}h @ $${rate}/h).`
        };
      }

      case 'send_report': {
        const { report_type, period } = input;
        const month = new Date().toISOString().slice(0, 7);

        let data = {};
        if (report_type === 'headcount') {
          data = executeTool(db, 'get_headcount', {}, userId);
        } else if (report_type === 'timesheets') {
          data = executeTool(db, 'get_timesheet_summary', {}, userId);
        } else if (report_type === 'absences') {
          data = executeTool(db, 'get_absence_summary', { status: 'all' }, userId);
        } else if (report_type === 'revenue' || report_type === 'invoices') {
          data = executeTool(db, 'get_revenue_report', { period }, userId);
        }
        return { report_type, period: period || `current month (${month})`, data };
      }

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    console.error(`[AI Tool] ${toolName} error:`, err.message);
    return { error: err.message };
  }
}

// ── GET /api/ai-chat/settings  (admin) ───────────────────────────────────────

router.get('/settings', requireAdmin, (req, res) => {
  const s = getTenantAISettings(req.db) || {};
  const platform = getPlatformAIConfig() || {};
  res.json({
    provider:             s.provider             || platform.provider || 'anthropic',
    model:                s.model                || platform.model    || 'claude-haiku-4-5-20251001',
    has_api_key:          !!s.api_key,
    system_prompt_suffix: s.system_prompt_suffix || '',
    // UI helpers
    available_providers:  PROVIDER_MODELS,
    platform_provider:    platform.provider || 'anthropic',
    platform_model:       platform.model    || 'claude-haiku-4-5-20251001',
    platform_has_key:     !!platform.api_key,
    allow_tenant_keys:    platform.allow_tenant_keys !== 0,
  });
});

// ── PUT /api/ai-chat/settings  (admin) ───────────────────────────────────────

router.put('/settings', requireAdmin, (req, res) => {
  const { provider, model, api_key, system_prompt_suffix, clear_api_key } = req.body;

  const validProviders = Object.keys(PROVIDER_MODELS);
  if (provider && !validProviders.includes(provider)) {
    return res.status(400).json({ error: `Invalid provider. Must be one of: ${validProviders.join(', ')}` });
  }
  if (model && provider) {
    const models = PROVIDER_MODELS[provider].map(m => m.id);
    if (!models.includes(model)) {
      return res.status(400).json({ error: `Invalid model for provider ${provider}. Valid models: ${models.join(', ')}` });
    }
  }

  try {
    const current = getTenantAISettings(req.db);
    if (!current) {
      // Seed the row first
      req.db.prepare('INSERT OR IGNORE INTO ai_settings (id) VALUES (1)').run();
    }

    const updates = [];
    const params  = [];
    if (provider)              { updates.push('provider=?');             params.push(provider); }
    if (model)                 { updates.push('model=?');                params.push(model); }
    if (system_prompt_suffix !== undefined) { updates.push('system_prompt_suffix=?'); params.push(system_prompt_suffix); }
    if (api_key)               { updates.push('api_key=?');              params.push(api_key); }
    if (clear_api_key)         { updates.push('api_key=NULL'); }

    if (updates.length) {
      updates.push('updated_at=CURRENT_TIMESTAMP', 'updated_by=?');
      params.push(req.user.id, 1);
      req.db.prepare(`UPDATE ai_settings SET ${updates.join(',')} WHERE id=?`).run(...params);
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/ai-chat/message ─────────────────────────────────────────────────

router.post('/message', async (req, res) => {
  const { message, conversationId } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });

  const db     = req.db;
  const userId = req.user.id;

  // ── Resolve AI config for this tenant ─────────────────────────────────────
  const tenantAI   = getTenantAISettings(db);
  const platformAI = getPlatformAIConfig();
  const aiConfig   = resolveAIConfig(tenantAI, platformAI);

  if (!aiConfig) {
    return res.status(503).json({
      error: 'AI Assistant is not configured. Ask your admin to set an API key in Settings → AI Assistant, or contact your platform administrator.',
      code: 'NO_API_KEY'
    });
  }

  const { provider, model, apiKey } = aiConfig;

  // ── 1. Get or create conversation ─────────────────────────────────────────
  let convId = conversationId;
  if (!convId) {
    const title = message.slice(0, 60) + (message.length > 60 ? '…' : '');
    const r = db.prepare(
      `INSERT INTO ai_conversations (user_id, title) VALUES (?, ?)`
    ).run(userId, title);
    convId = r.lastInsertRowid;
  } else {
    const conv = db.prepare('SELECT id FROM ai_conversations WHERE id=? AND user_id=?').get(convId, userId);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    db.prepare(`UPDATE ai_conversations SET updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(convId);
  }

  // ── 2. Load history ────────────────────────────────────────────────────────
  const history = db.prepare(`
    SELECT role, content FROM ai_messages
    WHERE conversation_id=? ORDER BY id DESC LIMIT 20
  `).all(convId).reverse();

  // ── 3. Document context via FTS ───────────────────────────────────────────
  const docHits = searchDocuments(db, message);
  const docCtx  = docHits.length
    ? '\n\nRelevant knowledge-base excerpts:\n' + docHits.map(d => `[${d.title}]: ${d.excerpt}`).join('\n')
    : '';

  // ── 4. Live tenant data snapshot ──────────────────────────────────────────
  const snap    = buildDataContext(db);
  const dataCtx = `
Current organisation snapshot:
- Employees: ${snap.employees.length} shown (${snap.employees.map(e => e.name).join(', ')})
- Clients: ${snap.clients.map(c => c.name).join(', ') || 'none'}
- Pending timesheets: ${snap.pendingTimesheets}, pending absences: ${snap.pendingAbsences}`;

  // ── 5. System prompt ──────────────────────────────────────────────────────
  const tenantName = req.user.tenantName || 'your organisation';
  const role       = req.user.role;
  const userName   = req.user.name;
  const today      = new Date().toISOString().slice(0, 10);
  const suffix     = tenantAI?.system_prompt_suffix ? `\n\n${tenantAI.system_prompt_suffix}` : '';

  const systemPrompt = `You are HireIQ Assistant — an intelligent AI for ${tenantName}'s HR and staffing platform.
Current user: ${userName} (${role})  |  Model: ${provider}/${model}  |  Today: ${today}
${dataCtx}${docCtx}

CAPABILITIES:
- Answer HR and staffing questions using live data via tools
- Create employees, generate invoices, produce reports
- Voice and text interaction supported

GUIDELINES:
- Be concise and professional, use markdown formatting
- When creating or modifying records: summarise what you're about to do, wait for confirmation, then call the tool
- If required fields are missing for an action, ask for them naturally in conversation
- Non-admin users can only see their own data
- Always include key figures (numbers, dates, amounts)
- Use markdown tables for lists of 3+ items${suffix}`;

  // ── 6. Build messages ─────────────────────────────────────────────────────
  const chatMessages = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: message }
  ];

  // Restrict write tools for non-admins
  const allowedTools = role === 'admin'
    ? TOOLS
    : TOOLS.filter(t => !['create_employee', 'generate_invoice', 'send_report'].includes(t.name));

  // ── 7. Run agentic loop via LLM service ──────────────────────────────────
  let finalText, toolCallsAccum;
  try {
    ({ finalText, toolCallsAccum } = await runAgenticLoop({
      provider,
      apiKey,
      model,
      systemPrompt,
      messages:    chatMessages,
      tools:       allowedTools,
      executeTool: (name, input) => executeTool(db, name, input, userId),
    }));
  } catch (err) {
    console.error('[AI Chat] LLM error:', err.message);
    return res.status(502).json({ error: `AI service error (${provider}): ${err.message}` });
  }

  if (!finalText) finalText = "I wasn't able to generate a response. Please try again.";

  // ── 8. Persist messages ───────────────────────────────────────────────────
  db.prepare(`INSERT INTO ai_messages (conversation_id, role, content) VALUES (?, 'user', ?)`).run(convId, message);
  db.prepare(`INSERT INTO ai_messages (conversation_id, role, content, tool_data) VALUES (?, 'assistant', ?, ?)`).run(
    convId, finalText, toolCallsAccum.length ? JSON.stringify(toolCallsAccum) : null
  );

  res.json({
    conversationId: convId,
    message:        finalText,
    toolData:       toolCallsAccum.length ? toolCallsAccum : undefined,
    model:          `${provider}/${model}`,
  });
});

// ── GET /api/ai-chat/conversations ────────────────────────────────────────────

router.get('/conversations', (req, res) => {
  const rows = req.db.prepare(`
    SELECT id, title, created_at, updated_at,
           (SELECT content FROM ai_messages WHERE conversation_id=ai_conversations.id AND role='assistant' ORDER BY id DESC LIMIT 1) as last_reply
    FROM ai_conversations WHERE user_id=? ORDER BY updated_at DESC LIMIT 30
  `).all(req.user.id);
  res.json(rows);
});

router.get('/conversations/:id', (req, res) => {
  const conv = req.db.prepare(
    'SELECT id,title,created_at FROM ai_conversations WHERE id=? AND user_id=?'
  ).get(req.params.id, req.user.id);
  if (!conv) return res.status(404).json({ error: 'Not found' });

  const messages = req.db.prepare(
    'SELECT id, role, content, tool_data, created_at FROM ai_messages WHERE conversation_id=? ORDER BY id ASC'
  ).all(req.params.id);

  res.json({ ...conv, messages });
});

router.delete('/conversations/:id', (req, res) => {
  const conv = req.db.prepare(
    'SELECT id FROM ai_conversations WHERE id=? AND user_id=?'
  ).get(req.params.id, req.user.id);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  req.db.prepare('DELETE FROM ai_conversations WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── GET /api/ai-chat/config ───────────────────────────────────────────────────

router.get('/config', (req, res) => {
  const tenantAI   = getTenantAISettings(req.db);
  const platformAI = getPlatformAIConfig();
  const aiConfig   = resolveAIConfig(tenantAI, platformAI);
  res.json({
    configured: !!aiConfig,
    provider:   aiConfig?.provider || null,
    model:      aiConfig?.model    || null,
  });
});

// ── GET /api/ai-chat/documents ────────────────────────────────────────────────

router.get('/documents', requireAdmin, (req, res) => {
  const docs = req.db.prepare(`
    SELECT d.id, d.title, d.file_name, d.file_type, d.file_size, d.created_at, u.name as uploaded_by_name
    FROM ai_documents d JOIN users u ON d.uploaded_by = u.id
    ORDER BY d.created_at DESC
  `).all();
  res.json(docs);
});

// ── POST /api/ai-chat/documents ───────────────────────────────────────────────

router.post('/documents', requireAdmin, upload.single('file'), async (req, res) => {
  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });

  let content = req.body.content || '';

  if (req.file) {
    const mime = req.file.mimetype;
    if (mime === 'application/pdf' || req.file.originalname.endsWith('.pdf')) {
      try {
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(req.file.buffer);
        content = data.text || '';
      } catch (e) {
        console.warn('[AI Docs] PDF parse error:', e.message);
        return res.status(400).json({ error: 'Failed to extract text from PDF' });
      }
    } else {
      content = req.file.buffer.toString('utf-8');
    }
  }

  if (!content.trim()) return res.status(400).json({ error: 'Document has no readable content' });

  const r = req.db.prepare(`
    INSERT INTO ai_documents (title, content, file_name, file_type, file_size, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    title.trim(),
    content.trim(),
    req.file?.originalname || null,
    req.file?.mimetype || 'text/plain',
    req.file?.size || content.length,
    req.user.id
  );

  res.json({ id: r.lastInsertRowid, title: title.trim(), message: 'Document added to knowledge base' });
});

// ── DELETE /api/ai-chat/documents/:id ─────────────────────────────────────────

router.delete('/documents/:id', requireAdmin, (req, res) => {
  const doc = req.db.prepare('SELECT id FROM ai_documents WHERE id=?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  req.db.prepare('DELETE FROM ai_documents WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;

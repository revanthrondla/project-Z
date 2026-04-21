/**
 * AI Chat Routes — Flow AI Assistant
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

async function getTenantAISettings(db) {
  try {
    const result = await db.query('SELECT * FROM ai_settings WHERE id=1');
    return result.rows[0];
  } catch { return null; }
}

async function getPlatformAIConfig() {
  try {
    const result = await masterDb.query('SELECT * FROM platform_ai_config WHERE id=1');
    return result.rows[0];
  } catch { return null; }
}

/** FTS document search — returns top-3 relevant snippets (PostgreSQL tsvector) */
async function searchDocuments(db, query) {
  try {
    // Strip characters that aren't valid in websearch_to_tsquery
    const safeQuery = query.replace(/[^a-zA-Z0-9 ]/g, ' ').trim();
    if (!safeQuery) return [];
    const result = await db.query(`
      SELECT d.title,
             ts_headline('english', d.content, websearch_to_tsquery('english', $1),
               'MaxWords=35, MinWords=15, StartSel=, StopSel=, HighlightAll=FALSE') AS excerpt
      FROM ai_documents d
      WHERE d.search_vector @@ websearch_to_tsquery('english', $2)
      ORDER BY ts_rank(d.search_vector, websearch_to_tsquery('english', $3)) DESC
      LIMIT 3
    `, [safeQuery, safeQuery, safeQuery]);
    return result.rows;
  } catch { return []; }
}

/** Pull a concise snapshot of tenant data the AI can use as context */
async function buildDataContext(db) {
  try {
    const employeesResult = await db.query(`
      SELECT name, role AS job_title, hourly_rate, status
      FROM candidates WHERE deleted_at IS NULL LIMIT 20
    `);
    const employees = employeesResult.rows;

    const clientsResult = await db.query(`
      SELECT name, contact_name, email FROM clients LIMIT 10
    `);
    const clients = clientsResult.rows;

    const pendingTSResult = await db.query(`
      SELECT COUNT(*) as count FROM time_entries WHERE status='pending'
    `);
    const pendingTS = pendingTSResult.rows[0];

    const pendingAbsResult = await db.query(`
      SELECT COUNT(*) as count FROM absences WHERE status='pending'
    `);
    const pendingAbs = pendingAbsResult.rows[0];

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

async function executeTool(db, toolName, input, userId) {
  try {
    switch (toolName) {
      case 'get_headcount': {
        const totalResult = await db.query("SELECT COUNT(*) as c FROM candidates WHERE deleted_at IS NULL");
        const total = totalResult.rows[0];

        const activeResult = await db.query("SELECT COUNT(*) as c FROM candidates WHERE deleted_at IS NULL AND status=$1", ['active']);
        const active = activeResult.rows[0];

        const byTitleResult = await db.query(`
          SELECT role AS job_title, COUNT(*) as count FROM candidates
          WHERE deleted_at IS NULL AND role IS NOT NULL AND role != ''
          GROUP BY role ORDER BY count DESC LIMIT 8
        `);
        const byTitle = byTitleResult.rows;

        return { total: total?.c || 0, active: active?.c || 0, inactive: (total?.c || 0) - (active?.c || 0), by_job_title: byTitle };
      }

      case 'list_employees': {
        const { status, job_title, limit = 10 } = input;
        let sql = `SELECT name, email, role AS job_title, hourly_rate, status, phone FROM candidates WHERE deleted_at IS NULL`;
        const params = [];
        let paramIndex = 1;
        if (status) { sql += ` AND status = $${paramIndex}`; params.push(status); paramIndex++; }
        if (job_title) { sql += ` AND role ILIKE $${paramIndex}`; params.push(`%${job_title}%`); paramIndex++; }
        sql += ` ORDER BY name LIMIT $${paramIndex}`;
        params.push(Math.min(limit, 50));
        const result = await db.query(sql, params);
        return { employees: result.rows };
      }

      case 'list_clients': {
        const { limit = 10 } = input;
        const result = await db.query(
          `SELECT name, contact_name, email, phone FROM clients ORDER BY name LIMIT $1`,
          [Math.min(limit, 50)]
        );
        return { clients: result.rows };
      }

      case 'get_timesheet_summary': {
        const { employee_name } = input;
        const month = new Date().toISOString().slice(0, 7);
        let pendingSql = `
          SELECT te.id, c.name as employee, te.date, te.hours, te.status, te.project
          FROM time_entries te JOIN candidates c ON te.candidate_id = c.id
          WHERE te.status = 'pending'
        `;
        const pendingParams = [];
        if (employee_name) { pendingSql += " AND c.name ILIKE $1"; pendingParams.push(`%${employee_name}%`); }
        pendingSql += ' ORDER BY te.date DESC LIMIT 10';
        const pendingResult = await db.query(pendingSql, pendingParams);
        const pending = pendingResult.rows;

        let monthlySql = `
          SELECT COALESCE(SUM(te.hours),0) as hours, COUNT(*) as entries
          FROM time_entries te
        `;
        const monthlyParams = [month];
        let monthlyParamIndex = 2;
        if (employee_name) { monthlySql += ' JOIN candidates c ON te.candidate_id=c.id'; }
        monthlySql += ` WHERE TO_CHAR(te.date, 'YYYY-MM') = $1 AND te.status != 'rejected'`;
        if (employee_name) { monthlySql += ` AND c.name ILIKE $${monthlyParamIndex}`; monthlyParams.push(`%${employee_name}%`); }

        const monthlyResult = await db.query(monthlySql, monthlyParams);
        const monthlyHours = monthlyResult.rows[0];

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
        let paramIndex = 1;
        if (status !== 'all') { sql += ` AND a.status = $${paramIndex}`; params.push(status); paramIndex++; }
        if (employee_name) { sql += ` AND c.name ILIKE $${paramIndex}`; params.push(`%${employee_name}%`); paramIndex++; }
        sql += ` ORDER BY a.created_at DESC LIMIT 15`;
        const result = await db.query(sql, params);
        return { absences: result.rows };
      }

      case 'get_revenue_report': {
        const now = new Date();
        const month = now.toISOString().slice(0, 7);
        const totalsResult = await db.query(`
          SELECT
            COUNT(*) as total_invoices,
            COALESCE(SUM(total_amount),0) as total_billed,
            COALESCE(SUM(CASE WHEN status='paid' THEN total_amount ELSE 0 END),0) as total_paid,
            COALESCE(SUM(CASE WHEN status IN ('sent','viewed') THEN total_amount ELSE 0 END),0) as outstanding
          FROM invoices WHERE TO_CHAR(period_start, 'YYYY-MM') = $1
        `, [month]);
        const totals = totalsResult.rows[0];

        const byClientResult = await db.query(`
          SELECT cl.name as client, COALESCE(SUM(i.total_amount),0) as billed, i.status
          FROM invoices i JOIN clients cl ON i.client_id = cl.id
          WHERE TO_CHAR(i.period_start, 'YYYY-MM') = $1
          GROUP BY cl.name, i.status ORDER BY billed DESC LIMIT 8
        `, [month]);
        const byClient = byClientResult.rows;

        return { period: `${month} (current month)`, ...totals, by_client: byClient };
      }

      case 'create_employee': {
        const { name, email, hourly_rate, job_title = '', phone = '', start_date = null } = input;

        // Check duplicate email
        const existingResult = await db.query('SELECT id FROM candidates WHERE email = $1', [email]);
        const existing = existingResult.rows[0];
        if (existing) return { success: false, error: `An employee with email ${email} already exists.` };

        // Create user account
        const bcrypt = require('bcryptjs');
        const tempPw = `Flow_${Math.random().toString(36).slice(2, 10)}`;
        const hash   = await bcrypt.hash(tempPw, 10);

        const userRes = await db.query(`
          INSERT INTO users (name, email, password_hash, role, must_change_password)
          VALUES ($1, $2, $3, $4, $5) RETURNING id
        `, [name, email, hash, 'candidate', true]);
        const newUserId = userRes.rows[0].id;

        // Index email → tenant for seamless login (non-blocking)
        const { indexUserEmail } = require('../masterDatabase');
        indexUserEmail(email, req.user.tenantSlug).catch(() => {});

        await db.query(`
          INSERT INTO candidates (user_id, name, email, phone, role, hourly_rate, status, start_date)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [newUserId, name, email, phone, job_title, hourly_rate, 'active', start_date]);

        return {
          success: true,
          employee: { name, email, job_title, hourly_rate, phone, start_date },
          message: `Employee ${name} created successfully. Temporary password: ${tempPw} (they will be prompted to change on first login).`
        };
      }

      case 'generate_invoice': {
        const { client_name, description, hours_worked, rate, period_start, period_end } = input;

        // Find client
        const clientResult = await db.query(`SELECT id, name FROM clients WHERE name ILIKE $1 LIMIT 1`, [`%${client_name}%`]);
        const client = clientResult.rows[0];
        if (!client) return { success: false, error: `No client found matching "${client_name}". Use list_clients to see available clients.` };

        const total_amount = parseFloat((hours_worked * rate).toFixed(2));
        const now = new Date().toISOString().slice(0, 10);
        const invoiceNum = `INV-${Date.now().toString().slice(-6)}`;

        await db.query(`
          INSERT INTO invoices (invoice_number, client_id, description, hours, rate, total_amount, status, period_start, period_end, due_date)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE + INTERVAL '30 days')
        `, [invoiceNum, client.id, description, hours_worked, rate, total_amount, 'draft',
            period_start || now, period_end || now]);

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
          data = await executeTool(db, 'get_headcount', {}, userId);
        } else if (report_type === 'timesheets') {
          data = await executeTool(db, 'get_timesheet_summary', {}, userId);
        } else if (report_type === 'absences') {
          data = await executeTool(db, 'get_absence_summary', { status: 'all' }, userId);
        } else if (report_type === 'revenue' || report_type === 'invoices') {
          data = await executeTool(db, 'get_revenue_report', { period }, userId);
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

router.get('/settings', requireAdmin, async (req, res) => {
  try {
    const s = await getTenantAISettings(req.db) || {};
    const platform = await getPlatformAIConfig() || {};
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/ai-chat/settings  (admin) ───────────────────────────────────────

router.put('/settings', requireAdmin, async (req, res) => {
  try {
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

    const current = await getTenantAISettings(req.db);
    if (!current) {
      // Seed the row first
      await req.db.query('INSERT INTO ai_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    }

    const updates = [];
    const params  = [];
    let paramIndex = 1;
    if (provider)              { updates.push(`provider=$${paramIndex}`); params.push(provider); paramIndex++; }
    if (model)                 { updates.push(`model=$${paramIndex}`); params.push(model); paramIndex++; }
    if (system_prompt_suffix !== undefined) { updates.push(`system_prompt_suffix=$${paramIndex}`); params.push(system_prompt_suffix); paramIndex++; }
    if (api_key)               { updates.push(`api_key=$${paramIndex}`); params.push(api_key); paramIndex++; }
    if (clear_api_key)         { updates.push('api_key=NULL'); }

    if (updates.length) {
      updates.push('updated_at=NOW()');
      params.push(1);
      await req.db.query(`UPDATE ai_settings SET ${updates.join(',')} WHERE id=$${paramIndex}`, params);
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
  const tenantAI   = await getTenantAISettings(db);
  const platformAI = await getPlatformAIConfig();
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
    const r = await db.query(
      `INSERT INTO ai_conversations (user_id, title) VALUES ($1, $2) RETURNING id`,
      [userId, title]
    );
    convId = r.rows[0].id;
  } else {
    const convResult = await db.query('SELECT id FROM ai_conversations WHERE id=$1 AND user_id=$2', [convId, userId]);
    const conv = convResult.rows[0];
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    await db.query(`UPDATE ai_conversations SET updated_at=NOW() WHERE id=$1`, [convId]);
  }

  // ── 2. Load history ────────────────────────────────────────────────────────
  const historyResult = await db.query(`
    SELECT role, content FROM ai_messages
    WHERE conversation_id=$1 ORDER BY id DESC LIMIT 20
  `, [convId]);
  const history = historyResult.rows.reverse();

  // ── 3. Document context via FTS ───────────────────────────────────────────
  const docHits = await searchDocuments(db, message);
  const docCtx  = docHits.length
    ? '\n\nRelevant knowledge-base excerpts:\n' + docHits.map(d => `[${d.title}]: ${d.excerpt}`).join('\n')
    : '';

  // ── 4. Live tenant data snapshot ──────────────────────────────────────────
  const snap    = await buildDataContext(db);
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

  const systemPrompt = `You are Flow Assistant — an intelligent AI for ${tenantName}'s HR and staffing platform.
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
  await db.query(`INSERT INTO ai_messages (conversation_id, role, content) VALUES ($1, $2, $3)`, [convId, 'user', message]);
  await db.query(`INSERT INTO ai_messages (conversation_id, role, content, tool_data) VALUES ($1, $2, $3, $4)`, [
    convId, 'assistant', finalText, toolCallsAccum.length ? JSON.stringify(toolCallsAccum) : null
  ]);

  res.json({
    conversationId: convId,
    message:        finalText,
    toolData:       toolCallsAccum.length ? toolCallsAccum : undefined,
    model:          `${provider}/${model}`,
  });
});

// ── GET /api/ai-chat/conversations ────────────────────────────────────────────

router.get('/conversations', async (req, res) => {
  try {
    const result = await req.db.query(`
      SELECT id, title, created_at, updated_at,
             (SELECT content FROM ai_messages WHERE conversation_id=ai_conversations.id AND role='assistant' ORDER BY id DESC LIMIT 1) as last_reply
      FROM ai_conversations WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 30
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/conversations/:id', async (req, res) => {
  try {
    const convResult = await req.db.query(
      'SELECT id,title,created_at FROM ai_conversations WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    const conv = convResult.rows[0];
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const messagesResult = await req.db.query(
      'SELECT id, role, content, tool_data, created_at FROM ai_messages WHERE conversation_id=$1 ORDER BY id ASC',
      [req.params.id]
    );
    const messages = messagesResult.rows;

    res.json({ ...conv, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/conversations/:id', async (req, res) => {
  try {
    const convResult = await req.db.query(
      'SELECT id FROM ai_conversations WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    const conv = convResult.rows[0];
    if (!conv) return res.status(404).json({ error: 'Not found' });
    await req.db.query('DELETE FROM ai_conversations WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/ai-chat/config ───────────────────────────────────────────────────

router.get('/config', async (req, res) => {
  try {
    const tenantAI   = await getTenantAISettings(req.db);
    const platformAI = await getPlatformAIConfig();
    const aiConfig   = resolveAIConfig(tenantAI, platformAI);
    res.json({
      configured: !!aiConfig,
      provider:   aiConfig?.provider || null,
      model:      aiConfig?.model    || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/ai-chat/documents ────────────────────────────────────────────────

router.get('/documents', requireAdmin, async (req, res) => {
  try {
    const result = await req.db.query(`
      SELECT d.id, d.title, d.file_name, d.file_type, d.file_size, d.created_at, u.name as uploaded_by_name
      FROM ai_documents d JOIN users u ON d.uploaded_by = u.id
      ORDER BY d.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

  const result = await req.db.query(`
    INSERT INTO ai_documents (title, content, file_name, file_type, file_size, uploaded_by)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
  `, [
    title.trim(),
    content.trim(),
    req.file?.originalname || null,
    req.file?.mimetype || 'text/plain',
    req.file?.size || content.length,
    req.user.id
  ]);

  res.json({ id: result.rows[0].id, title: title.trim(), message: 'Document added to knowledge base' });
});

// ── DELETE /api/ai-chat/documents/:id ─────────────────────────────────────────

router.delete('/documents/:id', requireAdmin, async (req, res) => {
  try {
    const docResult = await req.db.query('SELECT id FROM ai_documents WHERE id=$1', [req.params.id]);
    const doc = docResult.rows[0];
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    await req.db.query('DELETE FROM ai_documents WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

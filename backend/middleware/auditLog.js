/**
 * Audit Logging Middleware  (SOC 2 CC7.2 — tamper-resistant activity log)
 *
 * Writes audit records to TWO destinations:
 *   1. master.security_audit_logs  — tamper-resistant, cross-tenant, searchable
 *   2. tenant audit_logs           — per-tenant legacy table (backward compat)
 *
 * Usage:
 *   router.put('/:id', authenticate, injectTenantDb, auditLog('candidates'), handler)
 */

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function _action(method) {
  if (method === 'DELETE') return 'delete';
  if (method === 'POST')   return 'create';
  return 'update';
}

async function _writeMasterAudit(req, tableName, recordId, action, body) {
  try {
    const { writeSecurityAuditLog } = require('../masterDatabase');
    await writeSecurityAuditLog({
      tenantSlug:  req.user?.tenantSlug ?? null,
      tableName,
      recordId:    recordId ? String(recordId) : null,
      action,
      changedBy:   req.user?.id ?? null,
      oldValues:   action !== 'create' ? (req._auditOldValues ?? null) : null,
      newValues:   action !== 'delete' ? body : null,
      ipAddress:   req.ip ?? req.headers['x-forwarded-for'] ?? null,
      userAgent:   req.headers['user-agent']?.slice(0, 255) ?? null,
    });
  } catch (e) {
    console.error('[audit-master]', e.message);
  }
}

async function _writeTenantAudit(req, tableName, recordId, action, body) {
  if (!req.db) return;
  try {
    await req.db.query(`
      INSERT INTO audit_logs
        (table_name, record_id, action, changed_by, old_values, new_values, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      tableName,
      recordId ? String(recordId) : null,
      action,
      req.user?.id ?? null,
      action !== 'create' ? JSON.stringify(req._auditOldValues ?? null) : null,
      action !== 'delete' ? JSON.stringify(body)                        : null,
      req.ip ?? req.headers['x-forwarded-for'] ?? null,
      req.headers['user-agent']?.slice(0, 255) ?? null,
    ]);
  } catch (e) {
    console.error('[audit-tenant]', e.message);
  }
}

/**
 * Returns a middleware that, after the handler sends a 2xx response,
 * asynchronously inserts audit records into master + tenant schemas.
 *
 * @param {string} tableName  — e.g. 'candidates', 'time_entries'
 * @param {Function} [getRecordId]  — optional; extracts record ID from req/res; defaults to req.params.id
 */
function auditLog(tableName, getRecordId) {
  return async (req, res, next) => {
    const origJson = res.json.bind(res);

    res.json = function (body) {
      if (req.user && MUTATION_METHODS.has(req.method)) {
        const statusCode = res.statusCode;
        if (statusCode >= 200 && statusCode < 300) {
          const recordId = getRecordId
            ? getRecordId(req, body)
            : (req.params?.id ?? body?.id ?? null);
          const action = _action(req.method);

          setImmediate(async () => {
            await Promise.all([
              _writeMasterAudit(req, tableName, recordId, action, body),
              _writeTenantAudit(req, tableName, recordId, action, body),
            ]);
          });
        }
      }
      return origJson(body);
    };

    next();
  };
}

/**
 * Global response hook — infers table_name from URL path.
 * Attach per-router-group, not globally, for performance.
 */
function buildPathAuditMiddleware() {
  return async (req, res, next) => {
    if (!MUTATION_METHODS.has(req.method)) return next();

    const origJson = res.json.bind(res);
    res.json = function (body) {
      if (req.user) {
        const statusCode = res.statusCode;
        if (statusCode >= 200 && statusCode < 300) {
          const parts     = req.path.replace(/^\/api\//, '').split('/');
          const tableName = parts[0]?.replace(/-/g, '_') ?? 'unknown';
          const recordId  = req.params?.id ?? body?.id ?? null;
          const action    = _action(req.method);

          setImmediate(async () => {
            await Promise.all([
              _writeMasterAudit(req, tableName, recordId, action, body),
              _writeTenantAudit(req, tableName, recordId, action, body),
            ]);
          });
        }
      }
      return origJson(body);
    };

    next();
  };
}

/**
 * GET /api/audit-logs — admin-only paginated viewer.
 * Reads from master security_audit_logs, scoped to the current tenant.
 * Register as: app.get('/api/audit-logs', authenticate, requireAdmin, injectTenantDb, auditLogViewer)
 */
async function auditLogViewer(req, res) {
  try {
    const { masterDb } = require('../masterDatabase');
    const { table_name, record_id, action, user_id, from, to, limit = 50, offset = 0 } = req.query;

    const tenantSlug = req.user?.tenantSlug ?? null;

    const params = [];
    const where  = [];

    // Always scope to current tenant (super_admin sees all if no tenantSlug)
    if (tenantSlug) {
      params.push(tenantSlug);
      where.push(`tenant_slug = $${params.length}`);
    }
    if (table_name) { params.push(table_name);              where.push(`table_name = $${params.length}`); }
    if (record_id)  { params.push(record_id);               where.push(`record_id  = $${params.length}`); }
    if (action)     { params.push(action);                  where.push(`action     = $${params.length}`); }
    if (user_id)    { params.push(parseInt(user_id, 10));   where.push(`changed_by = $${params.length}`); }
    if (from)       { params.push(from);                    where.push(`changed_at >= $${params.length}`); }
    if (to)         { params.push(to);                      where.push(`changed_at <= $${params.length}::date + interval '1 day'`); }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countParams = [...params];
    params.push(Math.min(parseInt(limit, 10), 200));
    params.push(parseInt(offset, 10));

    const [logsResult, countResult] = await Promise.all([
      masterDb.query(`
        SELECT id, tenant_slug, table_name, record_id, action,
               changed_by, changed_at, old_values, new_values,
               ip_address, user_agent
        FROM security_audit_logs
        ${whereClause}
        ORDER BY changed_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `, params),
      masterDb.query(
        `SELECT COUNT(*) FROM security_audit_logs ${whereClause}`,
        countParams
      ),
    ]);

    res.json({
      logs:   logsResult.rows,
      total:  parseInt(countResult.rows[0].count, 10),
      limit:  parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });
  } catch (err) {
    console.error('[audit-log viewer]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { auditLog, buildPathAuditMiddleware, auditLogViewer };

/**
 * Audit Logging Middleware
 *
 * Wraps POST / PUT / PATCH / DELETE routes and writes a record to audit_logs
 * after a successful (2xx) response.
 *
 * Usage:
 *   router.put('/:id', authenticate, injectTenantDb, auditLog('candidates'), async (req, res) => { ... })
 *
 * Or use the auto-intercept version that wires in via Express response hooks:
 *   router.use(auditResponseHook);   // global — fires on every 2xx mutation
 */

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Returns a middleware that, after the handler sends a 2xx response,
 * asynchronously inserts an audit record.
 *
 * @param {string} tableName  — e.g. 'candidates', 'time_entries'
 * @param {Function} [getRecordId]  — optional, extracts record ID from req/res; defaults to req.params.id
 */
function auditLog(tableName, getRecordId) {
  return async (req, res, next) => {
    // Capture original json method
    const origJson = res.json.bind(res);

    res.json = function (body) {
      // Fire-and-forget audit write after response headers committed
      if (req.db && req.user && MUTATION_METHODS.has(req.method)) {
        const statusCode = res.statusCode;
        if (statusCode >= 200 && statusCode < 300) {
          const recordId = getRecordId
            ? getRecordId(req, body)
            : (req.params?.id ?? body?.id ?? null);

          const action = req.method === 'DELETE' ? 'delete'
                       : req.method === 'POST'   ? 'create'
                       : 'update';

          setImmediate(async () => {
            try {
              await req.db.query(`
                INSERT INTO audit_logs
                  (table_name, record_id, action, changed_by, old_values, new_values, ip_address, user_agent)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              `, [
                tableName,
                recordId ? String(recordId) : null,
                action,
                req.user.id,
                req.method !== 'POST' ? JSON.stringify(req._auditOldValues ?? null) : null,
                action !== 'delete'   ? JSON.stringify(body)                        : null,
                req.ip ?? req.headers['x-forwarded-for'] ?? null,
                req.headers['user-agent']?.slice(0, 255) ?? null,
              ]);
            } catch (e) {
              // Audit failure must not crash the app
              console.error('[audit]', e.message);
            }
          });
        }
      }
      return origJson(body);
    };

    next();
  };
}

/**
 * Global response hook — attaches to every request.
 * Infers table_name from URL path segment after /api/.
 * Add to app after route registration: app.use(auditResponseHook) — NO,
 * better used per-router-group for performance.
 */
function buildPathAuditMiddleware() {
  return async (req, res, next) => {
    if (!MUTATION_METHODS.has(req.method)) return next();

    const origJson = res.json.bind(res);
    res.json = function (body) {
      if (req.db && req.user) {
        const statusCode = res.statusCode;
        if (statusCode >= 200 && statusCode < 300) {
          // Derive table name from URL: /api/candidates/123 → 'candidates'
          const parts = req.path.replace(/^\/api\//, '').split('/');
          const tableName = parts[0]?.replace(/-/g, '_') ?? 'unknown';
          const recordId  = req.params?.id ?? body?.id ?? null;
          const action    = req.method === 'DELETE' ? 'delete'
                          : req.method === 'POST'   ? 'create'
                          : 'update';

          setImmediate(async () => {
            try {
              await req.db.query(`
                INSERT INTO audit_logs
                  (table_name, record_id, action, changed_by, new_values, ip_address, user_agent)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
              `, [
                tableName,
                recordId ? String(recordId) : null,
                action,
                req.user.id,
                action !== 'delete' ? JSON.stringify(body) : null,
                req.ip ?? req.headers['x-forwarded-for'] ?? null,
                req.headers['user-agent']?.slice(0, 255) ?? null,
              ]);
            } catch (e) {
              console.error('[audit-global]', e.message);
            }
          });
        }
      }
      return origJson(body);
    };

    next();
  };
}

/**
 * GET /api/audit-logs — admin-only paginated viewer
 * Register as: app.get('/api/audit-logs', authenticate, requireAdmin, injectTenantDb, auditLogViewer)
 */
async function auditLogViewer(req, res) {
  try {
    const { table_name, record_id, action, user_id, from, to, limit = 50, offset = 0 } = req.query;

    const params = [];
    const where  = [];

    if (table_name) { params.push(table_name); where.push(`al.table_name = $${params.length}`); }
    if (record_id)  { params.push(record_id);  where.push(`al.record_id  = $${params.length}`); }
    if (action)     { params.push(action);     where.push(`al.action     = $${params.length}`); }
    if (user_id)    { params.push(parseInt(user_id, 10)); where.push(`al.changed_by = $${params.length}`); }
    if (from)       { params.push(from);       where.push(`al.changed_at >= $${params.length}`); }
    if (to)         { params.push(to);         where.push(`al.changed_at <= $${params.length}::date + interval '1 day'`); }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    params.push(Math.min(parseInt(limit, 10), 200));
    params.push(parseInt(offset, 10));

    const [rows, countRow] = await Promise.all([
      req.db.query(`
        SELECT al.*, u.name AS changed_by_name, u.email AS changed_by_email
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.changed_by
        ${whereClause}
        ORDER BY al.changed_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `, params),
      req.db.query(`SELECT COUNT(*) FROM audit_logs al ${whereClause}`, params.slice(0, -2)),
    ]);

    res.json({
      logs:   rows.rows,
      total:  parseInt(countRow.rows[0].count, 10),
      limit:  parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });
  } catch (err) {
    console.error('[audit-log viewer]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { auditLog, buildPathAuditMiddleware, auditLogViewer };

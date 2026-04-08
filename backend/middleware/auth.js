const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { createScopedWrapper } = require('../db/wrapper');

// ── JWT Secret enforcement ────────────────────────────────────────────────────
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[FATAL] JWT_SECRET environment variable is not set.');
    process.exit(1);
  }
  JWT_SECRET = 'flow-dev-only-DO-NOT-USE-IN-PROD';
  console.warn('\n⚠️  WARNING: JWT_SECRET not set — using insecure dev default.\n');
}

function authenticate(req, res, next) {
  let token = req.cookies?.flow_token;
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) token = authHeader.split(' ')[1];
  }
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (!decoded.exp) return res.status(401).json({ error: 'Token has no expiry — rejected for security' });
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'super_admin') return res.status(403).json({ error: 'Super-admin access required' });
  next();
}

/**
 * Middleware: inject req.db for tenant routes (PostgreSQL version).
 *
 * Checks out a pg connection from the pool, sets search_path to the
 * tenant's schema, and attaches a scoped wrapper to req.db.
 * The connection is released after the response finishes.
 */
async function injectTenantDb(req, res, next) {
  if (!req.user) return next();
  if (req.user.role === 'super_admin') return next(); // super-admin uses masterDb directly

  const slug = req.user.tenantSlug;
  const schema = slug ? `tenant_${slug}` : 'tenant_hireiq'; // legacy dev fallback

  try {
    const { wrapper, release } = await createScopedWrapper(pool, schema);
    req.db = wrapper;

    // Release the pg connection when the HTTP response is done
    const cleanup = () => release();
    res.on('finish', cleanup);
    res.on('close', cleanup);

    next();
  } catch (err) {
    console.error('[injectTenantDb] Failed to get DB connection:', err.message);
    res.status(503).json({ error: 'Database connection unavailable' });
  }
}

/**
 * Middleware factory: gate a route behind a licensable module.
 */
function requireModule(moduleKey) {
  return async function moduleGuard(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.user.role === 'super_admin') return next();

    const slug = req.user.tenantSlug;
    if (!slug) return next();

    try {
      const { masterDb } = require('../masterDatabase');
      const { MODULE_REGISTRY } = require('../moduleRegistry');

      try {
        const { seedDefaultModulesForTenant } = require('../masterDatabase');
        await seedDefaultModulesForTenant(slug);
      } catch {}

      const row = await masterDb
        .prepare('SELECT enabled FROM tenant_modules WHERE tenant_slug = $1 AND module_key = $2')
        .get(slug, moduleKey);

      if (row !== undefined && row !== null) {
        if (!row.enabled) {
          return res.status(403).json({
            error: `Module '${moduleKey}' is not enabled for this tenant`,
            code: 'MODULE_DISABLED',
          });
        }
      } else {
        const entry = MODULE_REGISTRY.find(m => m.key === moduleKey);
        if (entry && !entry.default) {
          return res.status(403).json({
            error: `Module '${moduleKey}' is not enabled for this tenant`,
            code: 'MODULE_DISABLED',
          });
        }
      }
      next();
    } catch (err) {
      console.error('[requireModule] Error checking module:', err.message);
      next();
    }
  };
}

module.exports = { authenticate, requireAdmin, requireSuperAdmin, injectTenantDb, requireModule, JWT_SECRET };

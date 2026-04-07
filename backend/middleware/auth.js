const jwt = require('jsonwebtoken');

// ── JWT Secret enforcement ────────────────────────────────────────────────────
// In production JWT_SECRET MUST be set — hard fail if missing.
// In development a weak default is used with a loud warning.
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[FATAL] JWT_SECRET environment variable is not set. Refusing to start in production without a secret.');
    process.exit(1);
  }
  JWT_SECRET = 'hireiq-dev-only-DO-NOT-USE-IN-PROD';
  console.warn('\n⚠️  WARNING: JWT_SECRET not set — using insecure dev default. Set JWT_SECRET before deploying!\n');
}

function authenticate(req, res, next) {
  // Prefer httpOnly cookie (set by the login endpoint).
  // Fall back to Authorization: Bearer header for API clients / mobile apps.
  let token = req.cookies?.hireiq_token;
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) token = authHeader.split(' ')[1];
  }

  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (!decoded.exp) {
      return res.status(401).json({ error: 'Token has no expiry — rejected for security' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super-admin access required' });
  }
  next();
}

/**
 * Middleware: inject req.db for tenant routes.
 * Must run AFTER authenticate so req.user is already set.
 * - super_admin users: no tenant DB needed (they use masterDb directly)
 * - tenant users: open the correct tenant DB via tenantSlug from JWT
 */
function injectTenantDb(req, res, next) {
  if (!req.user) return next();
  if (req.user.role === 'super_admin') return next(); // super-admin uses masterDb

  const slug = req.user.tenantSlug;
  if (!slug) {
    // Legacy default-DB path (dev/testing without tenant slug)
    req.db = require('../database').db;
    return next();
  }

  try {
    const { getTenantDb } = require('../database');
    req.db = getTenantDb(slug);
    next();
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Tenant database unavailable' });
  }
}

/**
 * Middleware factory: gate a route behind a licensable module.
 * Must run AFTER authenticate + injectTenantDb so req.user and req.db are set.
 *
 * Super-admins always pass — they operate across all tenants.
 * Tenant users pass only when the module is enabled in tenant_modules.
 *
 * Usage:
 *   router.use(authenticate, injectTenantDb, requireModule('hr_support'), ...handlers)
 */
function requireModule(moduleKey) {
  return function moduleGuard(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

    // Super-admins bypass module checks
    if (req.user.role === 'super_admin') return next();

    const slug = req.user.tenantSlug;
    if (!slug) return next(); // legacy dev path — allow

    try {
      const { masterDb, seedDefaultModulesForTenant } = require('../masterDatabase');
      const { MODULE_REGISTRY } = require('../moduleRegistry');

      // Ensure module rows are seeded for this tenant
      try { seedDefaultModulesForTenant(slug); } catch {}

      const row = masterDb
        .prepare('SELECT enabled FROM tenant_modules WHERE tenant_slug = ? AND module_key = ?')
        .get(slug, moduleKey);

      if (row !== undefined) {
        // Row exists — trust its value
        if (!row.enabled) {
          return res.status(403).json({
            error: `Module '${moduleKey}' is not enabled for this tenant`,
            code: 'MODULE_DISABLED',
          });
        }
      } else {
        // Module not yet in DB — fall back to registry default
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
      // On any unexpected error, fail open to avoid blocking legitimate users
      console.error('[requireModule] Error checking module:', err.message);
      next();
    }
  };
}

module.exports = { authenticate, requireAdmin, requireSuperAdmin, injectTenantDb, requireModule, JWT_SECRET };

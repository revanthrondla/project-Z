const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { authenticate, injectTenantDb, JWT_SECRET } = require('../middleware/auth');
const { masterDb }  = require('../masterDatabase');
const { getTenantDb, db: defaultDb } = require('../database');

const router = express.Router();

// ── Cookie options ────────────────────────────────────────────────────────────
const COOKIE_NAME = 'hireiq_token';
function cookieOptions() {
  return {
    httpOnly: true,                                          // Not accessible via JS
    secure: process.env.NODE_ENV === 'production',           // HTTPS only in prod
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    maxAge: 8 * 60 * 60 * 1000,                             // 8 hours in ms
    path: '/',
  };
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────
// Body: { email, password, companySlug? }
//   - No companySlug → attempt super-admin login via master DB
//   - companySlug    → look up tenant, authenticate against their DB
router.post('/login', (req, res) => {
  const { email, password, companySlug } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // ── Super-admin path (no companySlug) ──────────────────────────────────────
  if (!companySlug) {
    const superAdmin = masterDb.prepare(
      'SELECT * FROM super_admins WHERE email = ?'
    ).get(normalizedEmail);

    if (!superAdmin) {
      return res.status(401).json({ error: 'Invalid credentials or missing organization code' });
    }

    const valid = bcrypt.compareSync(password, superAdmin.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: superAdmin.id, email: superAdmin.email, name: superAdmin.name, role: 'super_admin' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.cookie(COOKIE_NAME, token, cookieOptions());
    return res.json({
      token,   // Also returned for API / non-browser clients
      user: { id: superAdmin.id, name: superAdmin.name, email: superAdmin.email, role: 'super_admin' },
    });
  }

  // ── Tenant path (companySlug provided) ─────────────────────────────────────
  const tenant = masterDb.prepare(
    'SELECT * FROM tenants WHERE slug = ?'
  ).get(companySlug.toLowerCase().trim());

  if (!tenant) {
    return res.status(401).json({ error: `Organization '${companySlug}' not found` });
  }
  if (tenant.status === 'suspended') {
    return res.status(403).json({ error: 'This organization account has been suspended' });
  }

  let tenantDb;
  try {
    tenantDb = getTenantDb(tenant.slug);
  } catch (err) {
    console.error('Tenant DB error on login:', err.message);
    return res.status(500).json({ error: 'Unable to connect to organization database' });
  }

  const user = tenantDb.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  let candidateId = null;
  if (user.role === 'candidate') {
    const cand = tenantDb.prepare('SELECT id FROM candidates WHERE user_id = ?').get(user.id);
    if (cand) candidateId = cand.id;
  }

  let clientId = null;
  if (user.role === 'client') {
    const clientRec = tenantDb.prepare('SELECT id FROM clients WHERE user_id = ?').get(user.id);
    if (clientRec) clientId = clientRec.id;
  }

  const mustChangePw = !!(user.must_change_password);

  const token = jwt.sign(
    {
      id: user.id, email: user.email, name: user.name, role: user.role,
      candidateId, clientId,
      tenantSlug: tenant.slug,
      tenantName: tenant.company_name,
      mustChangePw,
    },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.json({
    token,   // Also returned for API / non-browser clients
    user: {
      id: user.id, name: user.name, email: user.email, role: user.role,
      candidateId, clientId,
      tenantSlug: tenant.slug,
      tenantName: tenant.company_name,
      mustChangePw,
    },
  });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: 0 });
  res.json({ message: 'Logged out' });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', authenticate, injectTenantDb, (req, res) => {
  if (req.user.role === 'super_admin') {
    const sa = masterDb.prepare(
      'SELECT id, name, email, created_at FROM super_admins WHERE id = ?'
    ).get(req.user.id);
    if (!sa) return res.status(404).json({ error: 'User not found' });
    return res.json({ ...sa, role: 'super_admin' });
  }

  const db   = req.db;
  const user = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// ── PUT /api/auth/change-password ─────────────────────────────────────────────
router.put('/change-password', authenticate, injectTenantDb, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  if (req.user.role === 'super_admin') {
    const sa = masterDb.prepare('SELECT * FROM super_admins WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(currentPassword, sa.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    masterDb.prepare('UPDATE super_admins SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), req.user.id);
    const freshToken = jwt.sign(
      { id: sa.id, email: sa.email, name: sa.name, role: 'super_admin', mustChangePw: false },
      JWT_SECRET, { expiresIn: '8h' }
    );
    res.cookie(COOKIE_NAME, freshToken, cookieOptions());
    return res.json({ message: 'Password updated successfully', token: freshToken });
  }

  const db   = req.db;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), req.user.id);

  // Issue a fresh token with mustChangePw cleared so the UI unlocks immediately
  const freshToken = jwt.sign(
    {
      id: user.id, email: user.email, name: user.name, role: user.role,
      candidateId: req.user.candidateId || null,
      clientId:    req.user.clientId    || null,
      tenantSlug:  req.user.tenantSlug  || null,
      tenantName:  req.user.tenantName  || null,
      mustChangePw: false,
    },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
  res.cookie(COOKIE_NAME, freshToken, cookieOptions());
  res.json({ message: 'Password updated successfully', token: freshToken });
});

module.exports = router;

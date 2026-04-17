const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { authenticate, JWT_SECRET, injectTenantDb } = require('../middleware/auth');
const { masterDb } = require('../masterDatabase');
const { getTenantDb } = require('../database');

const router = express.Router();

// ── Cookie options ────────────────────────────────────────────────────────────
const COOKIE_NAME = 'flow_token';
function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    maxAge: 8 * 60 * 60 * 1000,
    path: '/',
  };
}

/**
 * Helper: Get user's MFA data from either master DB (super_admin) or tenant DB (tenant user).
 * Returns { db, user, isSuperAdmin }
 */
async function getUserWithMfa(userId, isSuperAdmin = false) {
  if (isSuperAdmin) {
    const result = await masterDb.query(
      'SELECT id, name, email, mfa_secret, mfa_backup_codes, mfa_enabled FROM super_admins WHERE id = $1',
      [userId]
    );
    return { user: result.rows[0], db: masterDb, isSuperAdmin: true };
  }
  // Tenant user case handled per-route since we need tenantDb access
  return null;
}

/**
 * Helper: Hash backup codes array using bcrypt.
 */
async function hashBackupCodes(plainCodes) {
  const hashed = [];
  for (const code of plainCodes) {
    const hash = await bcrypt.hash(code.toUpperCase(), 10);
    hashed.push(hash);
  }
  return hashed;
}

/**
 * Helper: Generate 10 backup codes (8 hex chars each).
 */
function generateBackupCodes() {
  const codes = [];
  for (let i = 0; i < 10; i++) {
    codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
  }
  return codes;
}

// ──────────────────────────────────────────────────────────────────────────────
// POST /verify — NO auth, uses mfaToken
// ──────────────────────────────────────────────────────────────────────────────
router.post('/verify', async (req, res) => {
  try {
    const { mfaToken, code } = req.body;
    if (!mfaToken || !code) {
      return res.status(400).json({ error: 'mfaToken and code required' });
    }

    // Verify mfaToken JWT (type === 'mfa_pending')
    let decoded;
    try {
      decoded = jwt.verify(mfaToken, JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ error: 'Invalid or expired mfaToken' });
    }

    if (decoded.type !== 'mfa_pending') {
      return res.status(401).json({ error: 'Token is not mfa_pending type' });
    }

    const { userId, tenantSlug, email, name, role, candidateId, clientId, tenantName, mustChangePw } = decoded;

    // ── Get user's MFA data ───────────────────────────────────────────────────
    let mfaSecret, backupCodes, isSuperAdmin;

    if (role === 'super_admin') {
      const saResult = await masterDb.query(
        'SELECT mfa_secret, mfa_backup_codes FROM super_admins WHERE id = $1',
        [userId]
      );
      const sa = saResult.rows[0];
      if (!sa) return res.status(401).json({ error: 'User not found' });
      mfaSecret = sa.mfa_secret;
      backupCodes = sa.mfa_backup_codes || [];
      isSuperAdmin = true;
    } else {
      const { wrapper: tenantDb, release: tenantRelease } = await getTenantDb(tenantSlug);
      try {
        const userResult = await tenantDb.query(
          'SELECT mfa_secret, mfa_backup_codes FROM users WHERE id = $1',
          [userId]
        );
        const user = userResult.rows[0];
        if (!user) return res.status(401).json({ error: 'User not found' });
        mfaSecret = user.mfa_secret;
        backupCodes = user.mfa_backup_codes || [];
        isSuperAdmin = false;
      } finally {
        tenantRelease();
      }
    }

    if (!mfaSecret) {
      return res.status(401).json({ error: 'MFA not enabled for this user' });
    }

    // ── Try TOTP first ───────────────────────────────────────────────────────
    const totpValid = speakeasy.totp.verify({
      secret: mfaSecret,
      encoding: 'base32',
      token: code.trim(),
      window: 2,
    });

    if (totpValid) {
      // TOTP verified, issue full JWT
      const token = jwt.sign(
        { id: userId, email, name, role, candidateId, clientId, tenantSlug, tenantName, mustChangePw },
        JWT_SECRET,
        { expiresIn: '8h' }
      );

      res.cookie(COOKIE_NAME, token, cookieOptions());
      return res.json({
        token,
        user: { id: userId, name, email, role, candidateId, clientId, tenantSlug, tenantName, mustChangePw },
      });
    }

    // ── Try backup codes ──────────────────────────────────────────────────────
    let backupCodeMatched = false;
    let matchedIndex = -1;

    for (let i = 0; i < backupCodes.length; i++) {
      const hashedCode = backupCodes[i];
      const match = await bcrypt.compare(code.trim().toUpperCase(), hashedCode);
      if (match) {
        backupCodeMatched = true;
        matchedIndex = i;
        break;
      }
    }

    if (backupCodeMatched) {
      // Remove the used backup code
      const updatedBackupCodes = backupCodes.filter((_, idx) => idx !== matchedIndex);

      if (isSuperAdmin) {
        await masterDb.query(
          'UPDATE super_admins SET mfa_backup_codes = $1 WHERE id = $2',
          [JSON.stringify(updatedBackupCodes), userId]
        );
      } else {
        const { wrapper: tenantDb, release: tenantRelease } = await getTenantDb(tenantSlug);
        try {
          await tenantDb.query(
            'UPDATE users SET mfa_backup_codes = $1 WHERE id = $2',
            [JSON.stringify(updatedBackupCodes), userId]
          );
        } finally {
          tenantRelease();
        }
      }

      // Issue full JWT
      const token = jwt.sign(
        { id: userId, email, name, role, candidateId, clientId, tenantSlug, tenantName, mustChangePw },
        JWT_SECRET,
        { expiresIn: '8h' }
      );

      res.cookie(COOKIE_NAME, token, cookieOptions());
      return res.json({
        token,
        user: { id: userId, name, email, role, candidateId, clientId, tenantSlug, tenantName, mustChangePw },
      });
    }

    // Neither TOTP nor backup code matched
    return res.status(401).json({ error: 'Invalid MFA code' });
  } catch (err) {
    console.error('[MFA /verify] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /status — authenticated
// ──────────────────────────────────────────────────────────────────────────────
router.get('/status', authenticate, injectTenantDb, async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;

    if (role === 'super_admin') {
      const saResult = await masterDb.query(
        'SELECT mfa_enabled, mfa_backup_codes FROM super_admins WHERE id = $1',
        [userId]
      );
      const sa = saResult.rows[0];
      if (!sa) return res.status(404).json({ error: 'User not found' });

      const backupCodes = sa.mfa_backup_codes || [];
      return res.json({
        mfaEnabled: !!sa.mfa_enabled,
        backupCodesCount: backupCodes.length,
      });
    }

    const db = req.db;
    const userResult = await db.query(
      'SELECT mfa_enabled, mfa_backup_codes FROM users WHERE id = $1',
      [userId]
    );
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const backupCodes = user.mfa_backup_codes || [];
    res.json({
      mfaEnabled: !!user.mfa_enabled,
      backupCodesCount: backupCodes.length,
    });
  } catch (err) {
    console.error('[MFA /status] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /setup — authenticated
// ──────────────────────────────────────────────────────────────────────────────
router.post('/setup', authenticate, injectTenantDb, async (req, res) => {
  try {
    const userId = req.user.id;
    const email = req.user.email;
    const role = req.user.role;

    // Generate TOTP secret
    const secret = speakeasy.generateSecret({
      name: `Flow (${email})`,
      issuer: 'Flow',
      length: 20,
    });

    // Store base32 secret in DB (mfa_enabled still FALSE)
    if (role === 'super_admin') {
      await masterDb.query(
        'UPDATE super_admins SET mfa_secret = $1, mfa_enabled = FALSE WHERE id = $2',
        [secret.base32, userId]
      );
    } else {
      const db = req.db;
      await db.query(
        'UPDATE users SET mfa_secret = $1, mfa_enabled = FALSE WHERE id = $2',
        [secret.base32, userId]
      );
    }

    // Generate QR code
    const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url);

    res.json({
      secret: secret.base32,
      qrCodeDataUrl,
      otpauthUrl: secret.otpauth_url,
    });
  } catch (err) {
    console.error('[MFA /setup] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /confirm — authenticated
// Body: { code }
// ──────────────────────────────────────────────────────────────────────────────
router.post('/confirm', authenticate, injectTenantDb, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'code required' });
    }

    const userId = req.user.id;
    const role = req.user.role;

    // Get stored secret from DB
    let mfaSecret;

    if (role === 'super_admin') {
      const saResult = await masterDb.query(
        'SELECT mfa_secret FROM super_admins WHERE id = $1',
        [userId]
      );
      const sa = saResult.rows[0];
      if (!sa || !sa.mfa_secret) {
        return res.status(400).json({ error: 'MFA setup not found, please run setup first' });
      }
      mfaSecret = sa.mfa_secret;
    } else {
      const db = req.db;
      const userResult = await db.query(
        'SELECT mfa_secret FROM users WHERE id = $1',
        [userId]
      );
      const user = userResult.rows[0];
      if (!user || !user.mfa_secret) {
        return res.status(400).json({ error: 'MFA setup not found, please run setup first' });
      }
      mfaSecret = user.mfa_secret;
    }

    // Verify TOTP code
    const totpValid = speakeasy.totp.verify({
      secret: mfaSecret,
      encoding: 'base32',
      token: code.trim(),
      window: 2,
    });

    if (!totpValid) {
      return res.status(401).json({ error: 'Invalid TOTP code' });
    }

    // Generate 10 backup codes
    const plainBackupCodes = generateBackupCodes();
    const hashedBackupCodes = await hashBackupCodes(plainBackupCodes);

    // Update DB: mfa_enabled = TRUE, store hashed backup codes
    if (role === 'super_admin') {
      await masterDb.query(
        'UPDATE super_admins SET mfa_enabled = TRUE, mfa_backup_codes = $1 WHERE id = $2',
        [JSON.stringify(hashedBackupCodes), userId]
      );
    } else {
      const db = req.db;
      await db.query(
        'UPDATE users SET mfa_enabled = TRUE, mfa_backup_codes = $1 WHERE id = $2',
        [JSON.stringify(hashedBackupCodes), userId]
      );
    }

    res.json({
      message: 'MFA enabled successfully',
      backupCodes: plainBackupCodes,
    });
  } catch (err) {
    console.error('[MFA /confirm] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /disable — authenticated
// Body: { code?, password? }
// ──────────────────────────────────────────────────────────────────────────────
router.delete('/disable', authenticate, injectTenantDb, async (req, res) => {
  try {
    const { code, password } = req.body;
    if (!code && !password) {
      return res.status(400).json({ error: 'Either code or password required' });
    }

    const userId = req.user.id;
    const role = req.user.role;

    if (role === 'super_admin') {
      const saResult = await masterDb.query(
        'SELECT password_hash, mfa_secret FROM super_admins WHERE id = $1',
        [userId]
      );
      const sa = saResult.rows[0];
      if (!sa) return res.status(404).json({ error: 'User not found' });

      // Validate either code (TOTP) or password
      let valid = false;

      if (code) {
        if (!sa.mfa_secret) {
          return res.status(400).json({ error: 'MFA not enabled' });
        }
        valid = speakeasy.totp.verify({
          secret: sa.mfa_secret,
          encoding: 'base32',
          token: code.trim(),
          window: 2,
        });
      } else if (password) {
        valid = bcrypt.compareSync(password, sa.password_hash);
      }

      if (!valid) {
        return res.status(401).json({ error: 'Invalid code or password' });
      }

      // Disable MFA
      await masterDb.query(
        'UPDATE super_admins SET mfa_enabled = FALSE, mfa_secret = NULL, mfa_backup_codes = NULL WHERE id = $1',
        [userId]
      );

      return res.json({ message: 'MFA disabled' });
    }

    // Tenant user
    const db = req.db;
    const userResult = await db.query(
      'SELECT password_hash, mfa_secret FROM users WHERE id = $1',
      [userId]
    );
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    let valid = false;

    if (code) {
      if (!user.mfa_secret) {
        return res.status(400).json({ error: 'MFA not enabled' });
      }
      valid = speakeasy.totp.verify({
        secret: user.mfa_secret,
        encoding: 'base32',
        token: code.trim(),
        window: 2,
      });
    } else if (password) {
      valid = bcrypt.compareSync(password, user.password_hash);
    }

    if (!valid) {
      return res.status(401).json({ error: 'Invalid code or password' });
    }

    // Disable MFA
    await db.query(
      'UPDATE users SET mfa_enabled = FALSE, mfa_secret = NULL, mfa_backup_codes = NULL WHERE id = $1',
      [userId]
    );

    res.json({ message: 'MFA disabled' });
  } catch (err) {
    console.error('[MFA /disable] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

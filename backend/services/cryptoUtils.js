/**
 * AES-256-GCM encryption helpers for sensitive fields stored in SQLite.
 *
 * Usage:
 *   Set ENCRYPTION_KEY env var to a 64-char hex string (32 bytes):
 *     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * If ENCRYPTION_KEY is not set the helpers fall back to identity (no-op),
 * logging a loud startup warning. Set the key before production deployment.
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const KEY_HEX = process.env.ENCRYPTION_KEY;

let KEY_BUF = null;

if (KEY_HEX) {
  if (KEY_HEX.length !== 64) {
    console.error('[CRYPTO] ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Encryption disabled.');
  } else {
    try {
      KEY_BUF = Buffer.from(KEY_HEX, 'hex');
    } catch {
      console.error('[CRYPTO] ENCRYPTION_KEY is not valid hex. Encryption disabled.');
    }
  }
} else {
  console.warn('\n⚠️  WARNING: ENCRYPTION_KEY not set — sensitive fields (IMAP password) stored in plaintext.');
  console.warn('   Generate a key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  console.warn('   Then add ENCRYPTION_KEY=<value> to your .env file.\n');
}

const SEPARATOR = ':';  // iv:tag:ciphertext (all hex)

/**
 * Encrypt a plaintext string.
 * Returns a "<iv_hex>:<tag_hex>:<ciphertext_hex>" string, or the original
 * plaintext if no key is configured (graceful degradation).
 */
function encrypt(plaintext) {
  if (!KEY_BUF || !plaintext) return plaintext;

  const iv     = crypto.randomBytes(12);          // 96-bit IV for GCM
  const cipher = crypto.createCipheriv(ALGO, KEY_BUF, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();

  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(SEPARATOR);
}

/**
 * Decrypt a string produced by encrypt().
 * Returns the original plaintext, or the input unchanged if it is not in the
 * expected format (handles legacy plaintext passwords stored before encryption
 * was introduced).
 */
function decrypt(stored) {
  if (!KEY_BUF || !stored) return stored;

  const parts = stored.split(SEPARATOR);
  if (parts.length !== 3) {
    // Not an encrypted value — return as-is (handles legacy plaintext)
    return stored;
  }

  try {
    const [ivHex, tagHex, ctHex] = parts;
    const iv      = Buffer.from(ivHex, 'hex');
    const tag     = Buffer.from(tagHex, 'hex');
    const ct      = Buffer.from(ctHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGO, KEY_BUF, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (err) {
    console.error('[CRYPTO] Decryption failed:', err.message);
    return stored;   // Return stored value rather than crashing
  }
}

/** True if encryption is active (key is configured and valid). */
const isEncryptionEnabled = () => KEY_BUF !== null;

module.exports = { encrypt, decrypt, isEncryptionEnabled };

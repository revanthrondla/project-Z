/**
 * Jest global setup — runs before each test FILE (setupFiles).
 * Sets environment variables so modules read them on first require().
 */
process.env.NODE_ENV      = 'test';
process.env.JWT_SECRET    = 'test-jwt-secret-hireiq-do-not-use-in-prod';
process.env.ENCRYPTION_KEY = '0'.repeat(64);  // Valid but dummy 32-byte key for tests

/**
 * HireIQ — PostgreSQL connection pool singleton
 *
 * All database access goes through this pool. The pool is created once at
 * process startup and shared across all requests.
 *
 * Required env var:
 *   DATABASE_URL  — PostgreSQL connection string
 *                   e.g. postgresql://user:pass@host:5432/dbname
 *                   Railway provides this automatically when you add the
 *                   PostgreSQL plugin.
 */
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('[FATAL] DATABASE_URL environment variable is not set.');
  console.error('        Add a PostgreSQL service in Railway and it will be set automatically.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway PostgreSQL requires SSL in production
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  // Connection pool settings
  max: 20,                  // maximum pool size
  idleTimeoutMillis: 30000, // close idle connections after 30s
  connectionTimeoutMillis: 5000, // error if no connection available in 5s
});

// Log pool errors so they surface in Railway logs
pool.on('error', (err) => {
  console.error('[pg pool] Unexpected error on idle client', err.message);
});

module.exports = pool;

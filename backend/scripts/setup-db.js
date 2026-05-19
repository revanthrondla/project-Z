/**
 * HireIQ — One-shot database setup script
 *
 * Run this to manually create all master + tenant tables and run all migrations.
 * Safe to run multiple times — all operations are idempotent.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." node scripts/setup-db.js
 *
 *   Or in Railway — add a one-off job / run via the Railway CLI:
 *   railway run node backend/scripts/setup-db.js
 */

'use strict';

require('dotenv').config();

if (!process.env.DATABASE_URL) {
  console.error('[FATAL] DATABASE_URL is not set.');
  process.exit(1);
}

// Force non-production so seedSuperAdmin doesn't call process.exit(1)
// when SUPER_ADMIN_EMAIL is missing — we handle super-admin separately below
const originalEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'setup';

async function main() {
  console.log('🔧 HireIQ Database Setup');
  console.log('   DATABASE_URL:', process.env.DATABASE_URL.replace(/:([^@]+)@/, ':***@'));
  console.log('');

  // ── Step 1: Master schema + tables ───────────────────────────────────────
  console.log('Step 1/3 — Initialising master schema…');
  try {
    // Temporarily override process.exit so seedSuperAdmin can't kill us
    const realExit = process.exit.bind(process);
    process.exit = (code) => {
      if (code === 1) {
        // swallow the exit — we'll handle super-admin below
        console.warn('  ⚠️  Super-admin seed skipped (set SUPER_ADMIN_EMAIL + SUPER_ADMIN_PASSWORD env vars in Railway)');
      } else {
        realExit(code);
      }
    };

    const { initMaster } = require('../masterDatabase');
    await initMaster();

    process.exit = realExit; // restore
    console.log('  ✅ Master schema ready');
  } catch (err) {
    console.error('  ❌ Master init failed:', err.message);
    process.exit(1);
  }

  // ── Step 2: Run all migrations ────────────────────────────────────────────
  console.log('Step 2/3 — Running migrations…');
  try {
    const { runAllMigrations } = require('../migrate');
    await runAllMigrations();
    console.log('  ✅ All migrations complete');
  } catch (err) {
    console.error('  ❌ Migration failed:', err.message);
    process.exit(1);
  }

  // ── Step 3: Seed super-admin if env vars provided ─────────────────────────
  console.log('Step 3/3 — Seeding super-admin…');
  const email    = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (email && password) {
    try {
      const bcrypt    = require('bcryptjs');
      const { masterDb } = require('../masterDatabase');
      const hash = await bcrypt.hash(password, 10);
      await masterDb.prepare(`
        INSERT INTO super_admins (name, email, password_hash)
        VALUES ($1, $2, $3)
        ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
      `).run('Super Admin', email.toLowerCase().trim(), hash);
      console.log(`  ✅ Super-admin upserted: ${email}`);
    } catch (err) {
      console.error('  ❌ Super-admin seed failed:', err.message);
    }
  } else {
    console.warn('  ⚠️  SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD not set — skipping super-admin seed');
    console.warn('      Set these env vars and re-run to create the super-admin account');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('');
  console.log('✅ Database setup complete!');
  console.log('');

  // List what schemas exist now
  try {
    const pool = require('../db/pool');
    const { rows } = await pool.query(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name = 'master' OR schema_name LIKE 'tenant_%'
      ORDER BY schema_name
    `);
    console.log('Schemas created:');
    rows.forEach(r => console.log(`  • ${r.schema_name}`));

    // Count tables in master
    const { rows: masterTables } = await pool.query(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.tables
      WHERE table_schema = 'master'
    `);
    console.log(`\nMaster schema: ${masterTables[0].cnt} tables`);

    // Count tables in each tenant schema
    for (const row of rows.filter(r => r.schema_name.startsWith('tenant_'))) {
      const { rows: tenantTables } = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.tables
        WHERE table_schema = $1
      `, [row.schema_name]);
      console.log(`${row.schema_name}: ${tenantTables[0].cnt} tables`);
    }

    await pool.end();
  } catch (err) {
    console.error('Could not list schemas:', err.message);
  }
}

main().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});

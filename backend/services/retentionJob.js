/**
 * Data Retention Enforcement Job — SOC 2 CC9.1 / A1.2
 *
 * Runs nightly and enforces configurable retention policies:
 *   1. Purge expired token_revocations from master (they can't be replayed anyway
 *      once the JWT expiry passes, so no security impact — just housekeeping).
 *   2. Purge security_audit_logs older than AUDIT_LOG_RETENTION_DAYS (default 365).
 *   3. Prune password_history beyond 5 entries per user in every active tenant schema.
 *
 * Configuration via env vars:
 *   AUDIT_LOG_RETENTION_DAYS  — how long to keep security_audit_logs (default 365)
 *   DATA_RETENTION_ENABLED    — set to 'false' to disable (default enabled)
 */

const cron = require('node-cron');

const AUDIT_RETENTION_DAYS = parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '365', 10);
const ENABLED = process.env.DATA_RETENTION_ENABLED !== 'false';

async function runRetentionJob() {
  const { masterDb, purgeExpiredRevocations } = require('../masterDatabase');

  const started = new Date().toISOString();
  const results = [];

  try {
    // 1. Purge expired token_revocations
    const revokeResult = await purgeExpiredRevocations();
    results.push({ task: 'token_revocations', ...revokeResult });
  } catch (e) {
    results.push({ task: 'token_revocations', error: e.message });
    console.error('[retention] token_revocations purge failed:', e.message);
  }

  try {
    // 2. Purge old security_audit_logs
    const auditResult = await masterDb.query(
      `DELETE FROM security_audit_logs
       WHERE changed_at < NOW() - INTERVAL '${AUDIT_RETENTION_DAYS} days'`
    );
    results.push({ task: 'security_audit_logs', deleted: auditResult.rowCount });
    console.log(`[retention] security_audit_logs: removed ${auditResult.rowCount} rows older than ${AUDIT_RETENTION_DAYS} days`);
  } catch (e) {
    results.push({ task: 'security_audit_logs', error: e.message });
    console.error('[retention] security_audit_logs purge failed:', e.message);
  }

  try {
    // 3. Prune password_history beyond 5 per user across all active tenant schemas
    const tenantsResult = await masterDb.query(
      "SELECT slug FROM tenants WHERE status = 'active'"
    );

    let totalPruned = 0;
    for (const { slug } of tenantsResult.rows) {
      try {
        const pool = require('../db/pool');
        const client = await pool.connect();
        try {
          await client.query(`SET search_path TO "tenant_${slug}", public`);
          const pruneResult = await client.query(`
            DELETE FROM password_history
            WHERE id IN (
              SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
                FROM password_history
              ) ranked
              WHERE rn > 5
            )
          `);
          totalPruned += pruneResult.rowCount;
        } finally {
          client.release();
        }
      } catch (e) {
        console.warn(`[retention] password_history prune failed for tenant ${slug}:`, e.message);
      }
    }
    results.push({ task: 'password_history', deleted: totalPruned });
    console.log(`[retention] password_history: pruned ${totalPruned} excess entries across ${tenantsResult.rows.length} tenants`);
  } catch (e) {
    results.push({ task: 'password_history', error: e.message });
    console.error('[retention] password_history purge failed:', e.message);
  }

  // Write a summary audit entry so we have a record of the job running
  try {
    const { writeSecurityAuditLog } = require('../masterDatabase');
    await writeSecurityAuditLog({
      tenantSlug:  null,
      tableName:   'retention_job',
      recordId:    null,
      action:      'purge',
      changedBy:   null,
      oldValues:   null,
      newValues:   { started, results },
      ipAddress:   '127.0.0.1',
      userAgent:   'retention-job/1.0',
    });
  } catch {}

  return results;
}

/**
 * Start the nightly retention cron job.
 * Call this once from server.js after the DB is initialised.
 */
function startRetentionJob() {
  if (!ENABLED) {
    console.log('[retention] Data retention job is disabled (DATA_RETENTION_ENABLED=false)');
    return;
  }

  // Run at 02:00 every night
  cron.schedule('0 2 * * *', async () => {
    console.log('[retention] Starting nightly data retention run…');
    try {
      const results = await runRetentionJob();
      console.log('[retention] Completed:', JSON.stringify(results));
    } catch (e) {
      console.error('[retention] Unexpected error:', e.message);
    }
  });

  console.log(`[retention] Nightly job scheduled (02:00). Audit log retention: ${AUDIT_RETENTION_DAYS} days.`);
}

module.exports = { startRetentionJob, runRetentionJob };

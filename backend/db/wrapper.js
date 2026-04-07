/**
 * HireIQ — Async PostgreSQL wrapper
 *
 * Provides a familiar prepare().get / .all / .run interface over pg,
 * so route code needs minimal changes from the SQLite version.
 *
 * Key behaviours:
 *  - SQLite `?` placeholders are auto-converted to pg `$1, $2, ...`
 *  - `run()` on INSERT statements automatically appends `RETURNING id`
 *    and exposes the result as `{ lastInsertRowid, changes }`
 *  - `transaction(fn)` checks out a dedicated client, wraps fn in
 *    BEGIN/COMMIT/ROLLBACK, and passes a scoped wrapper to fn
 *  - Schema is set via `SET search_path` so all unqualified table
 *    references resolve to the correct tenant schema
 */

/**
 * Convert SQLite `?` positional params to PostgreSQL `$1, $2, ...`
 * Handles quoted strings (won't replace ? inside quotes).
 */
function toPostgresParams(sql) {
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let result = '';

  for (let c = 0; c < sql.length; c++) {
    const ch = sql[c];
    if (ch === "'" && !inDouble) { inSingle = !inSingle; result += ch; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; result += ch; continue; }
    if (ch === '?' && !inSingle && !inDouble) {
      result += `$${++i}`;
      continue;
    }
    result += ch;
  }
  return result;
}

/** True if the (whitespace-trimmed, uppercase) SQL is an INSERT statement */
function isInsert(sql) {
  return /^\s*INSERT\s/i.test(sql);
}

/**
 * Create a db wrapper around a pg client (or pool).
 *
 * @param {import('pg').PoolClient | import('pg').Pool} client
 * @param {string} schema  - PostgreSQL schema name to set as search_path
 */
function createWrapper(client, schema) {
  /**
   * Execute a query against the client, setting search_path first if needed.
   * Returns the full pg QueryResult.
   */
  async function query(sql, params = []) {
    const pgSql = toPostgresParams(sql);
    return client.query(pgSql, params);
  }

  function prepare(sql) {
    return {
      /**
       * Return the first row, or undefined if no results.
       * Mirrors SQLite's `.get()`.
       */
      async get(...args) {
        const params = args.flat();
        const result = await query(sql, params);
        return result.rows[0] ?? null;
      },

      /**
       * Return all rows as an array.
       * Mirrors SQLite's `.all()`.
       */
      async all(...args) {
        const params = args.flat();
        const result = await query(sql, params);
        return result.rows;
      },

      /**
       * Execute a mutating query (INSERT / UPDATE / DELETE).
       * For INSERTs, automatically appends `RETURNING id` and exposes
       * `result.lastInsertRowid` so existing route code needs no changes.
       *
       * Returns: { lastInsertRowid, changes }
       */
      async run(...args) {
        const params = args.flat();
        let execSql = sql;

        // Auto-append RETURNING id on INSERT if not already present
        if (isInsert(execSql) && !/RETURNING/i.test(execSql)) {
          execSql = execSql.trimEnd().replace(/;?\s*$/, '') + ' RETURNING id';
        }

        const result = await query(execSql, params);
        return {
          lastInsertRowid: result.rows[0]?.id ?? null,
          changes: result.rowCount,
        };
      },
    };
  }

  /**
   * Execute raw SQL (no params).
   * Mirrors SQLite's `.exec()`.
   */
  async function exec(sql) {
    return client.query(sql);
  }

  /**
   * Run a function inside a BEGIN / COMMIT / ROLLBACK transaction.
   * A scoped wrapper (using the same client) is passed to the callback.
   *
   * Usage:
   *   const id = await db.transaction(async (tx) => {
   *     const r = await tx.prepare('INSERT ...').run(a, b);
   *     await tx.prepare('INSERT ...').run(r.lastInsertRowid, c);
   *     return r.lastInsertRowid;
   *   });
   */
  async function transaction(fn) {
    // If the client is a Pool (top-level), check out a dedicated client
    // for the duration of the transaction.
    const isPool = typeof client.connect === 'function' && typeof client.query === 'function' && client.constructor.name === 'Pool';

    if (isPool) {
      const txClient = await client.connect();
      // Set search_path on the dedicated transaction client
      if (schema) await txClient.query(`SET search_path TO "${schema}"`);
      const txWrapper = createWrapper(txClient, null); // search_path already set
      try {
        await txClient.query('BEGIN');
        const result = await fn(txWrapper);
        await txClient.query('COMMIT');
        return result;
      } catch (err) {
        await txClient.query('ROLLBACK');
        throw err;
      } finally {
        txClient.release();
      }
    } else {
      // Already on a dedicated client (nested transaction — use savepoint)
      const savepoint = `sp_${Date.now()}`;
      const txWrapper = createWrapper(client, null);
      await client.query(`SAVEPOINT ${savepoint}`);
      try {
        const result = await fn(txWrapper);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        throw err;
      }
    }
  }

  return { prepare, exec, transaction, _client: client };
}

/**
 * Create a request-scoped wrapper that:
 *  1. Checks out a pg client from the pool
 *  2. Sets search_path to the tenant's schema
 *  3. Returns the wrapper + a release() function to call when done
 *
 * @param {import('pg').Pool} pool
 * @param {string} schema  - e.g. 'tenant_hireiq' or 'master'
 */
async function createScopedWrapper(pool, schema) {
  const client = await pool.connect();
  await client.query(`SET search_path TO "${schema}", public`);
  const wrapper = createWrapper(client, schema);

  function release() {
    try { client.release(); } catch { /* ignore double-release */ }
  }

  return { wrapper, release };
}

module.exports = { createWrapper, createScopedWrapper, toPostgresParams };

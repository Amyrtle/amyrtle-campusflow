import pg from 'pg';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { HttpError } from './security.js';
import { queryIds } from './query-catalog.js';

export const projectRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}
export interface Sql {
  query<T = Record<string, any>>(sql: string, values?: unknown[]): Promise<QueryResult<T>>;
}
export interface Database extends Sql {
  kind: 'pglite' | 'postgres' | 'cloudbase-http';
  mutate<T = Record<string, unknown>>(
    operation: string,
    input: Record<string, unknown>,
  ): Promise<T>;
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  execute(sql: string): Promise<void>;
  close(): Promise<void>;
}

function databaseError(value: unknown): Error {
  const error = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const business =
    typeof error.message === 'string' ? /^CF:([A-Z_]+)(?::(\{.*\}))?$/s.exec(error.message) : null;
  if (business) {
    try {
      const detail = JSON.parse(String(business[2] ?? error.details ?? error.detail ?? '{}')) as {
        status?: number;
        message?: string;
      };
      if (
        detail.status &&
        [400, 401, 403, 404, 409, 422, 429].includes(detail.status) &&
        typeof detail.message === 'string'
      )
        return new HttpError(detail.status, business[1], detail.message.slice(0, 500));
    } catch {
      /* Malformed upstream error details are never returned to clients. */
    }
  }
  const safe = new Error('Database operation failed') as Error & { code?: string };
  if (typeof error.code === 'string' && /^[A-Z0-9_]{3,40}$/.test(error.code))
    safe.code = error.code.replace(/^DATABASE_/, '');
  return safe;
}

export async function createDatabase(
  options: { dataDir?: string; databaseUrl?: string; migrate?: boolean } = {},
): Promise<Database> {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  let db: Database;
  const localMutation = async <T>(
    operation: string,
    input: Record<string, unknown>,
  ): Promise<T> => {
    try {
      return await db.transaction(async (tx) => {
        await tx.query("SELECT set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ role: 'service_role' }),
        ]);
        const result = await tx.query<{ result: T }>(
          'SELECT public.campusflow_mutate($1,$2::jsonb) AS result',
          [operation, JSON.stringify(input)],
        );
        return result.rows[0].result;
      });
    } catch (error) {
      throw databaseError(error);
    }
  };
  if (process.env.DATABASE_MODE === 'cloudbase-http' && !options.databaseUrl) {
    const envId = process.env.CLOUDBASE_ENV_ID;
    const apiKey = process.env.CLOUDBASE_DATABASE_API_KEY;
    if (!envId || !/^[a-z0-9-]+$/.test(envId) || !apiKey)
      throw new Error('CloudBase database requires a valid environment and server API key');
    if (options.migrate) throw new Error('CloudBase HTTP migrations must use the management tools');
    const rpc = async <T>(name: string, body: Record<string, unknown>): Promise<T> => {
      let response: Response;
      try {
        response = await fetch(
          `https://${envId}.api.tcloudbasegateway.com/v1/rdb/rest/rpc/${name}`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(20000),
            redirect: 'error',
          },
        );
      } catch {
        throw new Error('Database gateway unavailable');
      }
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new Error('Invalid database gateway response');
      }
      if (!response.ok) {
        if (JSON.stringify(data).includes(apiKey)) throw new Error('Database operation failed');
        throw databaseError(data);
      }
      return data as T;
    };
    db = {
      kind: 'cloudbase-http',
      async query<T>(sql: string, values: unknown[] = []) {
        const id = createHash('sha256').update(sql.trim()).digest('hex');
        if (!queryIds.has(id)) throw new Error('Query is not in the deployed server allowlist');
        const result = await rpc<QueryResult<T>>('campusflow_query', {
          p_id: id,
          p_params: values,
        });
        if (!result || !Array.isArray(result.rows) || !Number.isInteger(result.rowCount))
          throw new Error('Invalid database query result');
        return result;
      },
      mutate: (operation, input) =>
        rpc('campusflow_mutate', { p_operation: operation, p_input: input }),
      async transaction() {
        throw new Error('CloudBase HTTP transactions require a named business RPC');
      },
      async execute() {
        throw new Error('Runtime SQL execution is disabled; use management migrations');
      },
      async close() {},
    };
    return db;
  } else if (databaseUrl) {
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5000,
      max: 12,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
    });
    const query = async <T = Record<string, any>>(
      sql: string,
      values: unknown[] = [],
    ): Promise<QueryResult<T>> => {
      const result = await pool.query(sql, values);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
    };
    db = {
      kind: 'postgres',
      query,
      mutate: localMutation,
      async execute(sql) {
        await pool.query(sql);
      },
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn({
            async query<T>(sql: string, values: unknown[] = []) {
              const r = await client.query(sql, values);
              return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
            },
          });
          await client.query('COMMIT');
          return result;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      },
      async close() {
        await pool.end();
      },
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir =
      options.dataDir === 'memory://'
        ? undefined
        : (options.dataDir ?? resolve(projectRoot, '.data/postgres'));
    if (dir) await mkdir(dir, { recursive: true });
    const lite = new PGlite(dir);
    await lite.waitReady;
    let pending: Promise<unknown> = Promise.resolve();
    const serial = <T>(fn: () => Promise<T>): Promise<T> => {
      const task = pending.then(fn, fn);
      pending = task.catch(() => undefined);
      return task;
    };
    const direct: Sql = {
      async query<T>(sql: string, values: unknown[] = []) {
        const r = await lite.query(sql, values);
        return { rows: r.rows as T[], rowCount: r.affectedRows ?? r.rows.length };
      },
    };
    db = {
      kind: 'pglite',
      mutate: localMutation,
      query: (sql, values) => serial(() => direct.query(sql, values)),
      execute: (sql) =>
        serial(async () => {
          await lite.exec(sql);
        }),
      transaction: (fn) =>
        serial(async () => {
          await lite.exec('BEGIN');
          try {
            const result = await fn(direct);
            await lite.exec('COMMIT');
            return result;
          } catch (e) {
            await lite.exec('ROLLBACK');
            throw e;
          }
        }),
      close: () => serial(() => lite.close()),
    };
  }
  if (options.migrate ?? process.env.NODE_ENV !== 'production') {
    const schema = await readFile(
      resolve(projectRoot, 'cloudbase/migrations/20261025000000_schema.sql'),
      'utf8',
    );
    await db.execute(schema);
    if (db.kind === 'pglite')
      await db.execute(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claims',true),'')::jsonb->>'role'
      $$;
    `);
    for (const file of [
      '20261026000000_rpc.sql',
      '20261026000001_query_catalog.sql',
      '20261026000002_rpc_errors.sql',
    ]) {
      await db.execute(await readFile(resolve(projectRoot, 'cloudbase/migrations', file), 'utf8'));
    }
  }
  return db;
}

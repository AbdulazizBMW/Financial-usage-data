import pg from 'pg';
import { SCHEMA_SQL } from './schema.js';

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  kind: 'postgres' | 'pglite';
  durable: boolean;
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class PostgresDb implements Db {
  kind = 'postgres' as const;
  durable = true;
  constructor(private pool: pg.Pool) {}

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    const res = await this.pool.query(sql, params as never[]);
    return { rows: res.rows as T[] };
  }

  async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn({
        query: async <R = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
          const res = await client.query(sql, params as never[]);
          return { rows: res.rows as R[] };
        }
      });
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore rollback failure */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

class PgliteDb implements Db {
  kind = 'pglite' as const;
  durable = false;
  private lock: Promise<unknown> = Promise.resolve();
  constructor(private db: any) {}

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    const res = await this.db.query(sql, params);
    return { rows: (res?.rows ?? []) as T[] };
  }

  async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const run = async () => {
      let output: T | undefined;
      await this.db.transaction(async (tx: any) => {
        output = await fn({
          query: async <R = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
            const res = await tx.query(sql, params);
            return { rows: (res?.rows ?? []) as R[] };
          }
        });
      });
      return output as T;
    };
    const next = this.lock.then(run, run);
    this.lock = next.catch(() => undefined);
    return next;
  }

  async close() {
    await this.db.close();
  }
}

let dbPromise: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  if (!dbPromise) dbPromise = initDb();
  return dbPromise;
}

async function initDb(): Promise<Db> {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    const needsSsl = /sslmode=(require|verify)/.test(url) || !/@(localhost|127\.0\.0\.1)/.test(url);
    const pool = new pg.Pool({
      connectionString: url,
      max: Number(process.env.PGPOOL_MAX || 6),
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 15000
    });
    pool.on('error', (err) => console.error('[db] idle client error:', err.message));
    const db = new PostgresDb(pool);
    await migrate(db);
    return db;
  }

  // Fallback: embedded PostgreSQL (PGlite). Used for local development/tests and
  // whenever DATABASE_URL has not been configured yet. Storage lives on the
  // container filesystem, which is NOT durable across deployments.
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR || 'pgdata';
  const instance = await PGlite.create({ dataDir: dir });
  const db = new PgliteDb(instance);
  await migrate(db);
  return db;
}

async function migrate(db: Db) {
  if (db.kind === 'postgres') {
    await db.query(SCHEMA_SQL);
  } else {
    // PGlite executes multi-statement scripts through exec().
    const anyDb = db as unknown as { db: { exec: (sql: string) => Promise<unknown> } };
    await anyDb.db.exec(SCHEMA_SQL);
  }
}

export async function closeDb() {
  if (dbPromise) {
    const db = await dbPromise;
    await db.close();
    dbPromise = null;
  }
}

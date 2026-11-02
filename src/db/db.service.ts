import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import type { AppConfig } from '../config/config';
import { APP_CONFIG } from '../common/tokens';

/** Anything that can run a parameterized query: the pool (autocommit) or a transaction client. Repositories take this.
 *  (A single object type — a `Pool | PoolClient` union is not callable because both declare overloaded generic `query`.) */
export type Queryable = Pick<PoolClient, 'query'>;

export function createPool(cfg: AppConfig['database']): Pool {
  const pool = new Pool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    ssl: cfg.ssl === false ? false : { ...cfg.ssl },
    max: cfg.poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    query_timeout: 20_000,
    application_name: 'hanq-api',
  });
  // Session-level statement timeout (works through Supabase's session pooler, which keeps one backend per client).
  pool.on('connect', (client) => {
    client.query('SET statement_timeout = 15000').catch(() => undefined);
  });
  return pool;
}

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly logger = new Logger('Db');
  readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = createPool(config.database);
    // Never log connection parameters; only the error class/code.
    this.pool.on('error', (err: Error & { code?: string }) => this.logger.error(`idle client error ${err.name}${err.code ? ' code=' + err.code : ''}`));
  }

  /** Runs fn inside one READ COMMITTED transaction. Row locks (SELECT … FOR UPDATE) inside fn serialize races.
   *  If fn throws, everything rolls back. */
  async tx<T>(fn: (q: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

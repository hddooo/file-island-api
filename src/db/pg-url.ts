/** Parses a database URL into discrete fields, in memory only (the normalized form is never stored or printed).
 *  Accepted forms:
 *   - postgres://user:password@host:port/db  and  postgresql://…
 *   - JDBC: jdbc:postgresql://host:port/db?user=…&password=…  (the form Supabase shows for Java). The `jdbc:` prefix
 *     is dropped; user/password come from the URI userinfo or from the `user`/`password` query fields. Query values
 *     are decoded with URLSearchParams semantics (as pgjdbc does): %40 → @, %26 → &, '+' → space.
 *  Ambiguity fails closed: a repeated user/password field, or userinfo and a query field that disagree.
 *  All other query parameters (sslmode, ssl, sslfactory, …) are ignored: TLS is configured only by HANQ_DB_SSL_MODE /
 *  HANQ_DB_CA_FILE, so a URL can never weaken verification. Errors never include the URL or any part of it. */
export interface ParsedDatabaseUrl {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export class DatabaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

function single(params: URLSearchParams, name: string): string | undefined {
  const all = params.getAll(name);
  if (all.length > 1) throw new DatabaseUrlError(`database URL repeats the ${name} field`);
  return all.length ? all[0] : undefined;
}

function pick(fromUserinfo: string, fromQuery: string | undefined, name: string): string {
  if (fromUserinfo && fromQuery !== undefined && fromQuery !== fromUserinfo) throw new DatabaseUrlError(`database URL gives two different ${name} values`);
  return fromUserinfo || fromQuery || '';
}

export function parseDatabaseUrl(raw: string): ParsedDatabaseUrl {
  let text = String(raw ?? '').trim();
  if (/^jdbc:/i.test(text)) text = text.slice(5);
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    throw new DatabaseUrlError('database URL is not a valid URL');
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new DatabaseUrlError('database URL must start with postgres://, postgresql:// or jdbc:postgresql://');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || host.includes(',')) throw new DatabaseUrlError('database URL must name exactly one host');
  const port = u.port ? Number(u.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new DatabaseUrlError('database URL has an invalid port');
  let infoUser: string, infoPassword: string, database: string;
  try {
    infoUser = decodeURIComponent(u.username);
    infoPassword = decodeURIComponent(u.password);
    database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  } catch {
    throw new DatabaseUrlError('database URL has invalid percent-encoding');
  }
  const q = u.searchParams;
  const user = pick(infoUser, single(q, 'user'), 'user');
  const password = pick(infoPassword, single(q, 'password'), 'password');
  if (!user) throw new DatabaseUrlError('database URL has no user');
  if (!database || database.includes('/')) throw new DatabaseUrlError('database URL has no database name');
  return { host, port, user, password, database };
}

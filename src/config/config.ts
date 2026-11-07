import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { isLoopbackHost, parseDatabaseUrl } from '../db/pg-url';
import { isSupabaseHost, SUPABASE_CA_FILE, supabaseCaPath, verifiedSupabaseCa } from '../db/supabase-ca';

export type NodeEnv = 'production' | 'development' | 'test';
export type PeriodPolicy = 'calendar-month' | 'fixed-days';
export type SameSite = 'strict' | 'lax' | 'none';

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** false only for a loopback host outside production. Otherwise TLS with certificate verification. */
  ssl: false | { rejectUnauthorized: true; ca?: string };
  poolMax: number;
}

export interface AppConfig {
  env: NodeEnv;
  port: number;
  database: DatabaseConfig;
  jwt: {
    issuer: string;
    accessSecret: Uint8Array;
    refreshSecret: Uint8Array;
    accessAudience: 'hanq-api';
    refreshAudience: 'hanq-refresh';
    accessTtlSec: number;
    refreshTtlSec: number;
    sessionMaxSec: number;
    rememberEnabled?: boolean;
  };
  cors: { origins: string[] };
  cookie: { name: string; path: string; sameSite: SameSite; secure: boolean };
  trustProxy: number;
  rateLimit: { perMinute: number; authPerMinute: number; loginFailuresPer15Min: number };
  /** testFreePassEnabled: one free 30-day pass per user for an announced test period (no payment). Allowed in production. */
  premium: { planId: 'premium-1m'; priceKRW: 5000; currency: 'KRW'; period: PeriodPolicy; fixedDays: number; testFreePassEnabled: boolean; developmentOpen?: boolean };
  payment: { provider: 'none' | 'test' };
  /** Private CBT question images (never under Git/public). null = not configured: CBT start and image routes answer 503.
   *  Optional so hand-built configs elsewhere keep compiling; loadConfig always sets it. */
  cbt?: { assetDir: string | null; manifestFile: string | null; publicAssetBaseUrl?: string | null };
  /** Non-fatal notes for development (never contain secret values). */
  textbook?: { dataDir: string | null; revisionsDir?: string | null };
  warnings: string[];
}

/** Configuration problems. Messages name the variable, never its value. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

function str(env: Env, key: string): string | undefined {
  const v = env[key];
  if (v == null) return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

function int(env: Env, key: string, def: number, min: number, max: number): number {
  const v = str(env, key);
  if (v === undefined) return def;
  if (!/^\d+$/.test(v)) throw new ConfigError(`${key} must be an integer`);
  const n = Number(v);
  if (n < min || n > max) throw new ConfigError(`${key} must be between ${min} and ${max}`);
  return n;
}

function oneOf<T extends string>(env: Env, key: string, allowed: readonly T[], def: T): T {
  const v = str(env, key);
  if (v === undefined) return def;
  if (!(allowed as readonly string[]).includes(v)) throw new ConfigError(`${key} must be one of: ${allowed.join(', ')}`);
  return v as T;
}

const PLACEHOLDER = /(change|replace|example|secret|password|placeholder|todo)/i;

/** Canonical HANQ_JWT_* name, with the originally advertised JWT_* name accepted only when the canonical one is empty.
 *  Both set to different values is a conflict (never silently prefer one). Messages contain names only. */
function secret(env: Env, key: string, legacyKey: string, nodeEnv: NodeEnv, warnings: string[]): Uint8Array {
  const canonical = str(env, key), legacy = str(env, legacyKey);
  if (canonical !== undefined && legacy !== undefined && canonical !== legacy) {
    throw new ConfigError(`${key} and ${legacyKey} are both set to different values; keep only ${key}`);
  }
  if (canonical === undefined && legacy !== undefined) warnings.push(`${legacyKey} is deprecated: rename it to ${key}`);
  const v = canonical ?? legacy;
  if (v === undefined) {
    if (nodeEnv === 'production') throw new ConfigError(`${key} is required in production`);
    warnings.push(`${key} not set: using an ephemeral random secret for this ${nodeEnv} process (tokens die on restart)`);
    return new Uint8Array(randomBytes(32));
  }
  if (v.length < 32 || /\s/.test(v)) throw new ConfigError(`${key} must be at least 32 non-whitespace characters`);
  if (new Set(v).size < 10 || PLACEHOLDER.test(v)) throw new ConfigError(`${key} looks like a placeholder; generate a random value`);
  return new TextEncoder().encode(v);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function origins(env: Env, nodeEnv: NodeEnv, warnings: string[]): string[] {
  const raw = str(env, 'HANQ_CORS_ORIGINS');
  if (raw === undefined) {
    if (nodeEnv === 'production') throw new ConfigError('HANQ_CORS_ORIGINS is required in production');
    warnings.push('HANQ_CORS_ORIGINS not set: no browser origin may call the API with credentials');
    return [];
  }
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) throw new ConfigError('HANQ_CORS_ORIGINS is empty');
  for (const o of list) {
    let u: URL;
    try {
      u = new URL(o);
    } catch {
      throw new ConfigError('HANQ_CORS_ORIGINS contains an invalid origin');
    }
    if (u.origin !== o) throw new ConfigError('HANQ_CORS_ORIGINS entries must be exact origins (scheme://host[:port], no path or slash)');
    if (u.protocol !== 'https:' && !(nodeEnv !== 'production' && u.protocol === 'http:' && isLoopbackHost(u.hostname))) {
      throw new ConfigError('HANQ_CORS_ORIGINS must use https (http allowed only for loopback outside production)');
    }
  }
  return [...new Set(list)];
}

function database(env: Env, nodeEnv: NodeEnv, readFile: (p: string) => string): DatabaseConfig {
  // Tests NEVER read DATABASE_URL (it may hold the real database); they need their own loopback *_test URL.
  const url = nodeEnv === 'test' ? str(env, 'HANQ_TEST_DATABASE_URL') : str(env, 'DATABASE_URL');
  if (url === undefined) throw new ConfigError(nodeEnv === 'test' ? 'HANQ_TEST_DATABASE_URL is required for tests' : 'DATABASE_URL is required');
  const p = parseDatabaseUrl(url);
  if (nodeEnv === 'test' && (!isLoopbackHost(p.host) || !/_test$/.test(p.database))) {
    throw new ConfigError('test database must be on a loopback host and its name must end with _test');
  }
  const mode = oneOf(env, 'HANQ_DB_SSL_MODE', ['verify-full', 'disable'] as const, isLoopbackHost(p.host) && nodeEnv !== 'production' ? 'disable' : 'verify-full');
  if (mode === 'disable' && (nodeEnv === 'production' || !isLoopbackHost(p.host))) {
    throw new ConfigError('HANQ_DB_SSL_MODE=disable is allowed only for a loopback database outside production');
  }
  let ssl: DatabaseConfig['ssl'] = false;
  if (mode === 'verify-full') {
    const caFile = str(env, 'HANQ_DB_CA_FILE');
    let ca: string | undefined;
    if (caFile !== undefined) {
      // An explicitly configured CA always takes precedence.
      try {
        ca = readFile(caFile);
      } catch {
        throw new ConfigError('HANQ_DB_CA_FILE could not be read');
      }
      if (!ca.includes('-----BEGIN CERTIFICATE-----')) throw new ConfigError('HANQ_DB_CA_FILE is not a PEM certificate');
    } else if (isSupabaseHost(p.host)) {
      // Supabase's chain ends in its own CA (not in Node's root store): use the project copy, accepted only if it
      // matches the pinned fingerprint. Verification stays on (rejectUnauthorized + hostname check); global trust untouched.
      let pem: string;
      try {
        pem = readFile(supabaseCaPath());
      } catch {
        throw new ConfigError(`Supabase database needs its CA: run "npm run ca:supabase" (downloads ${SUPABASE_CA_FILE} and checks its fingerprint) or set HANQ_DB_CA_FILE`);
      }
      ca = verifiedSupabaseCa(pem) ?? undefined;
      if (!ca) throw new ConfigError(`${SUPABASE_CA_FILE} does not match the pinned Supabase CA fingerprint; re-run "npm run ca:supabase"`);
    }
    ssl = ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
  }
  return { ...p, ssl, poolMax: int(env, 'HANQ_DB_POOL_MAX', 10, 1, 50) };
}

/** Never touches the filesystem and never fails startup: a missing or relative path disables CBT start and image access. */
function cbtAssets(env: Env, warnings: string[]): NonNullable<AppConfig['cbt']> {
  const abs = (key: string): string | null => {
    const v = str(env, key);
    if (v === undefined) return null;
    if (!isAbsolute(v) || v.includes('\u0000')) {
      warnings.push(`${key} must be an absolute path; ignored`);
      return null;
    }
    return v;
  };
  const raw = str(env, 'HANQ_CBT_PUBLIC_ASSET_BASE_URL') ?? 'https://hanq.vercel.app/media/cbt-originals';
  let publicAssetBaseUrl: string | null = null;
  if (raw !== 'off') {
    try {
      const u = new URL(raw);
      const localTest = env.NODE_ENV === 'test' && u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
      if ((u.protocol !== 'https:' && !localTest) || u.username || u.password || u.search || u.hash) throw new Error('invalid');
      publicAssetBaseUrl = u.href.replace(/\/$/, '');
    } catch { warnings.push('HANQ_CBT_PUBLIC_ASSET_BASE_URL must be an https asset base URL; ignored'); }
  }
  return { assetDir: abs('HANQ_CBT_ASSET_DIR'), manifestFile: abs('HANQ_CBT_ASSET_MANIFEST'), publicAssetBaseUrl };
}

/** Omitted directory uses the audited server-only bundle; invalid explicit paths fail closed. */
function textbookConfig(env: Env): NonNullable<AppConfig['textbook']> {
  const dir = str(env, 'HANQ_TEXTBOOK_DATA_DIR');
  if (dir && (!isAbsolute(dir) || dir.includes('\u0000'))) throw new ConfigError('HANQ_TEXTBOOK_DATA_DIR must be an absolute path');
  const revisions = str(env, 'HANQ_TEXTBOOK_REVISIONS_DIR');
  if (revisions && (!isAbsolute(revisions) || revisions.includes('\u0000'))) throw new ConfigError('HANQ_TEXTBOOK_REVISIONS_DIR must be an absolute path');
  return { dataDir: dir ?? null, ...(revisions ? { revisionsDir: revisions } : {}) };
}

/** Database settings only (migrate/seed scripts): same validation as the API. */
export function loadDatabaseConfig(env: Env, opts: { readFile?: (p: string) => string } = {}): { env: NodeEnv; database: DatabaseConfig } {
  const nodeEnv = oneOf(env, 'NODE_ENV', ['production', 'development', 'test'] as const, 'development');
  return { env: nodeEnv, database: database(env, nodeEnv, opts.readFile ?? ((p: string) => readFileSync(p, 'utf8'))) };
}

/** Reads and validates all settings. Production fails closed on anything missing or weak. */
export function loadConfig(env: Env, opts: { readFile?: (p: string) => string } = {}): AppConfig {
  const readFile = opts.readFile ?? ((p: string) => readFileSync(p, 'utf8'));
  const nodeEnv = oneOf(env, 'NODE_ENV', ['production', 'development', 'test'] as const, 'development');
  const warnings: string[] = [];

  const issuer = str(env, 'HANQ_JWT_ISSUER') ?? (nodeEnv === 'production' ? undefined : 'hanq-dev');
  if (issuer === undefined) throw new ConfigError('HANQ_JWT_ISSUER is required in production');
  if (issuer.length > 200) throw new ConfigError('HANQ_JWT_ISSUER is too long');
  const accessSecret = secret(env, 'HANQ_JWT_ACCESS_SECRET', 'JWT_ACCESS_SECRET', nodeEnv, warnings);
  const refreshSecret = secret(env, 'HANQ_JWT_REFRESH_SECRET', 'JWT_REFRESH_SECRET', nodeEnv, warnings);
  if (sameBytes(accessSecret, refreshSecret)) throw new ConfigError('HANQ_JWT_ACCESS_SECRET and HANQ_JWT_REFRESH_SECRET must differ');

  const sameSiteRaw = str(env, 'HANQ_COOKIE_SAMESITE');
  if (nodeEnv === 'production' && sameSiteRaw === undefined) throw new ConfigError('HANQ_COOKIE_SAMESITE is required in production');
  const sameSite = oneOf(env, 'HANQ_COOKIE_SAMESITE', ['strict', 'lax', 'none'] as const, 'lax');
  const secureRaw = oneOf(env, 'HANQ_COOKIE_SECURE', ['true', 'false'] as const, nodeEnv === 'production' ? 'true' : 'false');
  if (nodeEnv === 'production' && secureRaw !== 'true') throw new ConfigError('HANQ_COOKIE_SECURE must be true in production');
  if (sameSite === 'none' && secureRaw !== 'true') throw new ConfigError('HANQ_COOKIE_SAMESITE=none requires HANQ_COOKIE_SECURE=true');

  const provider = oneOf(env, 'HANQ_PAYMENT_PROVIDER', ['none', 'test'] as const, 'none');
  if (provider === 'test' && nodeEnv === 'production') throw new ConfigError('HANQ_PAYMENT_PROVIDER=test is blocked in production');

  const accessTtlSec = int(env, 'HANQ_ACCESS_TTL_SECONDS', 7 * 86400, 60, 7 * 86400);
  const refreshTtlSec = int(env, 'HANQ_REFRESH_TTL_SECONDS', 14 * 86400, 3600, 60 * 86400);
  const sessionMaxSec = int(env, 'HANQ_SESSION_MAX_SECONDS', 30 * 86400, 3600, 180 * 86400);
  if (sessionMaxSec < refreshTtlSec) throw new ConfigError('HANQ_SESSION_MAX_SECONDS must be >= HANQ_REFRESH_TTL_SECONDS');

  return {
    env: nodeEnv,
    port: int(env, 'PORT', 3000, 1, 65535),
    database: database(env, nodeEnv, readFile),
    jwt: { rememberEnabled: oneOf(env, 'HANQ_REMEMBER_ENABLED', ['true', 'false'] as const, 'false') === 'true', issuer, accessSecret, refreshSecret, accessAudience: 'hanq-api', refreshAudience: 'hanq-refresh', accessTtlSec, refreshTtlSec, sessionMaxSec },
    cors: { origins: origins(env, nodeEnv, warnings) },
    cookie: { name: 'hanq_rt', path: '/api/v1/auth', sameSite, secure: secureRaw === 'true' },
    trustProxy: int(env, 'HANQ_TRUST_PROXY', 0, 0, 5),
    rateLimit: {
      perMinute: int(env, 'HANQ_RATE_LIMIT_PER_MINUTE', 120, 1, 100000),
      authPerMinute: int(env, 'HANQ_AUTH_RATE_LIMIT_PER_MINUTE', 10, 1, 100000),
      loginFailuresPer15Min: int(env, 'HANQ_LOGIN_FAILURES_PER_15MIN', 10, 1, 100000),
    },
    premium: {
      planId: 'premium-1m',
      priceKRW: 5000,
      currency: 'KRW',
      period: oneOf(env, 'HANQ_PREMIUM_PERIOD', ['calendar-month', 'fixed-days'] as const, 'calendar-month'),
      fixedDays: int(env, 'HANQ_PREMIUM_FIXED_DAYS', 30, 1, 366),
      developmentOpen: oneOf(env, 'HANQ_DEVELOPMENT_PREMIUM_OPEN', ['true', 'false'] as const, env.NODE_ENV === 'test' ? 'false' : 'true') === 'true',
      testFreePassEnabled: oneOf(env, 'HANQ_TEST_FREE_PREMIUM_ENABLED', ['true', 'false'] as const, 'false') === 'true',
    },
    payment: { provider },
    cbt: cbtAssets(env, warnings),
    textbook: textbookConfig(env),
    warnings,
  };
}


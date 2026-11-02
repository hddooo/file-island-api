import { createHash, randomBytes, randomInt } from 'node:crypto';
import { AppError } from './app-error';

export const sha256 = (s: string | Buffer): Buffer => createHash('sha256').update(s).digest();
export const sha256hex = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 24): string => randomBytes(bytes).toString('base64url');

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Unknown/malformed ids are simply "not found" (no distinction between foreign and missing objects). */
export function requireUuid(id: string): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new AppError(404, 'not_found', 'Not found');
  return id;
}

/** Fisher–Yates with a CSPRNG (server-owned random order). */
export function secureShuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Opaque keyset cursor: base64url of a positive integer sequence number. */
export function encodeCursor(seq: string | number): string {
  return Buffer.from(String(seq), 'utf8').toString('base64url');
}
export function decodeCursor(cursor: string | undefined): string | null {
  if (cursor == null || cursor === '') return null;
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(cursor)) throw new AppError(400, 'invalid_cursor', 'Invalid cursor');
  const s = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!/^[1-9]\d{0,18}$/.test(s)) throw new AppError(400, 'invalid_cursor', 'Invalid cursor');
  return s;
}

export const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

/** Opt-in session deadlines; the family deadline is absolute and never slides. */
export const REMEMBER_MAX_MS = 90 * 86400 * 1000;
export const REMEMBER_ACCESS_MS = 15 * 60 * 1000;
export type RetentionMode = 'legacy' | 'remember-90d';
export interface RetentionFamily { mode: RetentionMode; createdAt: number; expiresAt: number; revoked: boolean }
export function chooseRetention(value: unknown, createdAt: number, legacyMaxMs: number): RetentionFamily {
  if (value !== undefined && typeof value !== 'boolean') throw new TypeError('rememberMe must be boolean');
  if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(legacyMaxMs) || legacyMaxMs <= 0) throw new RangeError('invalid deadline');
  const mode = value === true ? 'remember-90d' : 'legacy';
  return { mode, createdAt, expiresAt: createdAt + (mode === 'remember-90d' ? REMEMBER_MAX_MS : legacyMaxMs), revoked: false };
}
export function renewalDeadline(f: RetentionFamily, now: number, legacyAccessMs: number): number | null {
  if (!Number.isSafeInteger(now) || now < f.createdAt || f.revoked || now >= f.expiresAt) return null;
  const deadline = f.mode === 'remember-90d'
    ? Math.min(now + REMEMBER_ACCESS_MS, f.createdAt + REMEMBER_MAX_MS, f.expiresAt)
    : Math.min(f.createdAt + legacyAccessMs, f.expiresAt);
  return deadline > now ? deadline : null;
}

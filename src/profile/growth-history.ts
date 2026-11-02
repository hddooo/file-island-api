import { AppError } from '../common/app-error';

/** Read-only view of the append-only growth ledger (migration 003). No new table, column, index or grant. */
export const GROWTH_HISTORY_DEFAULT_LIMIT = 20;
export const GROWTH_HISTORY_MAX_LIMIT = 50;
export type GrowthReason = 'signup' | 'wrong-note-study' | 'practice-quiz' | 'practice-mock' | 'cbt-exam' | 'toeic-answer' | 'battle' | 'admin-adjustment' | 'attendance';
const REASONS: readonly string[] = ['signup', 'wrong-note-study', 'practice-quiz', 'practice-mock', 'cbt-exam', 'toeic-answer', 'battle', 'admin-adjustment', 'attendance']; // practice-*: 008 · cbt-exam: 009

/** Ledger keys are server-written ('signup', 'study:<run uuid>'); the cursor only ever carries a key the server returned. */
const EVENT_KEY = /^[A-Za-z0-9:_-]{1,80}$/;
/** created_at rendered by SQL in UTC with all six fractional digits, so the keyset never rounds to milliseconds. */
const MICRO_TS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/;

export interface GrowthCursor { createdAt: string; eventKey: string }

/** Opaque keyset cursor over (created_at, event_key): base64url of "<microsecond UTC timestamp>|<event key>". */
export function encodeGrowthCursor(c: GrowthCursor): string {
  return Buffer.from(c.createdAt + '|' + c.eventKey, 'utf8').toString('base64url');
}

export function decodeGrowthCursor(cursor: string | undefined): GrowthCursor | null {
  if (cursor == null || cursor === '') return null;
  const bad = () => new AppError(400, 'invalid_cursor', 'Invalid cursor');
  if (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(cursor)) throw bad();
  const s = Buffer.from(cursor, 'base64url').toString('utf8');
  // Only the canonical encoding is accepted (no padding variants, no trailing garbage that decodes to the same text).
  if (Buffer.from(s, 'utf8').toString('base64url') !== cursor) throw bad();
  const bar = s.indexOf('|');
  if (bar < 0) throw bad();
  const createdAt = s.slice(0, bar), eventKey = s.slice(bar + 1);
  const m = MICRO_TS.exec(createdAt);
  if (!m || !EVENT_KEY.test(eventKey)) throw bad();
  const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d || h > 23 || mi > 59 || se > 59) throw bad();
  return { createdAt, eventKey };
}

export function isGrowthReason(kind: string): kind is GrowthReason {
  return REASONS.includes(kind);
}

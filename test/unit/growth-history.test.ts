import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../../src/common/app-error';
import { decodeGrowthCursor, encodeGrowthCursor, isGrowthReason } from '../../src/profile/growth-history';

const invalid = (fn: () => unknown) => assert.throws(fn, (e: unknown) => e instanceof AppError && e.getStatus() === 400 && e.code === 'invalid_cursor');

describe('growth history cursor (opaque keyset over created_at microseconds + event key)', () => {
  it('round-trips microsecond timestamps and event keys exactly (no millisecond rounding)', () => {
    const c = { createdAt: '2026-10-08T03:00:00.123456Z', eventKey: 'study:6f1c2a52-6d7e-4b8a-9a43-0f2b1c3d4e5f' };
    const s = encodeGrowthCursor(c);
    assert.match(s, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(decodeGrowthCursor(s), c);
    assert.deepEqual(decodeGrowthCursor(encodeGrowthCursor({ createdAt: '2026-10-08T03:00:00.000001Z', eventKey: 'signup' })), { createdAt: '2026-10-08T03:00:00.000001Z', eventKey: 'signup' });
  });
  it('no cursor means the first page', () => {
    assert.equal(decodeGrowthCursor(undefined), null);
    assert.equal(decodeGrowthCursor(''), null);
  });
  it('rejects tampered, non-canonical or malformed cursors with 400 invalid_cursor', () => {
    const enc = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
    invalid(() => decodeGrowthCursor('not a cursor!'));
    invalid(() => decodeGrowthCursor(enc('2026-10-08T03:00:00.123Z|signup'))); // milliseconds only: would lose precision
    invalid(() => decodeGrowthCursor(enc('2026-10-08T03:00:00.123456|signup'))); // no UTC marker
    invalid(() => decodeGrowthCursor(enc('2026-02-30T03:00:00.123456Z|signup'))); // impossible date
    invalid(() => decodeGrowthCursor(enc('2026-10-08T24:00:00.123456Z|signup')));
    invalid(() => decodeGrowthCursor(enc('2026-10-08T03:00:00.123456Z|')));
    invalid(() => decodeGrowthCursor(enc('2026-10-08T03:00:00.123456Z|bad key;drop')));
    invalid(() => decodeGrowthCursor(enc('2026-10-08T03:00:00.123456Z')));
    invalid(() => decodeGrowthCursor(enc('2026-10-08T03:00:00.123456Z|signup') + 'A')); // trailing bits: not the canonical form
    invalid(() => decodeGrowthCursor('x'.repeat(201)));
  });
  it('only real ledger kinds are reasons (003 + 008)', () => {
    assert.equal(isGrowthReason('signup'), true);
    assert.equal(isGrowthReason('wrong-note-study'), true);
    assert.equal(isGrowthReason('practice-quiz'), true, 'migration 008');
    assert.equal(isGrowthReason('practice-mock'), true, 'migration 008');
    assert.equal(isGrowthReason('import'), false);
    assert.equal(isGrowthReason('cbt'), false);
  });
});

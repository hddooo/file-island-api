import assert from 'node:assert/strict';
import { it } from 'node:test';
import { chooseRetention, renewalDeadline } from '../../src/auth/retention-policy';
const day = 86400000, start = Date.parse('2026-10-01T00:00:00Z');
it('only an explicit boolean true opts in; missing/false retain the existing absolute access policy', () => {
  for (const value of [undefined, false]) {
    const f = chooseRetention(value, start, 30 * day);
    assert.equal(f.mode, 'legacy');
    assert.equal(renewalDeadline(f, start + 7 * day, 7 * day), null);
  }
  for (const value of ['true', 1, null, {}]) assert.throws(() => chooseRetention(value, start, 30 * day));
});
it('short access renews across reentry but the original 90-day cap never slides', () => {
  const f = chooseRetention(true, start, 30 * day);
  for (const days of [0, 1, 14, 30, 60, 89]) {
    const now = start + days * day;
    assert.equal(renewalDeadline(f, now, 7 * day), now + 15 * 60000);
    assert.equal(f.expiresAt, start + 90 * day);
  }
  assert.equal(renewalDeadline(f, start + 90 * day - 1, 7 * day), start + 90 * day);
  assert.equal(renewalDeadline(f, start + 90 * day, 7 * day), null);
});
it('revoked families and invalid/backward clocks never renew', () => {
  const f = chooseRetention(true, start, 30 * day);
  assert.equal(renewalDeadline({ ...f, revoked: true }, start + 1, 7 * day), null);
  assert.equal(renewalDeadline(f, start - 1, 7 * day), null);
  assert.equal(renewalDeadline(f, NaN, 7 * day), null);
});

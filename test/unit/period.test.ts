import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addCalendarMonthUTC, addPremiumPeriod } from '../../src/premium/period';
import { PremiumService } from '../../src/premium/premium.service';

const iso = (d: Date) => d.toISOString();

describe('premium period (calendar month, UTC, clamped)', () => {
  it('keeps the day and time when the next month has it', () => {
    assert.equal(iso(addCalendarMonthUTC(new Date('2026-10-08T03:04:05.006Z'))), '2026-11-08T03:04:05.006Z');
  });
  it('clamps month ends', () => {
    assert.equal(iso(addCalendarMonthUTC(new Date('2027-01-31T10:00:00Z'))), '2027-02-28T10:00:00.000Z');
    assert.equal(iso(addCalendarMonthUTC(new Date('2028-01-31T10:00:00Z'))), '2028-02-29T10:00:00.000Z'); // leap year
    assert.equal(iso(addCalendarMonthUTC(new Date('2026-03-31T23:59:59Z'))), '2026-04-30T23:59:59.000Z');
    assert.equal(iso(addCalendarMonthUTC(new Date('2028-02-29T00:00:00Z'))), '2028-03-29T00:00:00.000Z');
  });
  it('rolls December into January of the next year', () => {
    assert.equal(iso(addCalendarMonthUTC(new Date('2026-12-31T12:00:00Z'))), '2027-01-31T12:00:00.000Z');
  });
  it('works in UTC regardless of Korean local midnight', () => {
    // 2026-01-31 23:30 UTC is 2026-02-01 08:30 KST; the policy is defined in UTC.
    assert.equal(iso(addCalendarMonthUTC(new Date('2026-01-31T23:30:00Z'))), '2026-02-28T23:30:00.000Z');
  });
  it('fixed-days policy adds exact days', () => {
    assert.equal(iso(addPremiumPeriod(new Date('2027-01-31T10:00:00Z'), 'fixed-days', 30)), '2027-03-02T10:00:00.000Z');
    assert.equal(iso(addPremiumPeriod(new Date('2027-01-31T10:00:00Z'), 'calendar-month', 30)), '2027-02-28T10:00:00.000Z');
  });
  it('is active strictly before expiry; the exact expiry instant is denied', () => {
    const exp = new Date('2026-11-08T03:00:00Z');
    assert.equal(PremiumService.isActiveAt(exp, new Date(exp.getTime() - 1)), true);
    assert.equal(PremiumService.isActiveAt(exp, exp), false);
    assert.equal(PremiumService.isActiveAt(exp, new Date(exp.getTime() + 1)), false);
    assert.equal(PremiumService.isActiveAt(null, exp), false);
  });
});

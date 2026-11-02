import type { PeriodPolicy } from '../config/config';

const DAY_MS = 86_400_000;

function daysInMonthUTC(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** One calendar month later in UTC, clamping the day to the target month's length
 *  (Jan 31 10:00Z → Feb 28/29 10:00Z, Mar 31 → Apr 30, Feb 29 2028 → Mar 29 2028). Time of day is kept. */
export function addCalendarMonthUTC(from: Date): Date {
  const y = from.getUTCFullYear(), m = from.getUTCMonth(), d = from.getUTCDate();
  const ty = m === 11 ? y + 1 : y, tm = (m + 1) % 12;
  const day = Math.min(d, daysInMonthUTC(ty, tm));
  return new Date(Date.UTC(ty, tm, day, from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()));
}

/** End of one premium period starting at `from`. The pass is active while now < end (the end instant itself is not). */
export function addPremiumPeriod(from: Date, policy: PeriodPolicy, fixedDays: number): Date {
  return policy === 'fixed-days' ? new Date(from.getTime() + fixedDays * DAY_MS) : addCalendarMonthUTC(from);
}

export function describePeriod(policy: PeriodPolicy, fixedDays: number): string {
  return policy === 'fixed-days'
    ? `${fixedDays} days (${fixedDays * 24} hours) from the later of now and your current expiry`
    : 'one calendar month (UTC) from the later of now and your current expiry; a day missing in the next month is clamped to its last day';
}

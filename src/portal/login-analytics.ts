import type { Queryable } from '../db/db.service';

/** Read existing successful sign-in events only; refreshes and signups are excluded. */
export async function loginAnalytics(q: Queryable, now: Date, days: number) {
  // One SQL statement gives totals, daily buckets and evidence boundaries the same snapshot.
  const result = await q.query(`
    WITH bounds AS (
      SELECT ($1::timestamptz AT TIME ZONE 'Asia/Seoul')::date today
    ), events AS (
      SELECT user_id,created_at,(created_at AT TIME ZONE 'Asia/Seoul')::date AS login_day
      FROM hanq.member_access_logs WHERE event='signin' AND created_at <= $1
    ), selected AS (
      SELECT e.* FROM events e,bounds b WHERE e.login_day >= b.today-($2::int-1)
    ), daily AS (
      SELECT login_day,count(*)::int logins,count(DISTINCT user_id)::int users FROM selected GROUP BY login_day
    )
    SELECT
      (SELECT min(created_at) FROM events) first_recorded_login_at,
      (SELECT count(*)::int FROM selected) login_count,
      (SELECT count(DISTINCT user_id)::int FROM selected) unique_users,
      (SELECT json_agg(json_build_object('date',to_char(b.today-n,'YYYY-MM-DD'),
        'recordedLogins',coalesce(a.logins,0),'recordedUsers',coalesce(a.users,0)) ORDER BY b.today-n)
       FROM bounds b CROSS JOIN generate_series(0,$2::int-1) n
       LEFT JOIN daily a ON a.login_day=b.today-n) daily
  `, [now, days]);
  const row = result.rows[0];
  const firstDay = row.first_recorded_login_at ? new Date(new Date(row.first_recorded_login_at).getTime()+9*3600000).toISOString().slice(0,10) : null;
  return {
    timezone: 'Asia/Seoul', days, generatedAt: now.toISOString(),
    source: 'member_access_logs.signin', coverage: 'unverified', collectionStartedAt: null,
    firstRecordedLoginAt: row.first_recorded_login_at,
    // These are recorded-event totals, never an assertion of complete historical coverage.
    recordedLoginCount: firstDay ? row.login_count : null, recordedUniqueUsers: firstDay ? row.unique_users : null,
    daily: row.daily.map((day: {date:string;recordedLogins:number;recordedUsers:number}) =>
      !firstDay || day.date < firstDay ? {...day,recordedLogins:null,recordedUsers:null} : day),
  };
}

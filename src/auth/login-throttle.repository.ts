import { Injectable } from '@nestjs/common';
import type { Queryable } from '../db/db.service';

/** Failed sign-ins per SHA-256(normalized e-mail), stored in PostgreSQL so every API instance sees the same count. */
@Injectable()
export class LoginThrottleRepository {
  async countSince(q: Queryable, emailKey: Buffer, since: Date): Promise<number> {
    const r = await q.query<{ n: string }>('SELECT count(*)::text AS n FROM hanq.auth_login_failures WHERE email_key = $1 AND created_at > $2', [emailKey, since]);
    return Number(r.rows[0]?.n ?? 0);
  }

  async record(q: Queryable, emailKey: Buffer, now: Date): Promise<void> {
    await q.query('INSERT INTO hanq.auth_login_failures (email_key, created_at) VALUES ($1, $2)', [emailKey, now]);
    // Keep the table small: rows older than a day are no longer relevant to any window.
    await q.query('DELETE FROM hanq.auth_login_failures WHERE email_key = $1 AND created_at < $2', [emailKey, new Date(now.getTime() - 86_400_000)]);
  }
}

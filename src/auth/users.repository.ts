import { Injectable } from '@nestjs/common';
import type { Queryable } from '../db/db.service';

export interface UserRow {
  approval_status: 'pending'|'approved'|'rejected';
  id: string;
  email_normalized: string;
  email_display: string;
  password_hash: string;
  display_name: string;
  created_at: Date;
  updated_at: Date;
  password_changed_at: Date;
}

@Injectable()
export class UsersRepository {
  async insert(q: Queryable, u: { id: string; emailNormalized: string; emailDisplay: string; passwordHash: string; displayName: string; now: Date }): Promise<UserRow | null> {
    const r = await q.query<UserRow>(
      `INSERT INTO hanq.users (id, email_normalized, email_display, password_hash, display_name, created_at, updated_at, password_changed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $6)
       ON CONFLICT (email_normalized) DO NOTHING
       RETURNING *`,
      [u.id, u.emailNormalized, u.emailDisplay, u.passwordHash, u.displayName, u.now],
    );
    return r.rows[0] ?? null;
  }

  async findByEmail(q: Queryable, emailNormalized: string): Promise<UserRow | null> {
    const r = await q.query<UserRow>('SELECT * FROM hanq.users WHERE email_normalized = $1', [emailNormalized]);
    return r.rows[0] ?? null;
  }

  async findById(q: Queryable, id: string, forUpdate = false): Promise<UserRow | null> {
    const r = await q.query<UserRow>(`SELECT * FROM hanq.users WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`, [id]);
    return r.rows[0] ?? null;
  }

  async updateDisplayName(q: Queryable, id: string, displayName: string, now: Date): Promise<UserRow | null> {
    const r = await q.query<UserRow>('UPDATE hanq.users SET display_name = $2, updated_at = $3 WHERE id = $1 RETURNING *', [id, displayName, now]);
    return r.rows[0] ?? null;
  }

  async updatePassword(q: Queryable, id: string, passwordHash: string, now: Date): Promise<void> {
    await q.query('UPDATE hanq.users SET password_hash = $2, password_changed_at = $3, updated_at = $3 WHERE id = $1', [id, passwordHash, now]);
  }
}

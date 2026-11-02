import { Injectable } from '@nestjs/common';
import type { Queryable } from '../db/db.service';

export interface RefreshLockRow {
  id: string;
  family_id: string;
  expires_at: Date;
  used_at: Date | null;
  user_id: string;
  family_expires_at: Date;
  family_created_at: Date;
  retention_mode?: 'legacy' | 'remember-90d';
  family_revoked_at: Date | null;
}

export type RevokeReason = 'logout' | 'logout-all' | 'replay' | 'password-change';

@Injectable()
export class SessionsRepository {
  async createFamily(q: Queryable, f: { id: string; userId: string; now: Date; expiresAt: Date; mode?: 'legacy' | 'remember-90d' }): Promise<void> {
    await q.query('INSERT INTO hanq.session_families (id, user_id, created_at, expires_at, retention_mode) VALUES ($1, $2, $3, $4, $5)', [f.id, f.userId, f.now, f.expiresAt, f.mode ?? 'legacy']);
  }

  async insertRefresh(q: Queryable, t: { id: string; familyId: string; jtiHash: Buffer; now: Date; expiresAt: Date }): Promise<void> {
    await q.query('INSERT INTO hanq.refresh_tokens (id, family_id, jti_hash, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)', [t.id, t.familyId, t.jtiHash, t.now, t.expiresAt]);
  }

  /** Locks the token row and its family so two rotations of the same token are serialized. */
  async lockRefresh(q: Queryable, jtiHash: Buffer): Promise<RefreshLockRow | null> {
    const r = await q.query<RefreshLockRow>(
      `SELECT t.id, t.family_id, t.expires_at, t.used_at, f.user_id, f.expires_at AS family_expires_at, f.created_at AS family_created_at, f.revoked_at AS family_revoked_at, f.retention_mode
         FROM hanq.refresh_tokens t
         JOIN hanq.session_families f ON f.id = t.family_id
        WHERE t.jti_hash = $1
        FOR UPDATE OF t, f`,
      [jtiHash],
    );
    return r.rows[0] ?? null;
  }

  async markUsed(q: Queryable, id: string, now: Date, replacedBy: string): Promise<void> {
    await q.query('UPDATE hanq.refresh_tokens SET used_at = $2, replaced_by = $3 WHERE id = $1', [id, now, replacedBy]);
  }

  async revokeFamily(q: Queryable, familyId: string, userId: string, now: Date, reason: RevokeReason): Promise<boolean> {
    const r = await q.query(
      'UPDATE hanq.session_families SET revoked_at = $3, revoke_reason = $4 WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
      [familyId, userId, now, reason],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async revokeAllForUser(q: Queryable, userId: string, now: Date, reason: RevokeReason, exceptFamilyId?: string): Promise<number> {
    const r = await q.query(
      `UPDATE hanq.session_families SET revoked_at = $2, revoke_reason = $3
        WHERE user_id = $1 AND revoked_at IS NULL AND ($4::uuid IS NULL OR id <> $4::uuid)`,
      [userId, now, reason, exceptFamilyId ?? null],
    );
    return r.rowCount ?? 0;
  }

  /** Locks the caller's own session family if it is still live (used by password change, after the user row lock). */
  async lockLiveFamily(q: Queryable, familyId: string, userId: string, now: Date): Promise<boolean> {
    const r = await q.query(
      'SELECT 1 FROM hanq.session_families WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > $3 FOR UPDATE',
      [familyId, userId, now],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Access tokens are accepted only while their family exists, belongs to the user, is not revoked and not expired. */
  async isFamilyActive(q: Queryable, familyId: string, userId: string, now: Date): Promise<boolean> {
    const r = await q.query(
      'SELECT 1 FROM hanq.session_families WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > $3',
      [familyId, userId, now],
    );
    return (r.rowCount ?? 0) > 0;
  }
}

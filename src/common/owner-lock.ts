import type { Queryable } from '../db/db.service';

/** Per-user serialization for everything that writes graded attempts or issues a wrong-note queue (ordinary practice, imports,
 *  replays, wrong-note study/runs, CBT finalization). Always the FIRST lock of such a transaction — owner row, then any
 *  run/replay/batch row — so concurrent requests of one user queue in order without deadlocks. Same row lock the existing
 *  `users.findById(q, id, true)` takes. Read the server clock only AFTER this returns: the confirmation time of an attempt
 *  (attempts.created_at, which starts the 24 h wrong-note cooldown) is when it is really written, not when the request arrived. */
export async function lockOwner(q: Queryable, userId: string): Promise<void> {
  await q.query('SELECT 1 FROM hanq.users WHERE id = $1 FOR UPDATE', [userId]);
}

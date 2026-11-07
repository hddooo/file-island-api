import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error';
import { CLOCK, type Clock } from '../common/tokens';
import { sha256, sha256hex } from '../common/util';
import { DbService } from '../db/db.service';
import { QuestionsRepository } from '../questions/questions.repository';
import { AttemptsRepository } from './attempts.repository';
import { AttemptsService } from './attempts.service';
import { lockOwner } from '../common/owner-lock';

export interface ImportEntry {
  localId: string;
  mode: 'quiz' | 'mock';
  questionId: string;
  contentVersion: string;
  optionId: string | null;
  ts?: number;
}

/** 'account': automatic per-account sync — the server's submission id is derived from (user id, localId) only, so the same local
 *  record sent under two different import keys (e.g. two tabs that each generated a key) is stored once. Absent ('browser'):
 *  the original manual import — submission ids stay keyHash|localId, so legacy same-key retries keep matching earlier rows. */
export type ImportScope = 'account' | 'browser';
export const accountSubmissionId = (userId: string, localId: string) => 'imp-' + sha256hex('hanq-import-account|' + userId + '|' + localId).slice(0, 40);

export const IMPORT_MAX_PER_REQUEST = 500;
export const IMPORT_MAX_PER_KEY = 5000;

/** Opt-in import of this browser's local attempt records.
 *  - The browser's random import key is bound to the FIRST account that imports with it; another account gets 409
 *    (so two people sharing a browser never blend histories).
 *  - Every entry is re-validated (question, version, kind, option) and RE-GRADED on the server; the local `correct`
 *    flag is not even accepted. Client timestamps are kept only as information, never for grants or ordering.
 *  - Nothing grants premium or growth points. Local records are not modified by the server (the browser keeps its originals).
 *  - The per-key cap counts attempts actually ACCEPTED (new unique rows), not payloads received: resending a batch after a
 *    network failure replays the same deterministic submission ids and is acknowledged as alreadyImported without being charged
 *    again. At the cap, already-imported entries are still acknowledged; only genuinely new ones are skipped
 *    ('import-cap-reached'). `received` is kept as an informational counter only (no schema change). */
@Injectable()
export class ImportService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly db: DbService,
    private readonly questions: QuestionsRepository,
    private readonly attempts: AttemptsService,
    private readonly repo: AttemptsRepository,
  ) {}

  async importLocal(userId: string, importKey: string, entries: ImportEntry[], scope: ImportScope = 'browser') {
    if (entries.length > IMPORT_MAX_PER_REQUEST) throw new AppError(413, 'too_many_entries', `At most ${IMPORT_MAX_PER_REQUEST} entries per request`);
    const keyHash = sha256('hanq-import:' + importKey);
    return this.db.tx(async (q) => {
      await lockOwner(q, userId); // owner row before the batch row; confirmation clock after the wait
      const now = this.clock.now();
      await q.query('INSERT INTO hanq.import_batches (batch_key, user_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (batch_key) DO NOTHING', [keyHash, userId, now]);
      const b = (await q.query<{ user_id: string; accepted: number }>('SELECT user_id, accepted FROM hanq.import_batches WHERE batch_key = $1 FOR UPDATE', [keyHash])).rows[0];
      if (b.user_id !== userId) throw new AppError(409, 'import_key_owned_by_another_account', 'These local records were already imported into a different account');

      const reset=(await q.query<{reset_at:Date}>("SELECT reset_at FROM hanq.wrong_history_resets WHERE user_id=$1 AND island='history'",[userId])).rows[0]?.reset_at;
      const versions = await this.questions.getVersions(q, entries.map((e) => ({ questionId: e.questionId, version: e.contentVersion })));
      const byKey = new Map(versions.map((v) => [v.question_id + '\u0000' + v.version, v]));
      const skipped: { localId: string; reason: string }[] = [];
      const seen = new Set<string>();
      let imported = 0, alreadyImported = 0;
      const keyHex = keyHash.toString('hex');
      for (const e of entries) {
        const skip = (reason: string) => skipped.push({ localId: e.localId, reason });
        if (seen.has(e.localId)) { skip('duplicate-in-request'); continue; }
        seen.add(e.localId);
        if (e.optionId === null) { skip('unanswered-record'); continue; }
        const question = byKey.get(e.questionId + '\u0000' + e.contentVersion);
        if (!question) { skip('unknown-question-or-version'); continue; }
        if (question.kind !== e.mode) { skip('mode-mismatch'); continue; }
        if (!question.option_ids.includes(e.optionId)) { skip('unknown-option'); continue; }
        const reportedAt = typeof e.ts === 'number' && e.ts >= 1.5e12 && e.ts <= now.getTime() + 86_400_000 ? new Date(e.ts) : null;
        if(reset && e.optionId!==question.correct_option_id && (!reportedAt || reportedAt<=reset)){skip('before-wrong-history-reset');continue;}
        const submissionId = scope === 'account' ? accountSubmissionId(userId, e.localId) : 'imp-' + sha256hex(keyHex + '|' + e.localId).slice(0, 40);
        // Cap on accepted unique attempts (row locked above): a resend of an already-imported entry is still acknowledged.
        if (b.accepted + imported >= IMPORT_MAX_PER_KEY && !(await this.repo.findBySubmission(q, userId, submissionId))) { skip('import-cap-reached'); continue; }
        try {
          const r = await this.attempts.record(q, userId, { submissionId, question, optionId: e.optionId, source: 'import', reportedAt }, now);
          if (r.replayed) alreadyImported++;
          else imported++;
        } catch (err) {
          if (err instanceof AppError && err.code === 'submission_conflict') { skip('conflicts-with-earlier-import'); continue; }
          throw err;
        }
      }
      await q.query('UPDATE hanq.import_batches SET received = received + $2, accepted = accepted + $3 WHERE batch_key = $1', [keyHash, entries.length, imported]);
      return { received: entries.length, imported, alreadyImported, skipped: skipped.slice(0, IMPORT_MAX_PER_REQUEST), skippedCount: skipped.length, grantsPremium: false };
    });
  }
}

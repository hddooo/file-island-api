import {lockOwner} from '../common/owner-lock';
import{type PartnerFamily}from'../partner/evolution';
import {collection,command,finishDueHatches,type CollectionCommand} from '../partner/collection';
import {studyActivity} from './study-activity';
import { Inject, Injectable } from '@nestjs/common';
import { AppError, unauthorized } from '../common/app-error';
import { CLOCK, type Clock } from '../common/tokens';
import { iso } from '../common/util';
import { decodeGrowthCursor, encodeGrowthCursor, GROWTH_HISTORY_DEFAULT_LIMIT, GROWTH_HISTORY_MAX_LIMIT, isGrowthReason, type GrowthReason } from './growth-history';
import { DbService } from '../db/db.service';
import { cbtExamResult, studyExamResult, type ExamResult } from './exam-result';
import {attendance,claimNickname} from '../portal/member-state';
import { publicUser } from '../auth/auth.service';
import { normalizeDisplayName, validateNewPassword } from '../auth/credentials';
import { PasswordService } from '../auth/password.service';
import { SessionsRepository } from '../auth/sessions.repository';
import { UsersRepository } from '../auth/users.repository';
import { PremiumService } from '../premium/premium.service';

/** "Me" only: the user id always comes from the verified token. Only safe fields are returned or editable. */
@Injectable()
export class ProfileService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly db: DbService,
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly passwords: PasswordService,
    private readonly premium: PremiumService,
  ) {}

  async studyActivity(userId:string,month?:string){return this.db.tx(async q=>{await q.query('SET TRANSACTION READ ONLY');return studyActivity(q,userId,this.clock.now(),month);});}

  async me(userId: string) {
    const u = await this.users.findById(this.db.pool, userId);
    if (!u) throw unauthorized('invalid_token');
    const snapshot=await this.db.tx(async q=>{
      await lockOwner(q,userId);const now=this.clock.now();await finishDueHatches(q,userId,now);
      const access=await attendance(q,userId,now),partners=await collection(q,userId,now);
      if(access.growth.points!==partners.totalPoints)throw new AppError(503,'collection_balance_mismatch','성장 정보를 확인 중이에요.');
      const partnerEvolution=Object.fromEntries(partners.items.map(p=>[p.family,{...p,stage:p.family==='patamon'?Math.max(0,p.stage-1):p.stage}]));
      return {growth:{points:partners.totalPoints},access,partners,partnerEvolution};
    });
    return { user: publicUser(u), premium: await this.premium.status(userId), ...snapshot };
  }

  async partners(userId:string){return this.db.tx(async q=>{await lockOwner(q,userId);const now=this.clock.now();await finishDueHatches(q,userId,now);return collection(q,userId,now);});}
  async partnerCommand(userId:string,requestId:string,input:CollectionCommand){return this.db.tx(q=>command(q,userId,requestId,input,()=>this.clock.now()));}

  // Compatibility endpoint: older clients may name a family, but cannot evolve an unowned partner.
  async evolve(userId:string,family:PartnerFamily,revision:number,requestId:string){return this.db.tx(async q=>{
    const p=(await collection(q,userId)).items.find(p=>p.family===family);
    if(!p)throw new AppError(404,'partner_not_found','내 디지몬을 찾을 수 없어요.');
    return command(q,userId,requestId,{command:'evolve',id:p.id,revision},()=>this.clock.now());
  });}

  /** Newest first: (created_at, event_key) DESC with a strict keyset, so equal timestamps (ties) are neither skipped nor
   *  repeated across pages. The owner is always the verified token's user id; nothing in the request can name another user.
   *  A wrong-note challenge or CBT reward also carries the final exam result the server stored when it graded that run
   *  (read-only LEFT JOINs on the ledger's own run_id / cbt_run_id, each restricted to the same owner and a FINAL run).
   *  Missing (legacy/unfinished) or inconsistent stored results come back as examResult: null, never a guessed score. */
  async growthHistory(userId: string, cursor: string | undefined, limit = GROWTH_HISTORY_DEFAULT_LIMIT) {
    const after = decodeGrowthCursor(cursor);
    const take = Math.min(Math.max(1, Math.floor(limit) || GROWTH_HISTORY_DEFAULT_LIMIT), GROWTH_HISTORY_MAX_LIMIT);
    const r = await this.db.pool.query<{ kind: string; amount: number; created_at: Date; created_us: string; event_key: string; run_score: unknown; cbt_result: unknown }>(
      `SELECT g.kind, g.amount, g.created_at, g.event_key,
              to_char(g.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_us,
              r.score AS run_score, c.result AS cbt_result
         FROM hanq.growth_ledger g
         LEFT JOIN hanq.runs r
           ON g.kind = 'wrong-note-study' AND r.id = g.run_id AND r.user_id = $1 AND r.status = 'final'
          AND r.selection->>'mode' = 'wrong-note-study'
         LEFT JOIN hanq.cbt_runs c
           ON g.kind = 'cbt-exam' AND c.id = g.cbt_run_id AND c.user_id = $1 AND c.status = 'final'
        WHERE g.user_id = $1
          AND ($2::timestamptz IS NULL OR (g.created_at, g.event_key COLLATE "C") < ($2::timestamptz, $3::text COLLATE "C"))
        ORDER BY g.created_at DESC, g.event_key COLLATE "C" DESC
        LIMIT $4`,
      [userId, after ? after.createdAt : null, after ? after.eventKey : null, take + 1],
    );
    const page = r.rows.slice(0, take), last = page[page.length - 1];
    return {
      items: page.filter((x) => isGrowthReason(x.kind)).map((x) => {
        const item: { reason: GrowthReason; points: number; createdAt: string; examResult?: ExamResult | null } = { reason: x.kind as GrowthReason, points: x.amount, createdAt: iso(x.created_at)! };
        if (x.kind === 'wrong-note-study') item.examResult = studyExamResult(x.run_score, x.amount);
        else if (x.kind === 'cbt-exam') item.examResult = cbtExamResult(x.cbt_result, x.amount);
        return item;
      }),
      next: r.rows.length > take ? encodeGrowthCursor({ createdAt: last.created_us, eventKey: last.event_key }) : null,
    };
  }

  async updateDisplayName(userId: string, displayName: string) {
    const name=normalizeDisplayName(displayName),now=this.clock.now();
    return this.db.tx(async q=>{const old=await this.users.findById(q,userId,true);if(!old)throw unauthorized('invalid_token');await this.premium.assertActive(q,userId,now);if(name!==old.display_name)await claimNickname(q,userId,name);const u=await this.users.updateDisplayName(q,userId,name,now);return{user:publicUser(u!)};});
  }

  /** Requires the current password; on success every OTHER session family is revoked (this device stays signed in). */
  async changePassword(userId: string, sessionId: string, currentPassword: string, newPassword: string) {
    const u = await this.users.findById(this.db.pool, userId);
    if (!u) throw unauthorized('invalid_token');
    if (!(await this.passwords.verify(u.password_hash, currentPassword))) throw new AppError(403, 'wrong_current_password', 'The current password is incorrect');
    validateNewPassword(newPassword, u.email_normalized);
    if (currentPassword === newPassword) throw new AppError(400, 'weak_password', 'Choose a different password');
    const hash = await this.passwords.hash(newPassword);
    const now = this.clock.now();
    const revoked = await this.db.tx(async (q) => {
      // Re-check under the user row lock: the hash the current password was verified against must still be stored
      // (two concurrent changes with the same old password → exactly one wins), and this session must still be live
      // (a concurrent logout/revocation wins). Lock order: user row → session family (same as sign-in).
      const locked = await this.users.findById(q, userId, true);
      if (!locked || locked.password_hash !== u.password_hash) throw new AppError(409, 'password_changed', 'The password was changed in the meantime; sign in again');
      if (!(await this.sessions.lockLiveFamily(q, sessionId, userId, now))) throw unauthorized('invalid_token');
      await this.users.updatePassword(q, userId, hash, now);
      return this.sessions.revokeAllForUser(q, userId, now, 'password-change', sessionId);
    });
    return { changed: true, revokedOtherSessions: revoked };
  }
}

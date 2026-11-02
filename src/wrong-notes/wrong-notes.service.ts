import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError, notFound } from '../common/app-error';
import { CLOCK, type Clock } from '../common/tokens';
import { iso, requireUuid, secureShuffle } from '../common/util';
import { DbService } from '../db/db.service';
import { attemptView, AttemptsService } from '../attempts/attempts.service';
import { PremiumService } from '../premium/premium.service';
import { QuestionsRepository } from '../questions/questions.repository';
import { WrongNotesRepository, type WrongStateRow } from './wrong-notes.repository';
import { lockOwner } from '../common/owner-lock';
import { selectStudy } from './study-policy';
import { GORYEO_FOCUSED_CONTENT } from './goryeo-focused-content';

export interface WrongFilter {
  status?: 'unresolved' | 'all';
  kind?: 'quiz' | 'mock';
  era?: string;
}

export const WRONG_PARTS = [
 {id:'ancient',label:'고대사',eras:['prehistory','gojoseon','samguk','nambuk']},
 {id:'goryeo',label:'고려',eras:['goryeo']},
 {id:'joseon',label:'조선',eras:['joseon','joseon-early','joseon-late']},
 {id:'opening',label:'개화기',eras:['opening']},
 {id:'colonial',label:'일제강점기',eras:['colonial']},
 {id:'modern',label:'현대사',eras:['modern']},
 {id:'islands',label:'독도와 간도',eras:['islands']},
 {id:'comprehensive',label:'종합',eras:['comprehensive']},
] as const;
export function filterWrong(rows: WrongStateRow[], f: WrongFilter): WrongStateRow[] {
 const part=WRONG_PARTS.find(p=>p.id===f.era);
 const eras:readonly string[]=part?part.eras:(f.era?[f.era]:[]);
 return rows.filter(r=>{
  const preferred=typeof r.manual_review?.part==='string'?WRONG_PARTS.find(p=>p.id===r.manual_review!.part):undefined;
  const canonical=WRONG_PARTS.find(p=>(p.eras as readonly string[]).includes(r.era||''))||WRONG_PARTS.find(p=>(r.related_eras||[]).some(e=>(p.eras as readonly string[]).includes(e)));
  const matches=part?part.id===(preferred||canonical)?.id:eras.some(e=>r.era===e||(r.related_eras||[]).includes(e));
  return (f.status==='all'||!r.last_correct)&&(!f.kind||r.kind===f.kind)&&(!eras.length||matches);
 });
}

const noteView = (r: WrongStateRow) => ({
  questionId: r.question_id,
  version: r.version,
  kind: r.kind,
  era: r.era,
  status: r.last_correct ? ('resolved' as const) : ('unresolved' as const),
  wrongCount: r.wrong_count,
  attemptCount: r.attempt_count,
  lastWrongAt: r.last_wrong_at ? iso(r.last_wrong_at) : null,
  manualAddedAt: r.manual_added_at ? iso(r.manual_added_at) : null,
  source: r.manual_added_at ? 'book-manual' : 'attempt',
  personalReview: r.manual_review || null,
  lastWrongOptionId: r.last_wrong_option_id,
  item: r.public_payload,
});

@Injectable()
export class WrongNotesService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly db: DbService,
    private readonly repo: WrongNotesRepository,
    private readonly questions: QuestionsRepository,
    private readonly attempts: AttemptsService,
    private readonly premium: PremiumService,
  ) {}

  /** Free for the signed-in owner: the list itself is not a premium feature, replaying it is. */
  async list(userId: string, f: WrongFilter) {
    await this.premium.assertActive(this.db.pool,userId,this.clock.now());
    const rows = await this.repo.current(this.db.pool, userId);
    const stale = await this.repo.stale(this.db.pool, userId);
    const unresolved = rows.filter((r) => !r.last_correct).length;
    return {
      counts: { unresolved, resolved: rows.length - unresolved, everWrong: rows.length, stale: stale.length },
      items: filterWrong(rows, { status: f.status ?? 'all', kind: f.kind, era: f.era }).map(noteView),
      stale: stale.map((s) => ({ questionId: s.question_id, wrongCount: s.wrong_count, lastWrongAt: iso(s.last_wrong_at) })),
    };
  }

  async parts(userId:string) {
    await this.premium.assertActive(this.db.pool,userId,this.clock.now());
    const rows=await this.repo.current(this.db.pool,userId);
    return {total:rows.length,parts:WRONG_PARTS.map(p=>({id:p.id,label:p.label,count:filterWrong(rows,{status:'all',era:p.id}).length})),practice:{reward:false,dailyLimit:null,waitHours:0}};
  }

  async focusedReview(userId:string, era='ancient') {
    if(!['ancient','goryeo'].includes(era))throw new AppError(400,'invalid_review_era','Unsupported review era');
    await this.premium.assertActive(this.db.pool,userId,this.clock.now());
    if(era==='goryeo'){
      const profile=await this.db.pool.query('SELECT 1 FROM hanq.personal_review_profiles WHERE user_id=$1 AND era=$2 AND content_key=$3',[userId,'goryeo','goryeo-book-22-v1']);
      return profile.rowCount?GORYEO_FOCUSED_CONTENT:{era:'goryeo',source:'owner-content-profile',notes:[]};
    }
    const rows=await this.db.pool.query<{question_id:string;review_payload:Record<string,unknown>}>(
      `SELECT m.question_id,m.review_payload FROM hanq.manual_wrong_notes m
       JOIN hanq.question_versions v ON v.question_id=m.question_id AND v.is_current
       WHERE m.user_id=$1 AND (v.era IN('prehistory','gojoseon','samguk','nambuk') OR m.review_payload->>'era'='ancient')
       ORDER BY m.added_at,m.question_id`,[userId]);
    return {era:'ancient',source:'book-manual',notes:rows.rows.map(r=>({questionId:r.question_id,review:r.review_payload}))};
  }

  /** PREMIUM. Snapshots a finite queue (≤100) of the caller's own wrong questions; the order is decided by the server. */
  async createReplay(userId: string, dto: { list: 'unresolved' | 'all'; order: 'recent' | 'random'; kind?: 'quiz' | 'mock'; era?: string; size?: number }) {
    return this.db.tx(async (q) => {
      await lockOwner(q, userId);
      const now = this.clock.now();
      await this.premium.assertActive(q, userId, now);
      // Repeat practice is immediate; spaced dates do not exclude correct answers.
      const history = await this.repo.current(q, userId);
      const pool = filterWrong(history, { status: dto.era ? 'all' : dto.list, kind: dto.kind, era: dto.era });
      if (!pool.length) throw new AppError(409, 'nothing_to_replay', 'There are no wrong questions matching this filter');
      const ordered = dto.order === 'random' ? secureShuffle(pool.slice()) : pool;
      const chosen = dto.era ? selectStudy(pool,new Map(),Math.min(dto.size ?? 100,100),now) : ordered.slice(0,Math.min(dto.size ?? 100,100));
      const full = await this.questions.getVersions(q, chosen.map((c) => ({ questionId: c.question_id, version: c.version })));
      const byId = new Map(full.map((x) => [x.question_id, x]));
      const id = randomUUID();
      await this.repo.insertReplay(q, { id, userId, list: dto.list, ord: dto.order, size: chosen.length, now, part: dto.era });
      await this.repo.insertReplayItems(q, id, chosen.map((c) => {
        const row = byId.get(c.question_id)!;
        return { questionId: row.question_id, version: row.version, optionIds: row.kind === 'quiz' ? secureShuffle(row.option_ids.slice()) : row.option_ids };
      }));
      return this.replayView(q, userId, id);
    });
  }

  async listReplays(userId: string) {
    await this.premium.assertActive(this.db.pool,userId,this.clock.now());
    const rows = await this.repo.listReplays(this.db.pool, userId);
    return { replays: rows.map((r) => ({ id: r.id, part:r.part, list: r.list, order: r.ord, size: r.size, answered: r.answered, createdAt: iso(r.created_at), finishedAt: iso(r.finished_at) })) };
  }

  async getReplay(userId: string, id: string) {
    await this.premium.assertActive(this.db.pool,userId,this.clock.now());
    return this.replayView(this.db.pool, userId, requireUuid(id));
  }

  private async replayView(q: Parameters<WrongNotesRepository['replayItems']>[0], userId: string, id: string) {
    const r = await this.repo.findReplayOwned(q, id, userId);
    if (!r) throw notFound();
    const items = await this.repo.replayItems(q, id);
    return {
      replay: { id: r.id, part:r.part, rewardEligible:false, list: r.list, order: r.ord, size: r.size, createdAt: iso(r.created_at), finishedAt: iso(r.finished_at), answered: items.filter((i) => i.attempt_id).length },
      items: items.map((i) => ({
        position: i.position,
        questionId: i.question_id,
        version: i.version,
        kind: i.kind,
        optionOrder: i.option_ids,
        item: i.public_payload,
        // Only the caller's own already-graded items carry the answer and review.
        result: i.attempt_id ? { optionId: i.option_id, correct: i.correct, correctOptionId: i.correct_option_id, review: i.review_payload } : null,
      })),
    };
  }

  /** PREMIUM. Grades one queue position on the server. Retrying the same submission returns the stored result. */
  async answerReplay(userId: string, id: string, dto: { submissionId: string; position: number; optionId: string }) {
    const replayId = requireUuid(id);
    return this.db.tx(async (q) => {
      await lockOwner(q, userId); // owner row first, then the replay row
      const now = this.clock.now();
      const r = await this.repo.findReplayOwned(q, replayId, userId, true);
      if (!r) throw notFound();
      const items = await this.repo.replayItems(q, replayId);
      const item = items.find((i) => i.position === dto.position);
      if (!item) throw new AppError(404, 'no_such_item', 'This replay has no such position');
      const question = (await this.questions.getVersion(q, item.question_id, item.version))!;
      await this.premium.assertActive(q, userId, now);
      const { attempt, replayed } = await this.attempts.record(q, userId, { submissionId: dto.submissionId, question, optionId: dto.optionId, source: 'wrong-replay', replayId }, now);
      if (item.attempt_id && item.attempt_id !== attempt.id) throw new AppError(409, 'already_answered', 'This position was already answered');
      if (!item.attempt_id) {
        await this.repo.setReplayItemAttempt(q, replayId, dto.position, attempt.id);
        await this.repo.finishReplayIfDone(q, replayId, now);
      }
      return { attempt: attemptView(attempt, question.kind), replayed, review: { correctOptionId: question.correct_option_id, item: item.review_payload } };
    });
  }
}

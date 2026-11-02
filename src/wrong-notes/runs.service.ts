import {historyExamGrowth} from '../common/history-growth';
import { boundedGrowth } from '../common/growth-floor';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AppError, notFound } from '../common/app-error';
import { CLOCK, type Clock } from '../common/tokens';
import { iso, requireUuid, secureShuffle } from '../common/util';
import { DbService } from '../db/db.service';
import { AttemptsService } from '../attempts/attempts.service';
import { UsersRepository } from '../auth/users.repository';
import { PremiumService } from '../premium/premium.service';
import { QuestionsRepository } from '../questions/questions.repository';
import { RunsRepository, type RunItemRow, type RunRow } from './runs.repository';
import { filterWrong } from './wrong-notes.service';
import { STUDY_POLICY, STUDY_DAILY_LIMIT, isStudyEligible, kstDate, selectStudy } from './study-policy';
import { WrongNotesRepository } from './wrong-notes.repository';

/** Server-owned personal wrong-based practice runs (PREMIUM). The server picks the questions, keeps the clock (ends_at),
 *  stores the answers and grades — the browser only displays. Same rules as the front's local runs:
 *  ≥10 distinct current-version wrong questions; fill with the latest official rounds (79 → 70); no invented questions. */
export const RUN_PRODUCTS = {
  'personal-mini': { size: 20, durationMin: 30, durationPolicy: 'practice', label: '오답 미니모의고사' },
  'personal-formal': { size: 50, durationMin: 80, durationPolicy: 'official-advanced', label: '오답 실전모의고사' },
} as const;
export type RunProduct = keyof typeof RUN_PRODUCTS;
export const MIN_WRONGS = 10;

export function summarize(items: { pointsKind: string; points: number; answered: boolean; correct: boolean }[]) {
  const part = (kind: string) => {
    const g = items.filter((x) => x.pointsKind === kind);
    return { count: g.length, correct: g.filter((x) => x.correct).length, earned: g.reduce((s, x) => s + (x.correct ? x.points : 0), 0), max: g.reduce((s, x) => s + x.points, 0) };
  };
  const official = part('official'), practice = part('practice');
  const max = official.max + practice.max, earned = official.earned + practice.earned;
  return {
    questions: items.length,
    correct: items.filter((x) => x.correct).length,
    wrong: items.filter((x) => !x.correct).length,
    answered: items.filter((x) => x.answered).length,
    unanswered: items.filter((x) => !x.answered).length,
    official,
    practice,
    total: { earned, max, percent: max ? Math.round((earned / max) * 1000) / 10 : null },
  };
}

@Injectable()
export class RunsService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly db: DbService,
    private readonly runs: RunsRepository,
    private readonly wrong: WrongNotesRepository,
    private readonly questions: QuestionsRepository,
    private readonly attempts: AttemptsService,
    private readonly premium: PremiumService,
    private readonly users: UsersRepository,
  ) {}

  async create(userId: string, dto: { product: RunProduct; scope: 'unresolved' | 'all'; order: 'recent' | 'random' }) {
    const p = RUN_PRODUCTS[dto.product];
    return this.db.tx(async (q) => {
      await this.users.findById(q, userId, true); // owner lock: serializes run numbering and attempt writes per user
      const now = this.clock.now();
      await this.premium.assertActive(q, userId, now);
      const cool = await this.wrong.cooldown(q, userId, now);
      const eligible = filterWrong(cool.history, { status: dto.scope }).filter((x) => !cool.cooled.has(x.question_id));
      if (eligible.length < MIN_WRONGS) {
        throw new AppError(409, 'not_enough_wrongs', `At least ${MIN_WRONGS} distinct wrong questions are needed`, { eligible: eligible.length, required: MIN_WRONGS });
      }
      const chosen = (dto.order === 'random' ? secureShuffle(eligible.slice()) : eligible).slice(0, p.size);
      const full = new Map((await this.questions.getVersions(q, chosen.map((c) => ({ questionId: c.question_id, version: c.version })))).map((x) => [x.question_id, x]));
      const fill = await this.questions.latestOfficial(q, [...new Set([...chosen.filter((c) => c.kind === 'mock').map((c) => c.question_id), ...cool.cooled])], p.size - chosen.length);
      const items = [
        ...chosen.map((c) => {
          const row = full.get(c.question_id)!;
          return row.kind === 'mock'
            ? { questionId: row.question_id, version: row.version, origin: 'wrong-mock', points: row.points, pointsKind: 'official', optionIds: row.option_ids }
            : { questionId: row.question_id, version: row.version, origin: 'wrong-quiz', points: 1, pointsKind: 'practice', optionIds: secureShuffle(row.option_ids.slice()) };
        }),
        ...fill.map((row) => ({ questionId: row.question_id, version: row.version, origin: 'fill', points: row.points, pointsKind: 'official', optionIds: row.option_ids })),
      ];
      const count = (o: string) => items.filter((x) => x.origin === o).length;
      const selection = {
        scope: dto.scope, order: dto.order, eligibleWrong: eligible.length, cooledExcluded: cool.cooled.size, selectedWrong: chosen.length,
        selectedQuiz: count('wrong-quiz'), selectedMock: count('wrong-mock'), fill: count('fill'), shortBy: p.size - items.length,
        fillRule: 'latest-official-round-desc', durationPolicy: p.durationPolicy, label: p.label,
      };
      const id = randomUUID();
      await this.runs.insert(q, { id, userId, seq: await this.runs.nextSeq(q, userId), product: dto.product, size: p.size, durationMs: p.durationMin * 60_000, selection, now });
      await this.runs.insertItems(q, id, items);
      return this.view(q, (await this.runs.findOwned(q, id, userId))!);
    });
  }

  /** One live study session per owner, serialized with existing per-user session lock. */
  async study(userId: string) {
    return this.db.tx(async q => {
      await this.users.findById(q, userId, true);
      const now = this.clock.now(); // after the owner lock: a correct answer queued ahead of us is already visible and dated
      await this.premium.assertActive(q, userId, now);
      const existing = await q.query<RunRow>("SELECT * FROM hanq.runs WHERE user_id=$1 AND status IN ('ready','active') AND selection->>'mode'='wrong-note-study' ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [userId]);
      if (existing.rows[0]) return this.view(q, await this.expireIfDue(q, existing.rows[0], now));
      const cool = await this.wrong.cooldown(q, userId, now), history = cool.history;
      const due = history.filter((x) => isStudyEligible(cool.eligibleAt.get(x.question_id) ?? null, now));
      if (!due.length) {
        // Earliest actual eligibility across the whole history (cooldown floor and spaced review together).
        const next = history.map((x) => cool.eligibleAt.get(x.question_id)).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
        return { run: null, items: [], reason: history.length ? 'review_waiting' : 'no_wrong_questions', nextReviewAt: history.length && next ? next.toISOString() : null, serverTime: now.toISOString() };
      }
      const chosen = selectStudy(due, new Map(due.map((x) => [x.question_id, cool.exposure.get(x.question_id + '|' + x.version) || 0])), STUDY_POLICY.size, now);
      const full = new Map((await this.questions.getVersions(q, chosen.map(x=>({questionId:x.question_id,version:x.version})))).map(x=>[x.question_id,x]));
      const items = chosen.map(x=>{const row=full.get(x.question_id)!;return {questionId:row.question_id,version:row.version,origin:row.kind==='mock'?'wrong-mock':'wrong-quiz',points:row.kind==='mock'?row.points:1,pointsKind:row.kind==='mock'?'official':'practice',optionIds:row.kind==='mock'?row.option_ids:secureShuffle(row.option_ids.slice())};});
      const challenge=items.length===STUDY_POLICY.size,starts=new Date(now.getTime()+STUDY_POLICY.countdownMs),challengeDate=kstDate(starts);
      if(challenge){const count=await q.query<{n:number}>("SELECT count(*)::int n FROM hanq.runs WHERE user_id=$1 AND selection->>'mode'='wrong-note-study' AND selection->>'challengeDate'=$2",[userId,challengeDate]);if(count.rows[0].n>=STUDY_DAILY_LIMIT)throw new AppError(409,'daily_study_limit','Five challenges per Korean calendar day');}
      const id=randomUUID();
      await this.runs.insert(q,{id,userId,seq:await this.runs.nextSeq(q,userId),product:'personal-mini',size:items.length,durationMs:STUDY_POLICY.durationMs,selection:{mode:'wrong-note-study',challenge,challengeDate:challenge?challengeDate:null,policy:STUDY_POLICY,selectedQuiz:items.filter(x=>x.origin==='wrong-quiz').length,selectedMock:items.filter(x=>x.origin==='wrong-mock').length,fill:0},now});
      await this.runs.insertItems(q,id,items);
      for(const x of chosen) await q.query(`INSERT INTO hanq.wrong_note_review_state(user_id,question_id,version,exposure_count,last_shown_at)
        VALUES($1,$2,$3,1,$4) ON CONFLICT(user_id,question_id,version) DO UPDATE SET exposure_count=hanq.wrong_note_review_state.exposure_count+1,last_shown_at=EXCLUDED.last_shown_at`,[userId,x.question_id,x.version,now]);
      await this.runs.start(q,id,starts,new Date(starts.getTime()+STUDY_POLICY.durationMs));
      return this.view(q,(await this.runs.findOwned(q,id,userId))!);
    });
  }

  async list(userId: string) {
    await this.premium.assertActive(this.db.pool,userId,this.clock.now());
    const rows = await this.runs.listOwned(this.db.pool, userId);
    return { runs: rows.map((r) => this.summaryView(r)) };
  }

  /** Reading a run past its deadline finalizes it with the answers stored before the deadline (not a premium action). */
  async get(userId: string, id: string) {
    const runId=requireUuid(id);
    const out=await this.db.tx(async q=>{
      await this.users.findById(q,userId,true);
      const now=this.clock.now();
      let run=await this.runs.findOwned(q,runId,userId,true);if(!run)throw notFound();
      run=await this.expireIfDue(q,run,now);
      return {run,view:await this.view(q,run),now};
    });
    // Expiry is durable even if the membership expired; premium content remains protected.
    await this.premium.assertActive(this.db.pool,userId,out.now);
    return out.view;
  }

  async start(userId: string, id: string) {
    const runId = requireUuid(id);
    return this.db.tx(async (q) => {
      await this.users.findById(q,userId,true);
      const now = this.clock.now();
      const run = await this.runs.findOwned(q, runId, userId, true);
      if (!run) throw notFound();
      if (run.status === 'ready') {
        await this.premium.assertActive(q, userId, now);
        await this.runs.start(q, run.id, now, new Date(now.getTime() + run.duration_ms));
      }
      return this.view(q, (await this.runs.findOwned(q, runId, userId))!);
    });
  }

  async answer(userId: string, id: string, position: number, optionId: string | null) {
    const runId = requireUuid(id);
    const out = await this.db.tx(async (q) => {
      await this.users.findById(q,userId,true);
      const now = this.clock.now();
      let run = await this.runs.findOwned(q, runId, userId, true);
      if (!run) throw notFound();
      run = await this.expireIfDue(q, run, now);
      if (run.status === 'final') return { final: true as const, expired: run.final_reason === 'expired' };
      if (run.started_at && now < run.started_at) throw new AppError(409, 'study_countdown', 'Wait for the countdown');
      if (run.status !== 'active') throw new AppError(409, 'run_not_started', 'Start the run first');
      await this.premium.assertActive(q, userId, now);
      const items = await this.runs.items(q, run.id);
      const item = items.find((i) => i.position === position);
      if (!item) throw new AppError(404, 'no_such_item', 'This run has no such position');
      if (optionId !== null && !item.option_ids.includes(optionId)) throw new AppError(400, 'invalid_option', 'This option does not belong to the question');
      await this.runs.setAnswer(q, run.id, position, optionId, now);
      return { final: false as const, view: await this.view(q, run) };
    });
    if (out.final) throw new AppError(409, out.expired ? 'run_expired' : 'run_final', out.expired ? 'Time is over; the run was graded with the answers saved before the deadline' : 'This run is already graded');
    return out.view;
  }

  async submit(userId: string, id: string) {
    const runId = requireUuid(id);
    return this.db.tx(async (q) => {
      await this.users.findById(q,userId,true);
      const now = this.clock.now();
      let run = await this.runs.findOwned(q, runId, userId, true);
      if (!run) throw notFound();
      run = await this.expireIfDue(q, run, now);
      if (run.started_at && now < run.started_at) throw new AppError(409, 'study_countdown', 'Wait for the countdown');
      await this.premium.assertActive(q,userId,now);
      if (run.status === 'ready') throw new AppError(409, 'run_not_started', 'Start the run first');
      if (run.status === 'active') {
        await this.premium.assertActive(q, userId, now);
        run = await this.finalize(q, run, now, 'submit', now);
      }
      return this.view(q, run);
    });
  }

  private async expireIfDue(q: PoolClient, run: RunRow, now: Date): Promise<RunRow> {
    if (run.status === 'active' && run.ends_at && now.getTime() >= run.ends_at.getTime()) return this.finalize(q, run, run.ends_at, 'expired', now);
    return run;
  }

  /** Grades every item against the stored correct option and records one attempt per item (source 'run',
   *  submission id run-<run>-<n>, unanswered = wrong), exactly once (status guard + unique submission ids).
   *  `at` = official end (deadline for expiry): grading cut-off, finalAt and the growth ledger keep it. `confirmedAt` = the server
   *  clock when this grading actually happens: attempts.created_at and the review state use it, so the 24 h cooldown and the
   *  spaced intervals start at the real confirmation, never backdated to an earlier deadline. */
  private async finalize(q: PoolClient, run: RunRow, at: Date, reason: 'submit' | 'expired', confirmedAt: Date): Promise<RunRow> {
    const items = await this.runs.items(q, run.id);
    const graded = [];
    for (const it of items) {
      const answered = it.answer_option_id !== null && !!it.answered_at && it.answered_at.getTime() < run.ends_at!.getTime();
      const question = (await this.questions.getVersion(q, it.question_id, it.version))!;
      const { attempt } = await this.attempts.record(q, run.user_id, { submissionId: `run-${run.id}-${it.position}`, question, optionId: answered ? it.answer_option_id : null, source: 'run', runId: run.id, studyManaged: run.selection.mode === 'wrong-note-study' }, confirmedAt);
      await this.runs.gradeItem(q, run.id, it.position, attempt.correct, attempt.id);
      if (run.selection.mode === 'wrong-note-study') {
        const st = await q.query<{correct_streak:number}>('SELECT correct_streak FROM hanq.wrong_note_review_state WHERE user_id=$1 AND question_id=$2 AND version=$3 FOR UPDATE',[run.user_id,it.question_id,it.version]);
        const streak = attempt.correct ? (st.rows[0]?.correct_streak || 0)+1 : 0;
        const days = STUDY_POLICY.correctIntervalsDays[Math.min(Math.max(0,streak-1),STUDY_POLICY.correctIntervalsDays.length-1)];
        const due = attempt.correct ? new Date(confirmedAt.getTime()+days*86400000) : confirmedAt;
        await q.query('UPDATE hanq.wrong_note_review_state SET correct_count=correct_count+$4,wrong_count=wrong_count+$5,correct_streak=$6,last_reviewed_at=$7,next_review_at=$8 WHERE user_id=$1 AND question_id=$2 AND version=$3',[run.user_id,it.question_id,it.version,attempt.correct?1:0,attempt.correct?0:1,streak,confirmedAt,due]);
      }
      graded.push({ pointsKind: it.points_kind, points: it.points, answered, correct: attempt.correct });
    }
    const score = summarize(graded);
    if(run.selection.mode==='wrong-note-study'){
      const policyGrowthReward=historyExamGrowth(graded.map(x=>({...x,points:x.pointsKind==='official'?x.points:1}))),actualGrowth=await boundedGrowth(q,run.user_id,policyGrowthReward),growthEarnedPoints=graded.reduce((s,x)=>s+(x.answered&&x.correct?(x.pointsKind==='official'?x.points:1):0),0),growthLostPoints=graded.reduce((s,x)=>s+(x.answered&&!x.correct?(x.pointsKind==='official'?x.points:1):0),0);
      Object.assign(score,{examScore:Math.round(score.correct*100/graded.length),growthReward:actualGrowth,rewardEligible:true,growthPolicy:"per-question-original-points",policyGrowthReward,growthEarnedPoints,growthLostPoints});
      await q.query("INSERT INTO hanq.growth_ledger(user_id,event_key,kind,amount,run_id,created_at) VALUES($1,$2,'wrong-note-study',$3,$4,$5) ON CONFLICT(user_id,event_key) DO NOTHING",[run.user_id,'study:'+run.id,actualGrowth,run.id,at]);
    }
    await this.runs.finalize(q, run.id, at, reason, score);
    return (await this.runs.findOwned(q, run.id, run.user_id))!;
  }

  private summaryView(r: RunRow) {
    const p = RUN_PRODUCTS[r.product];
    return {
      id: r.id, seq: r.seq, product: r.product, label: p.label,
      title: r.selection.mode === 'wrong-note-study' ? `${r.seq}회차 오답 복습` : `${r.seq}회차 ${p.label}`,
      size: r.size, durationMs: r.duration_ms, durationPolicy: p.durationPolicy, status: r.status, selection: r.selection,
      createdAt: iso(r.created_at), startedAt: iso(r.started_at), endsAt: iso(r.ends_at), finalAt: iso(r.final_at), finalReason: r.final_reason, score: r.score,
    };
  }

  private async view(q: PoolClient, r: RunRow) {
    const items: RunItemRow[] = await this.runs.items(q, r.id);
    const final = r.status === 'final';
    const states = r.selection.mode === 'wrong-note-study' ? await q.query<{question_id:string;version:string;exposure_count:number;wrong_count:number;correct_count:number;next_review_at:Date|null}>('SELECT * FROM hanq.wrong_note_review_state WHERE user_id=$1',[r.user_id]) : {rows:[]};
    return {
      run: { ...this.summaryView(r), serverTime: this.clock.now().toISOString() },
      items: items.map((i) => ({
        position: i.position, questionId: i.question_id, version: i.version, kind: i.kind, origin: i.origin, points: i.points, pointsKind: i.points_kind,
        reviewState: states.rows.find(x=>x.question_id===i.question_id&&x.version===i.version) || null,
        optionOrder: i.option_ids, item: i.public_payload, answerOptionId: i.answer_option_id,
        // Correct answers and reviews only once the run is final.
        result: final ? { correct: i.correct, correctOptionId: i.correct_option_id, review: i.review_payload } : null,
      })),
    };
  }
}

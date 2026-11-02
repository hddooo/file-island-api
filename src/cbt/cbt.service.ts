import {cbtFirstRoundReward} from './cbt-policy';
import { boundedGrowth } from '../common/growth-floor';
import type { CbtPauseDto, CbtSubmitDto } from './cbt.dto';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AppError, notFound } from '../common/app-error';
import { CLOCK, type Clock } from '../common/tokens';
import { iso, requireUuid, sha256 } from '../common/util';
import { lockOwner } from '../common/owner-lock';
import { DbService } from '../db/db.service';
import { AttemptsRepository, type AttemptRow } from '../attempts/attempts.repository';
import type { QuestionRow } from '../questions/questions.repository';
import { CbtAssetsService } from './cbt-assets.service';
import {
  CBT_DURATION_MS, CBT_ROUNDS, CBT_SIZE, CBT_TOTAL_POINTS, checkRound, commonImage, initialPart, isMixedEra, questionImageName, resultOf, statsOf, stripAssets,
  type GradedItem,
} from './cbt-policy';
import { CbtRepository, type CbtItemRow, type CbtRunRow } from './cbt.repository';

const roundUnavailable = (round: number, reason: string) =>
  new AppError(409, 'round_unavailable', 'This round is not available for CBT', { round, reason });

/** Owner-locked original CBT. Legacy runs keep server-per-answer expiry behavior.
 * Batch practice keeps device drafts until one complete immutable submission. Pause is server-owned;
 * an expired batch remains pending until its frozen answers arrive, never graded prematurely as empty. */
@Injectable()
export class CbtService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly db: DbService,
    private readonly repo: CbtRepository,
    private readonly attempts: AttemptsRepository,
    private readonly assets: CbtAssetsService,
  ) {}

  async rounds(onlyRound?:number) {
    if(onlyRound!==undefined)this.assets.clearCatalogCache();
    const rows=await this.repo.allRoundQuestions(this.db.pool,CBT_ROUNDS);
    const selected=onlyRound===undefined?CBT_ROUNDS:[onlyRound];
    const rounds=await Promise.all(selected.map(async round=>{
      const c=checkRound(round,rows);
      const status=c.ok?await this.roundAssetsReady(round,c.rows,AbortSignal.timeout(3_000)):{ready:false,reason:c.reason};
      return {round,available:status.ready,checkState:status.ready?'ready':status.reason==='asset_check_timeout'?'check-delayed':c.ok?'assets-pending':'catalog-pending',retryable:!status.ready,...(status.ready?{}:{reason:status.reason}),questions:CBT_SIZE,totalPoints:CBT_TOTAL_POINTS,durationMs:CBT_DURATION_MS};
    }));
    return {batchSupported:true,readiness:'catalog-and-manifest',startVerifiesAllImages:true,rounds,imagesConfigured:this.assets.configured};
  }

  /** Read-only listing checks the catalog and registered public manifest (or full private files), including shared passages.
   * Full image bytes are checked at start; the manifest refreshes within5seconds, without501remote downloads. */
  private async roundAssetsReady(round: number, rows: QuestionRow[], signal: AbortSignal): Promise<{ready:boolean;reason?:string}> {
    if (!this.assets.configured) return {ready:false,reason:'assets_not_configured'};
    const names = new Set<string>();
    for (const row of rows) {
      names.add(questionImageName(round, row.exam_number!));
      const common = commonImage(round, row.exam_number!, row.public_payload);
      if (common) names.add(common.name);
    }
    try {
      await this.assets.verifyCatalog(names, signal);
      return {ready:true};
    } catch (e) {
      if (e instanceof AppError && ['asset_unavailable','asset_check_timeout'].includes(e.code)) return {ready:false,reason:e.code};
      throw e;
    }
  }

  /** Idempotent per (owner, idempotencyKey): concurrent or repeated creates return the same ready run. */
  async create(userId: string, dto: { round: number; idempotencyKey: string; answerMode?: string }) {
    return this.db.tx(async (q) => {
      await lockOwner(q, userId); // owner row first (an idempotent replay may finalize an overdue run)
      const now = this.clock.now();
      const existing = await this.repo.findByKey(q, userId, dto.idempotencyKey);
      if (existing) return this.replayCreate(q, existing, dto.round);
      const check = checkRound(dto.round, await this.repo.roundQuestions(q, dto.round));
      if (!check.ok) throw roundUnavailable(dto.round, check.reason);
      const id = randomUUID();
      if (!(await this.repo.insertRun(q, { id, userId, key: dto.idempotencyKey, round: dto.round, now, mode: dto.answerMode }))) {
        // Lost a race with the same key: the winner's row is committed and visible to this new statement.
        const winner = await this.repo.findByKey(q, userId, dto.idempotencyKey);
        if (!winner) throw new AppError(409, 'create_conflict', 'Try again');
        return this.replayCreate(q, winner, dto.round);
      }
      await this.repo.insertItems(q, id, userId, check.rows);
      return { created: true, ...(await this.view(q, (await this.repo.findOwned(q, id, userId))!)) };
    });
  }

  private async replayCreate(q: PoolClient, run: CbtRunRow, round: number) {
    if (run.exam_round !== round) throw new AppError(409, 'idempotency_conflict', 'This idempotency key was already used for another round');
    const locked = (await this.repo.findOwned(q, run.id, run.user_id, true))!;
    return { created: false, ...(await this.view(q, await this.expireIfDue(q, locked, this.clock.now()))) };
  }

  async list(userId: string) {
    const now = this.clock.now();
    for (const id of await this.repo.dueRunIds(this.db.pool, userId, now)) {
      await this.db.tx(async (q) => {
        await lockOwner(q, userId);
        const run = await this.repo.findOwned(q, id, userId, true);
        if (run) await this.expireIfDue(q, run, this.clock.now());
      });
    }
    const rows = await this.repo.listOwned(this.db.pool, userId);
    return { runs: rows.map((r) => ({ ...this.summary(r, now), answered: r.answered })), serverTime: now.toISOString() };
  }

  async get(userId: string, id: string) {
    return this.locked(userId, id, async (q, run) => this.view(q, run));
  }

  async start(userId: string, id: string) {
    return this.locked(userId, id, async (q, run) => {
      if (run.status === 'ready') {
        const names = new Set<string>();
        for (const item of await this.repo.items(q, run.id)) {
          names.add(questionImageName(run.exam_round, item.exam_number));
          const common = commonImage(run.exam_round, item.exam_number, item.public_payload);
          if (common) names.add(common.name);
        }
        // Do not start the clock if any original image is absent or fails its private integrity check.
        await this.assets.verify(names);
        const started = this.clock.now();
        await this.repo.start(q, run.id, started, new Date(started.getTime() + CBT_DURATION_MS));
        run = (await this.repo.findOwned(q, run.id, userId))!;
      }
      return this.view(q, run);
    });
  }

  async answer(userId: string, id: string, position: number, optionId: string | null) {
    return this.editActive(userId, id, async (q, run, now) => {
      const item = (await this.repo.items(q, run.id)).find((i) => i.position === position);
      if (!item) throw new AppError(404, 'no_such_item', 'This run has no such position');
      if (optionId !== null && !item.option_ids.includes(optionId)) throw new AppError(400, 'invalid_option', 'This option does not belong to the question');
      await this.repo.setAnswer(q, run.id, position, optionId, now);
      const fresh = (await this.repo.findOwned(q, run.id, userId))!;
      const items = await this.repo.items(q, run.id);
      return { run: { ...this.summary(fresh, now), answered: items.filter((i) => i.answer_option_id !== null).length }, item: this.publicItem(fresh, items[position]) };
    });
  }

  async go(userId: string, id: string, position: number) {
    return this.editActive(userId, id, async (q, run, now) => {
      await this.repo.setCurrent(q, run.id, position, now);
      const fresh = (await this.repo.findOwned(q, run.id, userId))!;
      const items = await this.repo.items(q, run.id);
      return { run: { ...this.summary(fresh, now), answered: items.filter((i) => i.answer_option_id !== null).length }, item: this.publicItem(fresh, items[position]) };
    });
  }

  async batch(userId: string, id: string) {
    return this.locked(userId,id,async(q,run)=>{
      if(run.status !== 'final' && run.answer_mode !== 'batch') {
        await q.query("UPDATE hanq.cbt_runs SET answer_mode='batch' WHERE id=$1",[run.id]);
        run=(await this.repo.findOwned(q,run.id,userId))!;
      }
      return this.view(q,run);
    });
  }

  async pause(userId: string,id: string,resume: boolean,dto: CbtPauseDto = {}) {
    return this.locked(userId,id,async(q,run,now)=>{
      if(run.status !== 'active' || run.answer_mode !== 'batch') throw new AppError(409,'run_not_active','Start a batch run first');
      if(!resume && (dto.answers !== undefined || dto.submissionKey !== undefined)) {
        if(!dto.submissionKey || !dto.answers || dto.answers.length!==CBT_SIZE) throw new AppError(400,'invalid_batch','Exactly fifty answers and a key are required');
        const answers=[...dto.answers].sort((a,b)=>a.position-b.position),items=await this.repo.items(q,run.id);
        if(answers.some((a,i)=>a.position!==i || (a.optionId!==null && !items[i].option_ids.includes(a.optionId)))) throw new AppError(400,'invalid_batch','Answers must match the stored questions');
        const position=dto.currentPosition ?? run.current_position;
        const hash=sha256(JSON.stringify([answers.map(a=>[a.position,a.optionId]),position,dto.checkpointVersion ?? null])).toString('hex');
        if(run.pause_submission_key===dto.submissionKey) {
          if(run.pause_payload_hash!==hash) throw new AppError(409,'pause_conflict','The pause key already has different answers');
          return this.view(q,run); // A delayed duplicate after resume must not pause again.
        }
        if(run.paused_at) throw new AppError(409,'run_paused','This run is already paused');
        if(dto.checkpointVersion!==undefined && dto.checkpointVersion!==run.checkpoint_version) throw new AppError(409,'checkpoint_conflict','Load the latest saved run before pausing');
        const remaining=Math.max(0,run.ends_at!.getTime()-now.getTime());
        if(!remaining) throw new AppError(409,'run_expired','Time is over');
        await q.query(`UPDATE hanq.cbt_run_items i SET answer_option_id=a.option_id,answered_at=CASE WHEN a.option_id IS NULL THEN NULL ELSE $4::timestamptz END
          FROM unnest($2::int[],$3::text[]) a(position,option_id) WHERE i.run_id=$1 AND i.position=a.position`,[run.id,answers.map(a=>a.position),answers.map(a=>a.optionId),now]);
        await q.query(`UPDATE hanq.cbt_runs SET paused_at=$2,pause_remaining_ms=$3,updated_at=$2,
          current_position=$4,checkpoint_version=checkpoint_version+1,pause_submission_key=$5,pause_payload_hash=$6 WHERE id=$1`,[run.id,now,remaining,position,dto.submissionKey,hash]);
        return this.view(q,(await this.repo.findOwned(q,run.id,userId))!);
      }
      if(resume && run.paused_at) {
        const delta=Math.max(0,now.getTime()-run.paused_at.getTime());
        await q.query(`UPDATE hanq.cbt_runs SET paused_total_ms=paused_total_ms+$2,
          ends_at=started_at+make_interval(secs=>duration_ms/1000)+(paused_total_ms+$2)*interval '1 millisecond',
          paused_at=NULL,pause_remaining_ms=NULL,updated_at=$3 WHERE id=$1`,[run.id,delta,now]);
      } else if(!resume && !run.paused_at) {
        const remaining=Math.max(0,run.ends_at!.getTime()-now.getTime());
        if(!remaining) throw new AppError(409,'run_expired','Time is over');
        await q.query('UPDATE hanq.cbt_runs SET paused_at=$2,pause_remaining_ms=$3,updated_at=$2 WHERE id=$1',[run.id,now,remaining]);
      }
      return this.view(q,(await this.repo.findOwned(q,run.id,userId))!);
    });
  }

  /** Freeze all fifty answers and receipt before grading in the same owner-locked transaction. */
  async submit(userId: string, id: string, dto: CbtSubmitDto = {}) {
    return this.locked(userId, id, async (q, run, now) => {
      if (run.status === 'ready') throw new AppError(409, 'run_not_started', 'Start the run first');
      if(run.answer_mode === 'batch') {
        if(!dto.submissionKey || !dto.answers || dto.answers.length!==CBT_SIZE) throw new AppError(400,'invalid_batch','Exactly fifty answers and a submission key are required');
        const answers=[...dto.answers].sort((a,b)=>a.position-b.position), items=await this.repo.items(q,run.id);
        if(answers.some((a,i)=>a.position!==i || (a.optionId!==null && !items[i].option_ids.includes(a.optionId)))) throw new AppError(400,'invalid_batch','Answers must match all stored questions');
        const hash=sha256(JSON.stringify([answers.map(a=>[a.position,a.optionId]),dto.currentPosition ?? run.current_position])).toString('hex');
        if(run.status==='final') {
          if(run.batch_submission_key!==dto.submissionKey || run.batch_payload_hash!==hash) throw new AppError(409,'submission_conflict','This run already has another submission');
          return this.view(q,run);
        }
        if(run.paused_at) throw new AppError(409,'run_paused','Resume before submitting');
        await q.query(`UPDATE hanq.cbt_run_items i SET answer_option_id=a.option_id,answered_at=CASE WHEN a.option_id IS NULL THEN NULL ELSE $4::timestamptz END
          FROM unnest($2::int[],$3::text[]) a(position,option_id) WHERE i.run_id=$1 AND i.position=a.position`,[run.id,answers.map(a=>a.position),answers.map(a=>a.optionId),now]);
        await q.query('UPDATE hanq.cbt_runs SET batch_submission_key=$2,batch_payload_hash=$3,current_position=$4 WHERE id=$1',[run.id,dto.submissionKey,hash,dto.currentPosition ?? run.current_position]);
        const expired=now.getTime()>=run.ends_at!.getTime();
        run=await this.finalize(q,run,expired?run.ends_at!:now,expired?'expired':'submit',now);
      } else if(run.status==='active') run=await this.finalize(q,run,now,'submit',now);
      return this.view(q,run);
    });
  }

  /** Image file name for an owned, started (active or final) run position. The file itself is read outside the lock. */
  async image(userId: string, id: string, position: number, which: 'question' | 'common'): Promise<Buffer> {
    const name = await this.locked(userId, id, async (q, run) => {
      if (run.status === 'ready') throw new AppError(409, 'run_not_started', 'Start the run first');
      if(run.paused_at || (run.status==='active' && run.answer_mode==='batch' && run.ends_at!.getTime()<=this.clock.now().getTime())) throw new AppError(409,'run_paused','Questions are hidden while paused or awaiting submission');
      const item = (await this.repo.items(q, run.id)).find((i) => i.position === position);
      if (!item) throw new AppError(404, 'no_such_item', 'This run has no such position');
      if (which === 'question') return questionImageName(run.exam_round, item.exam_number);
      const common = commonImage(run.exam_round, item.exam_number, item.public_payload);
      if (!common) throw new AppError(404, 'no_common_image', 'This question has no shared image');
      return common.name;
    });
    return this.assets.read(name);
  }

  /** Own statistics over all final runs (same rules as a single result). */
  async stats(userId: string) {
    await this.list(userId); // Settle the owner's overdue sessions before computing their analysis.
    await this.list(userId); // finalizes anything already past its deadline
    const rows = await this.repo.finalItems(this.db.pool, userId);
    const graded = rows.map((r) => this.graded(r));
    return { runs: new Set(rows.map((r) => r.run_id)).size, questions: graded.length, ...statsOf(graded) };
  }

  // ---- internals ----

  private async locked<T>(userId: string, id: string, fn: (q: PoolClient, run: CbtRunRow, now: Date) => Promise<T>): Promise<T> {
    const runId = requireUuid(id);
    return this.db.tx(async (q) => {
      await lockOwner(q, userId); // owner row, then the run row (same order as every attempt-writing path)
      let run = await this.repo.findOwned(q, runId, userId, true);
      if (!run) throw notFound();
      // A queued request can cross the deadline while waiting for these locks.
      const now = this.clock.now();
      run = await this.expireIfDue(q, run, now);
      return fn(q, run, now);
    });
  }

  /** Edits are refused once final; a late edit finalizes (committed) and is then rejected without being saved. */
  private async editActive<T>(userId: string, id: string, fn: (q: PoolClient, run: CbtRunRow, now: Date) => Promise<T>): Promise<T> {
    const out = await this.locked(userId, id, async (q, run, now) => {
      if (run.status === 'final') return { final: true as const, reason: run.final_reason };
      if (run.status !== 'active') throw new AppError(409, 'run_not_started', 'Start the run first');
      if(run.answer_mode==='batch') throw new AppError(409,'batch_required','Submit answers as one batch');
      return { final: false as const, value: await fn(q, run, now) };
    });
    if (out.final) {
      throw out.reason === 'expired'
        ? new AppError(409, 'run_expired', 'Time is over; the run was graded with the answers saved before the deadline')
        : new AppError(409, 'run_final', 'This run is already graded');
    }
    return out.value;
  }

  private async expireIfDue(q: PoolClient, run: CbtRunRow, now: Date): Promise<CbtRunRow> {
    if (run.answer_mode !== 'batch' && run.status === 'active' && run.ends_at && now.getTime() >= run.ends_at.getTime()) return this.finalize(q, run, run.ends_at, 'expired', now);
    return run;
  }

  /** One transaction: grade the 50 items against the stored version, write exactly one attempt per item
   *  (source 'run', run_id NULL, cbt_run_id = run, submission id cbt-<run>-<position>, unanswered = NULL option and wrong),
   *  then store the immutable result and ONE final-score growth row (kind 'cbt-exam', event 'cbt:<run>', unique cbt_run_id) in
   *  the same transaction. Status guard + row lock + unique submission ids + the ledger's unique keys make it happen once.
   *  No per-question growth (these attempts are source 'run' and never pass through submitPractice). If 009 is missing the
   *  ledger insert fails and the whole finalization rolls back (503 schema_not_ready) — never a final run without its reward.
   *  `at` (deadline on expiry) stays the grading cut-off, finalAt, result time and ledger time; the 50 attempts are recorded at
   *  `confirmedAt` (server clock now) so the wrong-note 24 h cooldown starts at the real confirmation, never backdated. */
  private async finalize(q: PoolClient, run: CbtRunRow, at: Date, reason: 'submit' | 'expired', confirmedAt: Date): Promise<CbtRunRow> {
    const items = await this.repo.items(q, run.id);
    const graded: GradedItem[] = [];
    for (const it of items) {
      const answered = it.answer_option_id !== null && (run.answer_mode === 'batch' || (!!it.answered_at && it.answered_at.getTime() < run.ends_at!.getTime()));
      const optionId = answered ? it.answer_option_id : null;
      const correct = optionId !== null && optionId === it.correct_option_id;
      const submissionId = `cbt-${run.id}-${it.position}`;
      const payloadHash = sha256(JSON.stringify([it.question_id, it.version, optionId, 'run', 'cbt', run.id]));
      let attempt: AttemptRow | null = await this.attempts.insert(q, {
        id: randomUUID(), userId: run.user_id, submissionId, questionId: it.question_id, version: it.version,
        optionId, correct, source: 'run', runId: null, cbtRunId: run.id, payloadHash, now: confirmedAt,
      });
      if (attempt && !attempt.correct) await q.query('UPDATE hanq.wrong_note_review_state SET correct_streak = 0 WHERE user_id = $1 AND question_id = $2 AND correct_streak <> 0', [run.user_id, it.question_id]); // a NEW CBT wrong breaks the study streak
      attempt ??= await this.attempts.findBySubmission(q, run.user_id, submissionId);
      if (!attempt) throw new AppError(409, 'grading_conflict', 'Try again');
      await this.repo.gradeItem(q, run.id, it.position, attempt.correct, attempt.id);
      graded.push({ position: it.position, era: it.era, part: initialPart(it.review_payload), points: it.points, answered, correct: attempt.correct });
    }
    const policyResult = resultOf(run.exam_round, graded, reason, at);
    // Every finalization holds lockOwner before the run lock. Concurrent runs of the same owner
    // therefore see the first committed final for this round; historical finals consume the slot too.
    const previous=await q.query('SELECT 1 FROM hanq.cbt_runs WHERE user_id=$1 AND exam_round=$2 AND status=\'final\' AND id<>$3 LIMIT 1',[run.user_id,run.exam_round,run.id]);
    const rewardEligible=previous.rows.length===0,policyGrowthReward=rewardEligible?cbtFirstRoundReward(policyResult.score):0;
    const result = {...policyResult,growthPolicy:'round-first-score-bands-v1',rewardEligible,policyGrowthReward,growthReward:await boundedGrowth(q,run.user_id,policyGrowthReward)};
    await this.repo.finalize(q, run.id, at, reason, result);
    await q.query(
      `INSERT INTO hanq.growth_ledger (user_id, event_key, kind, amount, cbt_run_id, created_at) VALUES ($1, 'cbt:' || $2::uuid::text, 'cbt-exam', $3, $2::uuid, $4)`,
      [run.user_id, run.id, result.growthReward, at],
    );
    return (await this.repo.findOwned(q, run.id, run.user_id))!;
  }

  private graded(it: CbtItemRow): GradedItem {
    return { position: it.position, era: it.era, part: initialPart(it.review_payload), points: it.points, answered: it.correct !== null && it.answer_option_id !== null, correct: it.correct === true };
  }

  private summary(r: CbtRunRow, now: Date) {
    return {
      id: r.id,
      round: r.exam_round,
      title: `제${r.exam_round}회 한국사능력검정시험 (심화) CBT`,
      status: r.status,
      answerMode: r.answer_mode === 'batch' ? 'batch' : 'server',
      paused: !!r.paused_at,
      checkpointVersion: r.checkpoint_version,
      pauseSubmissionKey: r.pause_submission_key,
      questions: CBT_SIZE,
      totalPoints: CBT_TOTAL_POINTS,
      durationMs: r.duration_ms,
      currentPosition: r.current_position,
      createdAt: iso(r.created_at),
      startedAt: iso(r.started_at),
      endsAt: iso(r.ends_at),
      finalAt: iso(r.final_at),
      finalReason: r.final_reason,
      remainingMs: r.status === 'active' && r.ends_at ? r.paused_at ? r.pause_remaining_ms : Math.max(0, r.ends_at.getTime() - now.getTime()) : null,
      serverTime: now.toISOString(),
      result: r.status === 'final' ? r.result : null,
    };
  }

  /** Strict whitelist before grading: ids, numbering, points, option ids/numbers and protected image endpoints only.
   *  No option text, answer, correct flag, review or stored (static) image path. */
  private publicItem(run: CbtRunRow, i: CbtItemRow) {
    const base = `/api/v1/cbt/runs/${run.id}/questions/${i.position}`;
    const common = commonImage(run.exam_round, i.exam_number, i.public_payload);
    return {
      position: i.position,
      questionId: i.question_id,
      version: i.version,
      exam: run.exam_round,
      number: i.exam_number,
      points: i.points,
      options: i.option_ids.map((id, k) => ({ id, number: k + 1 })),
      image: `${base}/image`,
      common: common ? { image: `${base}/common`, questionNumbers: common.numbers } : null,
      selectedOptionId: i.answer_option_id,
      answeredAt: iso(i.answered_at),
    };
  }

  private async view(q: PoolClient, run: CbtRunRow) {
    const now = this.clock.now();
    const items = await this.repo.items(q, run.id);
    const final = run.status === 'final';
    const eras = final ? await this.repo.validEraIds(q) : new Set<string>();
    return {
      run: { ...this.summary(run, now), answered: items.filter((i) => i.answer_option_id !== null).length },
      items: items.map((i) => {
        const pub = this.publicItem(run, i);
        if (!final) return pub;
        return { ...pub, review: this.review(i, eras) };
      }),
    };
  }

  /** Only for the owner's FINAL run: full review of all five original options, asset references stripped. */
  private review(i: CbtItemRow, validEras: Set<string>) {
    const g = this.graded(i);
    const rawOptions = Array.isArray(i.review_payload.options) ? (i.review_payload.options as unknown[]) : [];
    const optionOf = (id: string, k: number): Record<string, unknown> => {
      const isRec = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
      const byId = rawOptions.find((o) => isRec(o) && o.id === id);
      return isRec(byId) ? byId : isRec(rawOptions[k]) ? rawOptions[k] : {};
    };
    const era = isMixedEra(i.era) ? null : i.era;
    const link = era && validEras.has(era) ? { eraId: era, wrongNotes: { kind: 'mock' as const, era } } : null;
    return {
      status: !g.answered ? 'unanswered' : g.correct ? 'correct' : 'wrong',
      correct: g.correct,
      earned: g.correct ? i.points : 0,
      correctOptionId: i.correct_option_id,
      correctNumber: i.option_ids.indexOf(i.correct_option_id) + 1,
      options: i.option_ids.map((id, k) => {
        const o = optionOf(id, k);
        return {
          id,
          number: k + 1,
          text: typeof o.text === 'string' ? stripAssets(o.text) ?? null : null,
          correct: id === i.correct_option_id,
          selected: id === i.answer_option_id && g.answered,
          explanation: stripAssets(o.review ?? o.explanation ?? o.why ?? null) ?? null,
        };
      }),
      era,
      part: g.part,
      partVerified: false,
      link,
      item: stripAssets(i.review_payload),
    };
  }
}

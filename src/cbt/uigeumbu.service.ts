import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError, notFound } from '../common/app-error';
import { lockOwner } from '../common/owner-lock';
import { CLOCK, type Clock } from '../common/tokens';
import { iso, requireUuid } from '../common/util';
import { DbService, type Queryable } from '../db/db.service';
import { assertWrongResetGeneration, learningResetStatus } from '../profile/learning-resets';
import { CbtAssetsService } from './cbt-assets.service';
import { formalCatalogSql } from './cbt-official-versions';
import { CBT_MAX_ROUND, CBT_MIN_ROUND, commonImage, questionImageName, stripAssets } from './cbt-policy';
import { UIGEUMBU_MAX_ITEMS, type CreateUigeumbuReviewDto, type CreateUigeumbuSessionDto, type UigeumbuAnswerDto, type UigeumbuPositionDto, type UigeumbuStarDto, type UigeumbuStarResetDto, type UigeumbuSubmitDto, type UigeumbuTripleResetDto } from './uigeumbu.dto';

type Scope = 'all'|'last-wrong'|'round-review';
interface Session {
 id:string; user_id:string; scope:Scope; parent_id:string|null; status:'active'|'final'|'abandoned'; current_position:number;
 created_at:Date; final_at:Date|null; result:Record<string,unknown>|null;
}
interface Item {
 position:number; question_id:string; version:string; exam_round:number; exam_number:number; points:number; option_ids:string[];
 answer_option_id:string|null; checked:boolean; correct:boolean|null; correct_option_id:string;
 public_payload:Record<string,unknown>; review_payload:Record<string,unknown>; era:string|null; starred:boolean; triple:boolean;
}
type Candidate = Pick<Item,'question_id'|'version'|'exam_round'|'exam_number'|'points'|'option_ids'>;

const VISIBLE = `hanq.wrong_history_visible(s.user_id,'history',s.created_at)`;
const MAIN = `s.scope IN ('all','last-wrong')`;
/** A real mistake on any version of the question, from an official CBT exam, a CBT partial review, a paper import,
 * a book report or an earlier Uigeumbu session. Unanswered items and other islands' practice never count. */
const EVER_WRONG = `(
 EXISTS(SELECT 1 FROM hanq.visible_wrong_attempts a WHERE a.user_id=$1 AND a.question_id=v.question_id AND NOT a.correct AND a.option_id IS NOT NULL AND (a.cbt_run_id IS NOT NULL OR a.cbt_review_id IS NOT NULL))
 OR EXISTS(SELECT 1 FROM hanq.cbt_run_items i JOIN hanq.cbt_runs r ON r.id=i.run_id AND r.user_id=i.user_id WHERE i.user_id=$1 AND i.question_id=v.question_id AND i.correct=false AND r.status='final' AND coalesce(r.result->>'paperImported','false')='true' AND hanq.wrong_history_visible(r.user_id,'history',r.created_at))
 OR EXISTS(SELECT 1 FROM hanq.visible_manual_wrong_notes m WHERE m.user_id=$1 AND m.question_id=v.question_id AND m.source_key LIKE 'book-manual/%')
 OR EXISTS(SELECT 1 FROM hanq.cbt_mixed_review_items x JOIN hanq.cbt_mixed_reviews s ON s.id=x.review_id AND s.user_id=x.user_id WHERE x.user_id=$1 AND x.question_id=v.question_id AND s.status='final' AND x.correct=false AND ${VISIBLE})
)`;
/** A question the owner marks with a Uigeumbu triple star (★★★), its own marks kept apart from CBT stars. */
const TRIPLE = `EXISTS(SELECT 1 FROM hanq.uigeumbu_stars ts WHERE ts.user_id=$1 AND ts.question_id=v.question_id AND ts.starred AND hanq.wrong_history_visible(ts.user_id,'history',ts.updated_at))`;
/** "모든 문제 다시 풀기": every ever-wrong question plus every Uigeumbu ★★★ question (CBT exam stars are not part of Uigeumbu). */
const POOL_SQL =`SELECT v.question_id,v.version,v.exam_round,v.exam_number,v.points,v.option_ids FROM hanq.question_versions v
 WHERE ${formalCatalogSql('v')} AND v.kind='mock' AND v.exam_round BETWEEN ${CBT_MIN_ROUND} AND ${CBT_MAX_ROUND} AND (${EVER_WRONG} OR ${TRIPLE})
 ORDER BY v.exam_round,v.exam_number LIMIT ${UIGEUMBU_MAX_ITEMS+1}`;
/** "내 약점 개념": how many times the owner really got each pooled question wrong — official CBT answers, CBT partial
 * reviews, paper imports, book reports and checked Uigeumbu answers (any session that was not abandoned). Read only. */
const WEAKNESS_SQL =`SELECT v.question_id,v.version,v.exam_round,v.exam_number,
 ((SELECT count(*) FROM hanq.visible_wrong_attempts a WHERE a.user_id=$1 AND a.question_id=v.question_id AND NOT a.correct AND a.option_id IS NOT NULL AND (a.cbt_run_id IS NOT NULL OR a.cbt_review_id IS NOT NULL))
 +(SELECT count(*) FROM hanq.cbt_run_items i JOIN hanq.cbt_runs r ON r.id=i.run_id AND r.user_id=i.user_id WHERE i.user_id=$1 AND i.question_id=v.question_id AND i.correct=false AND r.status='final' AND coalesce(r.result->>'paperImported','false')='true' AND hanq.wrong_history_visible(r.user_id,'history',r.created_at))
 +(SELECT count(*) FROM hanq.visible_manual_wrong_notes m WHERE m.user_id=$1 AND m.question_id=v.question_id AND m.source_key LIKE 'book-manual/%')
 +(SELECT count(*) FROM hanq.cbt_mixed_review_items x JOIN hanq.cbt_mixed_reviews s ON s.id=x.review_id AND s.user_id=x.user_id WHERE x.user_id=$1 AND x.question_id=v.question_id AND s.status<>'abandoned' AND x.checked AND x.correct=false AND ${VISIBLE}))::int misses,
 ${TRIPLE} triple
 FROM hanq.question_versions v
 WHERE ${formalCatalogSql('v')} AND v.kind='mock' AND v.exam_round BETWEEN ${CBT_MIN_ROUND} AND ${CBT_MAX_ROUND} AND (${EVER_WRONG} OR ${TRIPLE})
 ORDER BY misses DESC,v.exam_round,v.exam_number LIMIT ${UIGEUMBU_MAX_ITEMS}`;

/** Uigeumbu (의금부): untimed mixed-round practice of the owner's CBT mistakes, with its own submitted history.
 * Every session is checked one question at a time like the CBT wrong/star review: answers are included for practice,
 * and each submitted answer is locked server-side.
 * Writes only cbt_mixed_reviews/_items and the owner's existing question stars; never attempts, growth, exams or reviews. */
@Injectable()
export class UigeumbuService {
 constructor(private readonly db:DbService,@Inject(CLOCK) private readonly clock:Clock,private readonly assets:CbtAssetsService) {}

 private async pool(q:Queryable,userId:string){return (await q.query<Candidate>(POOL_SQL,[userId])).rows;}
 private async owned(q:Queryable,userId:string,id:string,lock=false){
  const row=(await q.query<Session>(`SELECT s.* FROM hanq.cbt_mixed_reviews s WHERE s.id=$1 AND s.user_id=$2 AND s.status<>'abandoned' AND ${VISIBLE}${lock?' FOR UPDATE':''}`,[requireUuid(id),userId])).rows[0];
  if(!row)throw notFound();return row;
 }
 private async items(q:Queryable,userId:string,id:string){
  return (await q.query<Item>(`SELECT i.*,v.correct_option_id,v.public_payload,v.review_payload,v.era,
   coalesce((SELECT st.starred FROM hanq.cbt_question_stars st WHERE st.user_id=i.user_id AND st.question_id=i.question_id AND st.version=i.version AND hanq.wrong_history_visible(st.user_id,'history',st.updated_at)),false) starred,
   coalesce((SELECT ts.starred FROM hanq.uigeumbu_stars ts WHERE ts.user_id=i.user_id AND ts.question_id=i.question_id AND hanq.wrong_history_visible(ts.user_id,'history',ts.updated_at)),false) triple
   FROM hanq.cbt_mixed_review_items i JOIN hanq.question_versions v ON v.question_id=i.question_id AND v.version=i.version
   WHERE i.review_id=$1 AND i.user_id=$2 ORDER BY i.position`,[id,userId])).rows;
 }
 /** Round number among the owner's visible submitted main sessions (1 = oldest). */
 private async sequence(q:Queryable,s:Session){
  if(s.scope==='round-review'||s.status!=='final')return null;
  return (await q.query<{n:number}>(`SELECT count(*)::int n FROM hanq.cbt_mixed_reviews s WHERE s.user_id=$1 AND s.status='final' AND ${MAIN} AND ${VISIBLE} AND (s.final_at,s.id)<=($2,$3)`,[s.user_id,s.final_at,s.id])).rows[0].n;
 }
 private sessionView(s:Session,items:Item[],sequence:number|null,resetAt:string|null){
  return {id:s.id,kind:'uigeumbu',scope:s.scope,parentId:s.parent_id,sequence,status:s.status,checkMode:true,currentPosition:Math.min(s.current_position,Math.max(items.length-1,0)),
   createdAt:iso(s.created_at),finalAt:iso(s.final_at),result:s.result,total:items.length,answered:items.filter(i=>i.answer_option_id!==null).length,resetAt};
 }
 private itemView(s:Session,i:Item){
  const base=`/api/v1/cbt/uigeumbu/sessions/${s.id}/questions/${i.position}`,common=commonImage(i.exam_round,i.exam_number,i.public_payload);
  const item={position:i.position,questionId:i.question_id,version:i.version,exam:i.exam_round,number:i.exam_number,points:i.points,era:i.era,
   options:i.option_ids.map((id,k)=>({id,number:k+1})),selectedOptionId:i.answer_option_id,checked:i.checked,starred:i.starred,tripleStarred:i.triple,
   image:base+'/image',common:common?{image:base+'/common',questionNumbers:common.numbers}:null};
  const correct=i.answer_option_id!==null&&i.answer_option_id===i.correct_option_id;
  return {...item,review:{status:i.answer_option_id===null?'unanswered':correct?'correct':'wrong',correct,correctNumber:i.option_ids.indexOf(i.correct_option_id)+1,correctOptionId:i.correct_option_id,item:stripAssets(i.review_payload),
   options:i.option_ids.map((id,k)=>({id,number:k+1,selected:id===i.answer_option_id,correct:id===i.correct_option_id}))}};
 }
 private async view(q:Queryable,s:Session){
  const items=await this.items(q,s.user_id,s.id),resetAt=(await learningResetStatus(q,s.user_id)).history.resetAt;
  return {session:this.sessionView(s,items,await this.sequence(q,s),resetAt),items:items.map(i=>this.itemView(s,i))};
 }

 /** Every pooled question with the owner's real miss count, most-missed first (read only). */
 async weakness(userId:string){
  const rows=(await this.db.pool.query<{question_id:string;version:string;exam_round:number;exam_number:number;misses:number;triple:boolean}>(WEAKNESS_SQL,[userId])).rows;
  return {items:rows.map(r=>({questionId:r.question_id,version:r.version,exam:r.exam_round,number:r.exam_number,misses:r.misses,tripleStarred:r.triple}))};
 }
 async summary(userId:string){
  return this.db.tx(async q=>{
   const pool=await this.pool(q,userId);
   const finals=(await q.query<Session & {seq:number;total:number;wrong:number}>(`SELECT * FROM (SELECT s.*,row_number() OVER(ORDER BY s.final_at,s.id)::int seq,
     (SELECT count(*)::int FROM hanq.cbt_mixed_review_items i WHERE i.review_id=s.id AND i.user_id=s.user_id) total,
     (SELECT count(*)::int FROM hanq.cbt_mixed_review_items i WHERE i.review_id=s.id AND i.user_id=s.user_id AND i.correct IS NOT TRUE) wrong
     FROM hanq.cbt_mixed_reviews s WHERE s.user_id=$1 AND s.status='final' AND ${MAIN} AND ${VISIBLE}) ranked ORDER BY seq DESC LIMIT 10`,[userId])).rows;
   const reviews=finals.length?(await q.query<Session & {total:number}>(`SELECT s.*,(SELECT count(*)::int FROM hanq.cbt_mixed_review_items i WHERE i.review_id=s.id AND i.user_id=s.user_id) total
     FROM hanq.cbt_mixed_reviews s WHERE s.user_id=$1 AND s.status='final' AND s.parent_id=ANY($2::uuid[]) AND ${VISIBLE} ORDER BY s.final_at,s.id`,[userId,finals.map(f=>f.id)])).rows:[];
   const active=(await q.query<Session & {total:number;answered:number}>(`SELECT s.*,(SELECT count(*)::int FROM hanq.cbt_mixed_review_items i WHERE i.review_id=s.id AND i.user_id=s.user_id) total,
     (SELECT count(answer_option_id)::int FROM hanq.cbt_mixed_review_items i WHERE i.review_id=s.id AND i.user_id=s.user_id) answered
     FROM hanq.cbt_mixed_reviews s WHERE s.user_id=$1 AND s.status='active' AND ${VISIBLE} ORDER BY s.created_at DESC,s.id LIMIT 1`,[userId])).rows[0];
   const stars=(await q.query<{n:number}>(`SELECT count(DISTINCT st.question_id)::int n FROM hanq.cbt_question_stars st WHERE st.user_id=$1 AND st.starred AND hanq.wrong_history_visible(st.user_id,'history',st.updated_at)`,[userId])).rows[0].n;
   const tripleStars=(await q.query<{n:number}>(`SELECT count(*)::int n FROM hanq.uigeumbu_stars ts WHERE ts.user_id=$1 AND ts.starred AND hanq.wrong_history_visible(ts.user_id,'history',ts.updated_at)`,[userId])).rows[0].n;
   const score=(r:Record<string,unknown>|null)=>({correct:Number(r?.correct)||0,wrong:Number(r?.wrong)||0,unanswered:Number(r?.unanswered)||0});
   return {
    resetAt:(await learningResetStatus(q,userId)).history.resetAt,
    pool:{all:Math.min(pool.length,UIGEUMBU_MAX_ITEMS),hasMore:pool.length>UIGEUMBU_MAX_ITEMS},stars,tripleStars,
    last:finals[0]?{id:finals[0].id,sequence:finals[0].seq,wrong:finals[0].wrong}:null,
    active:active?{id:active.id,scope:active.scope,parentId:active.parent_id,total:active.total,answered:active.answered,createdAt:iso(active.created_at)}:null,
    rounds:finals.map(f=>({id:f.id,sequence:f.seq,scope:f.scope,createdAt:iso(f.created_at),finalAt:iso(f.final_at),total:f.total,missed:f.wrong,...score(f.result),
     reviews:reviews.filter(r=>r.parent_id===f.id).map(r=>({id:r.id,createdAt:iso(r.created_at),finalAt:iso(r.final_at),total:r.total,...score(r.result)}))})),
   };
  });
 }
 private async open(q:Queryable,userId:string,key:string,scope:Scope,parentId:string|null,rows:Candidate[]){
  if(!rows.length)throw new AppError(409,'review_empty','No wrong or starred questions to practice');
  if(rows.length>UIGEUMBU_MAX_ITEMS)throw new AppError(409,'uigeumbu_too_large','Too many questions for one session');
  const names=new Set<string>();for(const i of rows){names.add(questionImageName(i.exam_round,i.exam_number));}
  await this.assets.verify(names);
  // One open session per owner: an unfinished one is closed (kept, never graded) when a new one starts.
  await q.query(`UPDATE hanq.cbt_mixed_reviews SET status='abandoned' WHERE user_id=$1 AND status='active'`,[userId]);
  const id=randomUUID();
  await q.query(`INSERT INTO hanq.cbt_mixed_reviews(id,user_id,idempotency_key,scope,parent_id,status,created_at) VALUES($1,$2,$3,$4,$5,'active',$6)`,[id,userId,key,scope,parentId,this.clock.now()]);
  if(rows.some(r=>!Array.isArray(r.option_ids)||r.option_ids.length!==5))throw new AppError(409,'question_options_unavailable','Question options are unavailable');
  await q.query(`INSERT INTO hanq.cbt_mixed_review_items(review_id,user_id,position,question_id,version,exam_round,exam_number,points,option_ids)
   SELECT $1,$2,u.ord-1,u.question_id,u.version,u.exam_round,u.exam_number,u.points,($8::text[])[(u.ord-1)*5+1:u.ord*5]
   FROM unnest($3::text[],$4::text[],$5::int[],$6::int[],$7::int[]) WITH ORDINALITY u(question_id,version,exam_round,exam_number,points,ord)`,
   [id,userId,rows.map(r=>r.question_id),rows.map(r=>r.version),rows.map(r=>r.exam_round),rows.map(r=>r.exam_number),rows.map(r=>r.points),rows.flatMap(r=>r.option_ids)]);
  return this.view(q,await this.owned(q,userId,id));
 }
 private async replay(q:Queryable,userId:string,key:string){
  const old=(await q.query<Session>('SELECT * FROM hanq.cbt_mixed_reviews WHERE user_id=$1 AND idempotency_key=$2',[userId,key])).rows[0];
  return old;
 }
 async create(userId:string,dto:CreateUigeumbuSessionDto){
  return this.db.tx(async q=>{
   await lockOwner(q,userId);
   const key=dto.scope+'|'+dto.idempotencyKey,old=await this.replay(q,userId,key);
   if(old){if(old.status==='abandoned')throw new AppError(409,'idempotency_conflict','Key already used');return this.view(q,old);}
   let rows:Candidate[];
   if(dto.scope==='all')rows=await this.pool(q,userId);
   else{
    const last=(await q.query<{id:string}>(`SELECT s.id FROM hanq.cbt_mixed_reviews s WHERE s.user_id=$1 AND s.status='final' AND ${MAIN} AND ${VISIBLE} ORDER BY s.final_at DESC,s.id DESC LIMIT 1`,[userId])).rows[0];
    if(!last)throw new AppError(409,'no_previous_round','No submitted Uigeumbu round yet');
    rows=(await q.query<Candidate>(`SELECT question_id,version,exam_round,exam_number,points,option_ids FROM hanq.cbt_mixed_review_items WHERE review_id=$1 AND user_id=$2 AND correct IS NOT TRUE ORDER BY position`,[last.id,userId])).rows;
   }
   return this.open(q,userId,key,dto.scope,null,rows);
  });
 }
 async createReview(userId:string,parentId:string,dto:CreateUigeumbuReviewDto){
  return this.db.tx(async q=>{
   await lockOwner(q,userId);
   const parent=await this.owned(q,userId,parentId);
   if(parent.scope==='round-review'||parent.status!=='final')throw new AppError(409,'review_parent_invalid','Only a submitted Uigeumbu round can be reviewed');
   const key='round-review|'+dto.idempotencyKey,old=await this.replay(q,userId,key);
   if(old){if(old.parent_id!==parent.id||old.status==='abandoned')throw new AppError(409,'idempotency_conflict','Key already used');return this.view(q,old);}
   const rows=(await this.items(q,userId,parent.id)).filter(i=>i.correct!==true||i.triple);
   return this.open(q,userId,key,'round-review',parent.id,rows);
  });
 }
 async get(userId:string,id:string){return this.db.tx(async q=>this.view(q,await this.owned(q,userId,id)));}
 private async active(q:Queryable,userId:string,id:string){
  await lockOwner(q,userId);const s=await this.owned(q,userId,id,true);
  if(s.status!=='active')throw new AppError(409,'session_closed','This Uigeumbu session is already submitted');return s;
 }
 async answer(userId:string,id:string,dto:UigeumbuAnswerDto){
  return this.db.tx(async q=>{
   const s=await this.active(q,userId,id),items=await this.items(q,userId,id),i=items[dto.position];
   if(!i)throw notFound();
   if(dto.optionId!==null&&!i.option_ids.includes(dto.optionId))throw new AppError(400,'invalid_option','Unknown option for this question');
   if(i.checked){if(dto.optionId===i.answer_option_id)return {session:this.sessionView(s,items,null,null),item:this.itemView(s,i)};throw new AppError(409,'answer_checked','This answer was already checked');}
   const check=dto.optionId!==null,now=this.clock.now();
   await q.query(`UPDATE hanq.cbt_mixed_review_items SET answer_option_id=$4,checked=$5,correct=$6,answered_at=$7 WHERE review_id=$1 AND user_id=$2 AND position=$3`,
    [id,userId,dto.position,dto.optionId,check,check?dto.optionId===i.correct_option_id:null,dto.optionId===null?null:now]);
   await q.query('UPDATE hanq.cbt_mixed_reviews SET current_position=$3 WHERE id=$1 AND user_id=$2',[id,userId,dto.position]);
   Object.assign(i,{answer_option_id:dto.optionId,checked:check,correct:check?dto.optionId===i.correct_option_id:null});s.current_position=dto.position;
   return {session:this.sessionView(s,items,null,null),item:this.itemView(s,i)};
  });
 }
 async position(userId:string,id:string,dto:UigeumbuPositionDto){
  return this.db.tx(async q=>{
   const s=await this.active(q,userId,id),n=(await q.query<{n:number}>('SELECT count(*)::int n FROM hanq.cbt_mixed_review_items WHERE review_id=$1 AND user_id=$2',[id,userId])).rows[0].n;
   if(dto.currentPosition>=n)throw notFound();
   await q.query('UPDATE hanq.cbt_mixed_reviews SET current_position=$3 WHERE id=$1 AND user_id=$2',[id,userId,dto.currentPosition]);
   return {id:s.id,currentPosition:dto.currentPosition};
  });
 }
 async submit(userId:string,id:string,dto:UigeumbuSubmitDto){
  return this.db.tx(async q=>{
   await lockOwner(q,userId);const s=await this.owned(q,userId,id,true);
   if(s.status==='final'){if(s.result?.submissionKey!==dto.submissionKey)throw new AppError(409,'submission_conflict','This session already has its submission');return this.view(q,s);}
   const items=await this.items(q,userId,id),now=this.clock.now();let correct=0,wrong=0,unanswered=0;
   for(const i of items){
    const good=i.answer_option_id===null?null:i.answer_option_id===i.correct_option_id;
    if(good===null)unanswered++;else if(good)correct++;else wrong++;
    await q.query('UPDATE hanq.cbt_mixed_review_items SET correct=$4 WHERE review_id=$1 AND user_id=$2 AND position=$3',[id,userId,i.position,good]);
   }
   const result={kind:'uigeumbu',scope:s.scope,total:items.length,answered:correct+wrong,correct,wrong,unanswered,submissionKey:dto.submissionKey,growthReward:0,growthPolicy:'none'};
   await q.query(`UPDATE hanq.cbt_mixed_reviews SET status='final',final_at=$3,result=$4 WHERE id=$1 AND user_id=$2`,[id,userId,now,JSON.stringify(result)]);
   return this.view(q,await this.owned(q,userId,id));
  });
 }
 async star(userId:string,id:string,dto:UigeumbuStarDto){
  return this.db.tx(async q=>{
   await lockOwner(q,userId);const s=await this.owned(q,userId,id);
   const i=(await this.items(q,userId,s.id))[dto.position];if(!i)throw notFound();
   await assertWrongResetGeneration(q,userId,'history',dto.resetAt);
   await q.query(`INSERT INTO hanq.cbt_question_stars(user_id,question_id,version,starred,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,question_id,version) DO UPDATE SET starred=EXCLUDED.starred,updated_at=EXCLUDED.updated_at`,[userId,i.question_id,i.version,dto.starred,this.clock.now()]);
   return {position:dto.position,starred:dto.starred};
  });
 }
 /** Uigeumbu ★★★ on one question of the owner's session (any status except abandoned). */
 async triple(userId:string,id:string,dto:UigeumbuStarDto){
  return this.db.tx(async q=>{
   await lockOwner(q,userId);const s=await this.owned(q,userId,id);
   const i=(await this.items(q,userId,s.id))[dto.position];if(!i)throw notFound();
   await assertWrongResetGeneration(q,userId,'history',dto.resetAt);
   await q.query(`INSERT INTO hanq.uigeumbu_stars(user_id,question_id,version,starred,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,question_id) DO UPDATE SET version=EXCLUDED.version,starred=EXCLUDED.starred,updated_at=EXCLUDED.updated_at`,[userId,i.question_id,i.version,dto.starred,this.clock.now()]);
   return {position:dto.position,tripleStarred:dto.starred};
  });
 }
 /** Clears only the owner's Uigeumbu ★★★ (CBT exam/review stars are untouched). */
 async resetTriple(userId:string,dto:UigeumbuTripleResetDto){
  return this.db.tx(async q=>{
   await lockOwner(q,userId);await assertWrongResetGeneration(q,userId,'history',dto.resetAt);
   const t=await q.query(`UPDATE hanq.uigeumbu_stars SET starred=false,updated_at=$2 WHERE user_id=$1 AND starred`,[userId,this.clock.now()]);
   return {tripleStars:t.rowCount??0};
  });
 }
 /** Clears every CBT question star of the owner (exam, review and Uigeumbu share them). Rows stay as false so an old device import never revives them. */
 async resetStars(userId:string,dto:UigeumbuStarResetDto){
  return this.db.tx(async q=>{
   await lockOwner(q,userId);await assertWrongResetGeneration(q,userId,'history',dto.resetAt);
   const now=this.clock.now(),r=await q.query(`UPDATE hanq.cbt_question_stars SET starred=false,updated_at=$2 WHERE user_id=$1 AND starred`,[userId,now]);
   const t=await q.query(`UPDATE hanq.uigeumbu_stars SET starred=false,updated_at=$2 WHERE user_id=$1 AND starred`,[userId,now]);
   return {cleared:(r.rowCount??0)+(t.rowCount??0),stars:r.rowCount??0,tripleStars:t.rowCount??0};
  });
 }
 async image(userId:string,id:string,position:number,which:'question'|'common'){
  const s=await this.owned(this.db.pool,userId,id);
  const i=(await this.db.pool.query<Pick<Item,'exam_round'|'exam_number'|'public_payload'>>(`SELECT i.exam_round,i.exam_number,v.public_payload FROM hanq.cbt_mixed_review_items i JOIN hanq.question_versions v ON v.question_id=i.question_id AND v.version=i.version WHERE i.review_id=$1 AND i.user_id=$2 AND i.position=$3`,[s.id,userId,position])).rows[0];
  if(!i)throw notFound();const common=commonImage(i.exam_round,i.exam_number,i.public_payload);
  if(which==='common'&&!common)throw notFound();
  return this.assets.read(which==='common'?common!.name:questionImageName(i.exam_round,i.exam_number));
 }
}

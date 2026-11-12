import {assertWrongResetGeneration, learningResetStatus} from '../profile/learning-resets';
import {awardHistoryAttempt} from '../common/history-growth';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AppError, notFound } from '../common/app-error';
import { lockOwner } from '../common/owner-lock';
import { CLOCK, type Clock } from '../common/tokens';
import { iso, requireUuid, sha256 } from '../common/util';
import { DbService, type Queryable } from '../db/db.service';
import { CbtAssetsService } from './cbt-assets.service';
import { commonImage, questionImageName, stripAssets } from './cbt-policy';
import type { CbtReviewAnswersDto, CbtStarDto, CbtStarImportDto, CreateCbtReviewDto } from './cbt-review.dto';

type Origin = 'exam' | 'review';
interface Item {
 position:number; question_id:string; version:string; exam_number:number; points:number; option_ids:string[];
 answer_option_id:string|null; correct:boolean|null; correct_option_id:string;
 public_payload:Record<string,unknown>; review_payload:Record<string,unknown>; era:string|null;
}
interface Review {
 id:string; user_id:string; exam_round:number; status:'ready'|'active'|'final'; current_position:number;
 checkpoint_version:number; pause_submission_key:string|null; paused_at:Date|null; created_at:Date; started_at:Date|null; final_at:Date|null;
 submission_key:string|null; submission_hash:Buffer|null; result:Record<string,unknown>|null;
}
export const reviewSignature = (items:Pick<Item,'question_id'|'version'|'option_ids'>[]) =>
 JSON.stringify(items.map(i=>[i.question_id,i.version,i.option_ids]));

/** Owner-scoped stars and untimed partial reviews. Reads never expire/finalize an exam.
 * Partial grading appends ordinary answered attempts, linked to a separate session; no full-exam score or growth reward. */
@Injectable()
export class CbtReviewService {
 constructor(private readonly db:DbService,@Inject(CLOCK) private readonly clock:Clock,private readonly assets:CbtAssetsService) {}

 private async source(q:Queryable,userId:string,id:string,origin:Origin,token?:string) {
  const table=origin==='exam'?'cbt_runs':'cbt_reviews',itemTable=origin==='exam'?'cbt_run_items':'cbt_review_items',fk=origin==='exam'?'run_id':'review_id';
  const run=(await q.query<{exam_round:number;status:string;attempt_policy?:string;attempt_token_hash?:string}>(`SELECT * FROM hanq.${table} WHERE id=$1 AND user_id=$2${origin==='review'?" AND hanq.wrong_history_visible(user_id,'history',created_at)":''}`, [requireUuid(id),userId])).rows[0];
  if(!run)throw notFound();
  if(origin==='exam'&&run.status!=='final'&&(run.status!=='active'||run.attempt_policy!=='uninterrupted-v1'||!token||sha256(token).toString('hex')!==run.attempt_token_hash))throw new AppError(409,'attempt_session_required','Active exam requires its document token');
  const items=(await q.query<Item>(`SELECT i.*,v.correct_option_id,v.public_payload,v.review_payload,v.era FROM hanq.${itemTable} i JOIN hanq.question_versions v ON v.question_id=i.question_id AND v.version=i.version WHERE i.${fk}=$1 AND i.user_id=$2 ORDER BY i.position`,[id,userId])).rows;
  return {round:run.exam_round,items};
 }
 private async starsView(q:Queryable,userId:string,items:Item[]) {
  const rows=(await q.query<{question_id:string;version:string;starred:boolean}>(`SELECT s.question_id,s.version,s.starred FROM hanq.cbt_question_stars s JOIN unnest($2::text[],$3::text[]) p(question_id,version) USING(question_id,version) WHERE s.user_id=$1 AND hanq.wrong_history_visible(s.user_id,'history',s.updated_at)`,[userId,items.map(i=>i.question_id),items.map(i=>i.version)])).rows;
  const map=new Map(rows.map(s=>[JSON.stringify([s.question_id,s.version]),s.starred]));
  return {resetAt:(await learningResetStatus(q,userId)).history.resetAt,signature:reviewSignature(items),flags:items.map(i=>map.get(JSON.stringify([i.question_id,i.version]))===true)};
 }
 async stars(userId:string,id:string,origin:Origin,token?:string) {return this.db.tx(async q=>{await lockOwner(q,userId);return this.starsView(q,userId,(await this.source(q,userId,id,origin,token)).items);});}
 async saveStar(userId:string,id:string,origin:Origin,dto:CbtStarDto,token?:string) {
  return this.db.tx(async q=>{
   await lockOwner(q,userId);const {items}=await this.source(q,userId,id,origin,token);
   if(dto.signature!==reviewSignature(items))throw new AppError(409,'star_signature_mismatch','Question versions or option order changed');
   const item=items[dto.position];if(!item)throw notFound();
   await assertWrongResetGeneration(q,userId,'history',dto.resetAt);
   await q.query(`INSERT INTO hanq.cbt_question_stars(user_id,question_id,version,starred,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,question_id,version) DO UPDATE SET starred=EXCLUDED.starred,updated_at=EXCLUDED.updated_at`,[userId,item.question_id,item.version,dto.starred,this.clock.now()]);
   return this.starsView(q,userId,items);
  });
 }
 async importStars(userId:string,id:string,origin:Origin,dto:CbtStarImportDto,token?:string) {
  return this.db.tx(async q=>{
   await lockOwner(q,userId);const {items}=await this.source(q,userId,id,origin,token);
   if(dto.signature!==reviewSignature(items)||dto.flags.length!==items.length)throw new AppError(409,'star_signature_mismatch','Question versions or option order changed');
   if((await learningResetStatus(q,userId)).history.resetAt)return this.starsView(q,userId,items);
   const receipt=await q.query(`INSERT INTO hanq.cbt_star_imports(user_id,origin,source_id,signature,imported_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING source_id`,[userId,origin,id,dto.signature,this.clock.now()]);
   if(receipt.rowCount)for(const item of items)if(dto.flags[item.position])await q.query(`INSERT INTO hanq.cbt_question_stars(user_id,question_id,version,starred,updated_at) VALUES($1,$2,$3,true,$4) ON CONFLICT DO NOTHING`,[userId,item.question_id,item.version,this.clock.now()]);
   return this.starsView(q,userId,items);
  });
 }
 private async owned(q:Queryable,userId:string,id:string,locked=false) {
  const row=(await q.query<Review>(`SELECT * FROM hanq.cbt_reviews WHERE id=$1 AND user_id=$2 AND hanq.wrong_history_visible(user_id,'history',created_at)${locked?' FOR UPDATE':''}`,[requireUuid(id),userId])).rows[0];
  if(!row)throw notFound();return row;
 }
 private async transaction<T>(userId:string,id:string,fn:(q:PoolClient,r:Review,items:Item[])=>Promise<T>) {
  return this.db.tx(async q=>{await lockOwner(q,userId);const r=await this.owned(q,userId,id,true);return fn(q,r,(await this.source(q,userId,id,'review')).items);});
 }
 async create(userId:string,dto:CreateCbtReviewDto) {
  return this.db.tx(async q=>{
   await lockOwner(q,userId);
   const key=dto.selection==='exam-wrong-only'?'exam-wrong-only|'+dto.idempotencyKey:dto.idempotencyKey;
   const old=(await q.query<Review>('SELECT * FROM hanq.cbt_reviews WHERE user_id=$1 AND idempotency_key=$2',[userId,key])).rows[0];
   if(old){if(old.exam_round!==dto.round)throw new AppError(409,'idempotency_conflict','Key used for another round');return this.view(q,old);}
   // Cumulative real wrong answers, across full exams + partial reviews + practice. A later correct never removes one.
   // Exact versions only; neither an unasked item nor an unanswered submission manufactures a mistake.
   const wrongOnly=dto.selection==='exam-wrong-only';
   const rows=wrongOnly?(await q.query<Item>(`SELECT * FROM (SELECT DISTINCT ON (i.question_id) i.question_id,i.version,i.exam_number,i.points,i.option_ids,v.correct_option_id,v.public_payload,v.review_payload,v.era FROM hanq.cbt_run_items i JOIN hanq.cbt_runs r ON r.id=i.run_id AND r.user_id=i.user_id JOIN hanq.question_versions v ON v.question_id=i.question_id AND v.version=i.version WHERE i.user_id=$1 AND r.exam_round=$2 AND r.status='final' AND i.correct=false AND hanq.wrong_history_visible(r.user_id,'history',r.created_at) AND i.answer_option_id IS NOT NULL ORDER BY i.question_id,r.final_at DESC,r.id DESC) picked ORDER BY exam_number`,[userId,dto.round])).rows:(await q.query<Item>(`SELECT v.question_id,v.version,v.exam_number,v.points,v.option_ids,v.correct_option_id,v.public_payload,v.review_payload,v.era FROM hanq.question_versions v WHERE v.is_current AND v.kind='mock' AND v.exam_round=$2 AND (EXISTS(SELECT 1 FROM hanq.visible_wrong_attempts a WHERE a.user_id=$1 AND a.question_id=v.question_id AND a.version=v.version AND NOT a.correct AND a.option_id IS NOT NULL) OR EXISTS(SELECT 1 FROM hanq.cbt_question_stars s WHERE s.user_id=$1 AND s.question_id=v.question_id AND s.version=v.version AND s.starred AND hanq.wrong_history_visible(s.user_id,'history',s.updated_at))) ORDER BY v.exam_number`,[userId,dto.round])).rows;
   if(!rows.length)throw new AppError(409,'review_empty','No wrong or starred questions in this round');
   const id=randomUUID();await q.query(`INSERT INTO hanq.cbt_reviews(id,user_id,idempotency_key,exam_round,status,created_at) VALUES($1,$2,$3,$4,'ready',$5)`,[id,userId,key,dto.round,this.clock.now()]);
   for(let pos=0;pos<rows.length;pos++){const i=rows[pos];await q.query(`INSERT INTO hanq.cbt_review_items(review_id,user_id,position,question_id,version,exam_number,points,option_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,userId,pos,i.question_id,i.version,i.exam_number,i.points,i.option_ids]);}
   return this.view(q,await this.owned(q,userId,id));
  });
 }
 /** Read-only revision-safe union. Active-only stars do not reveal exam answers. */
 async reviewMaterials(userId:string,round:number) {
  if(!Number.isInteger(round)||round<70||round>80)throw new AppError(404,'round_not_found','No such round');
  return this.db.tx(async q=>{
   await lockOwner(q,userId);
   const rows=(await q.query<Item & {run_id:string;exam_round:number;starred:boolean;ever_wrong:boolean}>(`WITH candidates AS (
    SELECT i.*,r.exam_round,r.final_at,v.correct_option_id,v.public_payload,v.review_payload,v.era,
     coalesce(s.starred AND hanq.wrong_history_visible(s.user_id,'history',s.updated_at),false) material_starred,
     (i.correct=false AND i.answer_option_id IS NOT NULL AND hanq.wrong_history_visible(r.user_id,'history',r.created_at)) material_wrong
    FROM hanq.cbt_run_items i JOIN hanq.cbt_runs r ON r.id=i.run_id AND r.user_id=i.user_id
    JOIN hanq.question_versions v ON v.question_id=i.question_id AND v.version=i.version
    LEFT JOIN hanq.cbt_question_stars s ON s.user_id=i.user_id AND s.question_id=i.question_id AND s.version=i.version
    WHERE i.user_id=$1 AND r.status='final' AND r.exam_round=$2
   ), eligible AS (SELECT * FROM candidates WHERE material_starred OR material_wrong)
   SELECT DISTINCT ON(question_id) *,bool_or(material_starred) OVER(PARTITION BY question_id) starred,
    bool_or(material_wrong) OVER(PARTITION BY question_id) ever_wrong FROM eligible
   ORDER BY question_id,final_at DESC,run_id DESC LIMIT 51`,[userId,round])).rows;
   const pending=(await q.query<{n:number}>(`SELECT count(DISTINCT s.question_id)::int n FROM hanq.cbt_question_stars s JOIN hanq.question_versions v ON v.question_id=s.question_id AND v.version=s.version
    WHERE s.user_id=$1 AND s.starred AND v.kind='mock' AND v.exam_round=$2 AND hanq.wrong_history_visible(s.user_id,'history',s.updated_at)
    AND NOT EXISTS(SELECT 1 FROM hanq.cbt_run_items i JOIN hanq.cbt_runs r ON r.id=i.run_id AND r.user_id=i.user_id WHERE i.user_id=s.user_id AND i.question_id=s.question_id AND i.version=s.version AND r.status='final')`,[userId,round])).rows[0].n;
   return {scope:'exam-starred-or-ever-wrong',round,resetAt:(await learningResetStatus(q,userId)).history.resetAt,pendingStarCount:pending,limit:50,hasMore:rows.length>50,items:rows.slice(0,50).sort((a,b)=>a.exam_number-b.exam_number).map(i=>{
    const base='/api/v1/cbt/runs/'+i.run_id+'/questions/'+i.position,common=commonImage(round,i.exam_number,i.public_payload),correct=i.answer_option_id===i.correct_option_id;
    return {questionId:i.question_id,version:i.version,exam:round,number:i.exam_number,position:i.position,runId:i.run_id,points:i.points,
     starred:i.starred,everWrong:i.ever_wrong,selectedOptionId:i.answer_option_id,image:base+'/image',common:common?{image:base+'/common',questionNumbers:common.numbers}:null,
     options:i.option_ids.map((id,k)=>({id,number:k+1})),review:{status:!i.answer_option_id?'unanswered':correct?'correct':'wrong',correct,earned:correct?i.points:0,correctNumber:i.option_ids.indexOf(i.correct_option_id)+1,correctOptionId:i.correct_option_id,item:stripAssets(i.review_payload),options:i.option_ids.map((id,k)=>({id,number:k+1,selected:id===i.answer_option_id,correct:id===i.correct_option_id}))}};
   })};
  });
 }
 async notebook(userId:string) {
  const rows=(await this.db.pool.query<Item & {run_id:string;exam_round:number}>(`SELECT DISTINCT ON (i.question_id) i.*,r.exam_round,v.correct_option_id,v.public_payload,v.review_payload,v.era FROM hanq.cbt_run_items i JOIN hanq.cbt_runs r ON r.id=i.run_id AND r.user_id=i.user_id JOIN hanq.question_versions v ON v.question_id=i.question_id AND v.version=i.version WHERE i.user_id=$1 AND r.status='final' AND i.correct=false AND hanq.wrong_history_visible(r.user_id,'history',r.created_at) AND i.answer_option_id IS NOT NULL ORDER BY i.question_id,r.final_at DESC,r.id DESC LIMIT 501`,[userId])).rows;
  return {scope:'finalized-exam-selected-wrong',limit:500,hasMore:rows.length>500,items:rows.slice(0,500).sort((a,b)=>b.exam_round-a.exam_round||a.exam_number-b.exam_number).map(i=>{
   const base=`/api/v1/cbt/runs/${i.run_id}/questions/${i.position}`,common=commonImage(i.exam_round,i.exam_number,i.public_payload);
   return {questionId:i.question_id,version:i.version,exam:i.exam_round,number:i.exam_number,position:i.position,runId:i.run_id,points:i.points,selectedOptionId:i.answer_option_id,image:base+'/image',common:common?{image:base+'/common',questionNumbers:common.numbers}:null,options:i.option_ids.map((id,k)=>({id,number:k+1})),review:{status:'wrong',correct:false,earned:0,correctNumber:i.option_ids.indexOf(i.correct_option_id)+1,correctOptionId:i.correct_option_id,era:i.era,part:'기타',item:stripAssets(i.review_payload),options:i.option_ids.map((id,k)=>({id,number:k+1,selected:id===i.answer_option_id,correct:id===i.correct_option_id}))}};
  })};
 }
 async list(userId:string) {
  const rows=(await this.db.pool.query<Review & {questions:number;answered:number}>(`SELECT r.*,(SELECT count(*)::int FROM hanq.cbt_review_items i WHERE i.review_id=r.id AND i.user_id=r.user_id) questions,(SELECT count(answer_option_id)::int FROM hanq.cbt_review_items i WHERE i.review_id=r.id AND i.user_id=r.user_id) answered FROM hanq.cbt_reviews r WHERE r.user_id=$1 AND hanq.wrong_history_visible(r.user_id,'history',r.created_at) ORDER BY r.created_at DESC,r.id LIMIT 100`,[userId])).rows;
  return {reviews:rows.map(r=>({...this.summary(r),questions:r.questions,answered:r.answered}))};
 }
 async get(userId:string,id:string){return this.db.tx(async q=>this.view(q,await this.owned(q,userId,id)));}
 async start(userId:string,id:string) {
  return this.transaction(userId,id,async(q,r,items)=>{
   if(r.status==='ready'){
    const names=new Set<string>();for(const i of items){names.add(questionImageName(r.exam_round,i.exam_number));const common=commonImage(r.exam_round,i.exam_number,i.public_payload);if(common)names.add(common.name);}
    await this.assets.verify(names);await q.query(`UPDATE hanq.cbt_reviews SET status='active',started_at=$3 WHERE id=$1 AND user_id=$2`,[id,userId,this.clock.now()]);
   }
   return this.view(q,await this.owned(q,userId,id));
  });
 }
 private validate(r:Review,items:Item[],dto:CbtReviewAnswersDto) {
  if(r.status!=='active')throw new AppError(409,'review_not_active','Start this review first');
  if(dto.answers.length!==items.length||dto.currentPosition>=items.length||dto.answers.some((a,i)=>a.position!==i||(a.optionId!==null&&!items[i].option_ids.includes(a.optionId))))throw new AppError(400,'invalid_review_answers','One ordered answer per review item is required');
 }
 async checkpoint(userId:string,id:string,dto:CbtReviewAnswersDto) {
  return this.transaction(userId,id,async(q,r,items)=>{
   this.validate(r,items,dto);
   // Equal retries are harmless; a stale different draft must not overwrite a newer checkpoint.
   const identical=r.current_position===dto.currentPosition&&items.every((i,p)=>i.answer_option_id===dto.answers[p].optionId);
   if(!identical&&dto.checkpointVersion!==r.checkpoint_version)throw new AppError(409,'checkpoint_conflict','Reload the saved review');
   if(!identical)for(const a of dto.answers)await q.query('UPDATE hanq.cbt_review_items SET answer_option_id=$4 WHERE review_id=$1 AND user_id=$2 AND position=$3',[id,userId,a.position,a.optionId]);
   await q.query('UPDATE hanq.cbt_reviews SET current_position=$3,checkpoint_version=checkpoint_version+$4,paused_at=$5,pause_submission_key=$6 WHERE id=$1 AND user_id=$2',[id,userId,dto.currentPosition,identical?0:1,this.clock.now(),dto.submissionKey]);
   return this.view(q,await this.owned(q,userId,id));
  });
 }
 async resume(userId:string,id:string){return this.transaction(userId,id,async(q,r)=>{if(r.status==='active')await q.query('UPDATE hanq.cbt_reviews SET paused_at=NULL WHERE id=$1 AND user_id=$2',[id,userId]);return this.view(q,await this.owned(q,userId,id));});}
 async submit(userId:string,id:string,dto:CbtReviewAnswersDto) {
  return this.transaction(userId,id,async(q,r,items)=>{
   const hash=sha256(JSON.stringify([dto.answers,dto.currentPosition]));
   if(r.status==='final'){
    if(dto.submissionKey!==r.submission_key||!r.submission_hash?.equals(hash))throw new AppError(409,'submission_conflict','This review already has its immutable submission');
    return this.view(q,r);
   }
   this.validate(r,items,dto);let correct=0,wrong=0,unanswered=0,growthReward=0;
   const now=this.clock.now();
   for(const a of dto.answers){
    const item=items[a.position];let attemptId:string|null=null;let good:boolean|null=null;
    if(a.optionId===null)unanswered++;
    else{
     good=a.optionId===item.correct_option_id;if(good)correct++;else wrong++;attemptId=randomUUID();
     await q.query(`INSERT INTO hanq.attempts(id,user_id,submission_id,question_id,version,option_id,correct,source,payload_hash,created_at,cbt_review_id) VALUES($1,$2,$3,$4,$5,$6,$7,'run',$8,$9,$10)`,[attemptId,userId,`review-${id}-${a.position}`,item.question_id,item.version,a.optionId,good,sha256(JSON.stringify([item.question_id,item.version,a.optionId,'cbt-review',id])),now,id]);
     growthReward+=await awardHistoryAttempt(q,userId,attemptId,good,true,'mock',item.points,now);
    }
    await q.query(`UPDATE hanq.cbt_review_items SET answer_option_id=$4,correct=$5,answered_at=$6,attempt_id=$7 WHERE review_id=$1 AND user_id=$2 AND position=$3`,[id,userId,a.position,a.optionId,good,a.optionId===null?null:now,attemptId]);
   }
   const result={kind:'review',total:items.length,answered:correct+wrong,correct,wrong,unanswered,growthReward,growthPolicy:'per-question-original-points'};
   await q.query(`UPDATE hanq.cbt_reviews SET status='final',final_at=$3,current_position=$4,submission_key=$5,submission_hash=$6,result=$7 WHERE id=$1 AND user_id=$2`,[id,userId,now,dto.currentPosition,dto.submissionKey,hash,JSON.stringify(result)]);
   return this.view(q,await this.owned(q,userId,id));
  });
 }
 private summary(r:Review){return {id:r.id,kind:'review',round:r.exam_round,status:r.status,answerMode:'batch',currentPosition:r.current_position,checkpointVersion:r.checkpoint_version,pauseSubmissionKey:r.pause_submission_key,paused:!!r.paused_at,createdAt:iso(r.created_at),startedAt:iso(r.started_at),finalAt:iso(r.final_at),result:r.result};}
 private async view(q:Queryable,r:Review) {
  const {items}=await this.source(q,r.user_id,r.id,'review');
  return {run:{...this.summary(r),questions:items.length,answered:items.filter(i=>i.answer_option_id!==null).length},items:items.map(i=>{
   const base=`/api/v1/cbt/reviews/${r.id}/questions/${i.position}`,common=commonImage(r.exam_round,i.exam_number,i.public_payload);
   const item={position:i.position,questionId:i.question_id,version:i.version,exam:r.exam_round,number:i.exam_number,points:i.points,options:i.option_ids.map((id,k)=>({id,number:k+1})),selectedOptionId:i.answer_option_id,image:base+'/image',common:common?{image:base+'/common',questionNumbers:common.numbers}:null};
   if(r.status!=='final')return item;
   return {...item,review:{status:i.correct===null?'unanswered':i.correct?'correct':'wrong',correct:i.correct===true,earned:i.correct?i.points:0,correctNumber:i.option_ids.indexOf(i.correct_option_id)+1,correctOptionId:i.correct_option_id,era:i.era,part:'기타',item:stripAssets(i.review_payload),options:i.option_ids.map((id,k)=>({id,number:k+1,selected:id===i.answer_option_id,correct:id===i.correct_option_id}))}};
  })};
 }
 async image(userId:string,id:string,position:number,which:'question'|'common') {
  const {round,items}=await this.source(this.db.pool,userId,id,'review');const r=await this.owned(this.db.pool,userId,id);
  if(r.status==='ready')throw new AppError(409,'review_not_active','Start this review first');
  const i=items[position];if(!i)throw notFound();const common=commonImage(round,i.exam_number,i.public_payload);
  if(which==='common'&&!common)throw notFound();return this.assets.read(which==='common'?common!.name:questionImageName(round,i.exam_number));
 }
}


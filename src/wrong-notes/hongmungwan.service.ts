import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error';
import { CLOCK, type Clock } from '../common/tokens';
import { lockOwner } from '../common/owner-lock';
import { DbService, type Queryable } from '../db/db.service';
import { PremiumService } from '../premium/premium.service';
import { assertWrongResetGeneration, learningResetStatus } from '../profile/learning-resets';
import type { QuestionRow } from '../questions/questions.repository';
export const HONG_ERAS = ['prehistory','samguk','nambuk','goryeo','joseon','opening','colonial','modern'] as const;
export function hongEra(value: string | null): string | null {
 if (value === 'gojoseon') return 'prehistory';
 if (value === 'joseon-early' || value === 'joseon-late') return 'joseon';
 return HONG_ERAS.includes(value as typeof HONG_ERAS[number]) ? value : null;
}
type Source = QuestionRow & { personal_review: Record<string, unknown> | null };
const SOURCE = `SELECT v.*,CASE WHEN m.version=v.version AND m.review_payload->>'eraOverride' IN ('prehistory','samguk','nambuk','goryeo','joseon','opening','colonial','modern') THEN m.review_payload->>'eraOverride' ELSE v.era END AS era,CASE WHEN m.version=v.version THEN m.review_payload ELSE NULL END AS personal_review FROM hanq.manual_wrong_notes m
 JOIN hanq.question_versions v ON v.question_id=m.question_id AND v.is_current WHERE m.user_id=$1 AND m.source_key LIKE 'hongmungwan-workbook-v1:%'`;
export function hongReview(r: Source) {
 return {correctOptionId:r.correct_option_id,item:r.personal_review?.questionReview ?? r.review_payload};
}
@Injectable()
export class HongmungwanService {
 constructor(private readonly db: DbService, private readonly premium: PremiumService, @Inject(CLOCK) private readonly clock: Clock) {}
 private async source(q: Queryable, userId: string, questionId: string, version: string) {
  const r=(await q.query<Source>(SOURCE+' AND v.question_id=$2 AND v.version=$3',[userId,questionId,version])).rows[0];
  if(!r || !hongEra(r.era))throw new AppError(404,'question_not_found','Unknown personal Hongmungwan question');
  return r;
 }
 async list(userId:string,era?:string) {
  return this.db.tx(async q=>{
   await lockOwner(q,userId);
   await this.premium.assertActive(q,userId,this.clock.now());
   const resetAt=(await learningResetStatus(q,userId)).history.resetAt;
   const rows=(await q.query<Source>(SOURCE+' ORDER BY v.question_id',[userId])).rows;
   // These private manual sources survive reset; only personal practice history and stars are cleared.
   const answers=(await q.query<{question_id:string;version:string;correct:boolean}>(`SELECT question_id,version,correct FROM (
    SELECT question_id,version,correct,row_number() OVER(PARTITION BY question_id,version ORDER BY id DESC) n
    FROM hanq.hongmungwan_answers WHERE user_id=$1 AND hanq.wrong_history_visible(user_id,'history',created_at)
   ) a WHERE n<=3 ORDER BY question_id,version,n`,[userId])).rows;
   const wrongs=(await q.query<{question_id:string;version:string}>(`SELECT DISTINCT question_id,version FROM hanq.hongmungwan_answers
    WHERE user_id=$1 AND NOT correct AND hanq.wrong_history_visible(user_id,'history',created_at)`,[userId])).rows;
   const stars=(await q.query<{question_id:string;version:string}>(`SELECT question_id,version FROM hanq.hongmungwan_stars
    WHERE user_id=$1 AND starred AND hanq.wrong_history_visible(user_id,'history',updated_at)`,[userId])).rows;
   const key=(r:{question_id:string;version:string})=>JSON.stringify([r.question_id,r.version]);
   const wrong=new Set(wrongs.map(key)),star=new Set(stars.map(key));
   const history=new Map<string,boolean[]>();
   for(const a of answers){const k=key(a);history.set(k,[...(history.get(k)??[]),a.correct]);}
   const items=rows.filter(r=>hongEra(r.era)).map(r=>({questionId:r.question_id,version:r.version,era:hongEra(r.era),
    item:r.public_payload,review:hongReview(r),recentResults:history.get(key(r))??[],starred:star.has(key(r)),everWrong:wrong.has(key(r)),source:'book-manual'}));
   return {unassignedCount:rows.length-items.length,items:items.filter(r=>!era||r.era===era),eras:HONG_ERAS.map(id=>({id,count:items.filter(r=>r.era===id).length})),resetAt};
  });
 }
 async image(userId:string,questionId:string,version:string):Promise<Buffer> {
  await this.premium.assertActive(this.db.pool,userId,this.clock.now());
  await this.source(this.db.pool,userId,questionId,version);
  try {
   const configured=process.env.HANQ_HONGMUNGWAN_ASSET_DIR;
   if(!configured)throw new Error('missing');
   const root=await realpath(resolve(configured));
   const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8')) as {files:Record<string,{file:string;sha256:string}>};
   const entry=manifest.files[questionId+':'+version];
   if(!entry||!/^exam-\d{2}-\d{2}\.webp$/.test(entry.file)||!/^[a-f0-9]{64}$/.test(entry.sha256))throw new Error('missing');
   const file=await realpath(join(root,entry.file));
   if(dirname(file)!==root)throw new Error('escape');
   const info=await stat(file);if(!info.isFile()||info.size>8*1024*1024)throw new Error('size');
   const bytes=await readFile(file);
   if(bytes.toString('latin1',0,4)!=='RIFF'||bytes.toString('latin1',8,12)!=='WEBP'||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('integrity');
   return bytes;
  }catch{throw new AppError(503,'asset_unavailable','This original question image is not available');}
 } async answer(userId:string,dto:{questionId:string;version:string;optionId:string;submissionId:string;reviewOnly?:boolean;resetAt?:string|null}) {
  return this.db.tx(async q=>{
   await lockOwner(q,userId);const now=this.clock.now();await this.premium.assertActive(q,userId,now);
   const r=await this.source(q,userId,dto.questionId,dto.version);
   if(!r.option_ids.includes(dto.optionId))throw new AppError(400,'invalid_option','Invalid option');
   const correct=dto.optionId===r.correct_option_id;
   if(dto.reviewOnly)return {correct,correctOptionId:r.correct_option_id,review:hongReview(r),recorded:false};
   const old=(await q.query<{question_id:string;version:string;option_id:string;correct:boolean}>(
    'SELECT question_id,version,option_id,correct FROM hanq.hongmungwan_answers WHERE user_id=$1 AND submission_id=$2',[userId,dto.submissionId])).rows[0];
   if(old){
    if(old.question_id!==dto.questionId||old.version!==dto.version||old.option_id!==dto.optionId)throw new AppError(409,'submission_conflict','Submission already used');
    return {correct:old.correct,correctOptionId:r.correct_option_id,review:hongReview(r),recorded:true,replayed:true};
   }
   await assertWrongResetGeneration(q,userId,'history',dto.resetAt);
   await q.query('INSERT INTO hanq.hongmungwan_answers(user_id,question_id,version,submission_id,option_id,correct,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[userId,dto.questionId,dto.version,dto.submissionId,dto.optionId,correct,now]);
   return {correct,correctOptionId:r.correct_option_id,review:hongReview(r),recorded:true,replayed:false};
  });
 }
 async star(userId:string,dto:{questionId:string;version:string;starred:boolean;resetAt?:string|null}) {
  return this.db.tx(async q=>{
   await lockOwner(q,userId);const now=this.clock.now();await this.premium.assertActive(q,userId,now);
   await this.source(q,userId,dto.questionId,dto.version);await assertWrongResetGeneration(q,userId,'history',dto.resetAt);
   await q.query(`INSERT INTO hanq.hongmungwan_stars(user_id,question_id,version,starred,updated_at) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(user_id,question_id,version) DO UPDATE SET starred=EXCLUDED.starred,updated_at=EXCLUDED.updated_at`,[userId,dto.questionId,dto.version,dto.starred,now]);
   return {starred:dto.starred};
  });
 }
}

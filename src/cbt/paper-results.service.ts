import {Inject,Injectable} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {AppError,notFound} from '../common/app-error';
import {lockOwner} from '../common/owner-lock';
import {CLOCK,type Clock} from '../common/tokens';
import {iso,requireUuid,sha256hex} from '../common/util';
import {DbService} from '../db/db.service';
import type {QuestionRow} from '../questions/questions.repository';
import {CbtAssetsService} from './cbt-assets.service';
import {checkRound,commonImage,gradeOf,questionImageName,stripAssets} from './cbt-policy';
import type {CreatePaperResultDto} from './paper-results.dto';
interface PaperRow {id:string;user_id:string;exam_round:number;source:'paper-reported';reported_at:Date;payload_hash:string;score:number;correct_count:number;wrong_numbers:number[];}
interface Item extends QuestionRow {result_id:string;position:number;reported_correct:boolean;}
export function paperInput(dto:CreatePaperResultDto){
 if(dto.completed!==true||!Number.isInteger(dto.examRound)||dto.examRound<70||dto.examRound>80||!Array.isArray(dto.wrongNumbers)||dto.wrongNumbers.length>50||dto.wrongNumbers.some(n=>!Number.isInteger(n)||n<1||n>50)||new Set(dto.wrongNumbers).size!==dto.wrongNumbers.length||typeof dto.idempotencyKey!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/.test(dto.idempotencyKey))throw new AppError(400,'invalid_paper_result','Completed paper exam and unique question numbers are required');
 const wrongNumbers=[...dto.wrongNumbers].sort((a,b)=>a-b);
 return {wrongNumbers,hash:sha256hex(JSON.stringify([dto.examRound,wrongNumbers,'completed-paper-v1']))};
}
function summary(r:PaperRow){return {id:r.id,examRound:r.exam_round,source:r.source,reportedAt:iso(r.reported_at),score:r.score,maxScore:100,correctCount:r.correct_count,wrongCount:r.wrong_numbers.length,wrongNumbers:r.wrong_numbers,grade:gradeOf(r.score),selectedAnswersKnown:false};}
@Injectable()
export class PaperResultsService {
 constructor(private readonly db:DbService,@Inject(CLOCK) private readonly clock:Clock,private readonly assets:CbtAssetsService){}
 async create(owner:string,dto:CreatePaperResultDto){
  const input=paperInput(dto);
  return this.db.tx(async q=>{
   await lockOwner(q,owner);
   const old=(await q.query<PaperRow>('SELECT * FROM hanq.paper_exam_results WHERE user_id=$1 AND idempotency_key=$2',[owner,dto.idempotencyKey])).rows[0];
   if(old){if(old.payload_hash!==input.hash)throw new AppError(409,'paper_idempotency_conflict','This key already identifies another paper result');return {result:summary(old)};}
   const catalog=(await q.query<QuestionRow>("SELECT * FROM hanq.question_versions WHERE is_current AND kind='mock' AND exam_round=$1 ORDER BY exam_number",[dto.examRound])).rows;
   const checked=checkRound(dto.examRound,catalog);
   if(!checked.ok)throw new AppError(409,'paper_round_unavailable','The complete verified original round is unavailable');
   const wrong=new Set(input.wrongNumbers),score=checked.rows.reduce((n,v)=>n+(wrong.has(v.exam_number!)?0:v.points),0),id=randomUUID(),now=this.clock.now();
   const row=(await q.query<PaperRow>(`INSERT INTO hanq.paper_exam_results(id,user_id,idempotency_key,exam_round,reported_at,payload_hash,score,correct_count,wrong_numbers) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[id,owner,dto.idempotencyKey,dto.examRound,now,input.hash,score,50-wrong.size,input.wrongNumbers])).rows[0];
   for(const v of checked.rows)await q.query(`INSERT INTO hanq.paper_exam_result_items(result_id,user_id,position,question_id,version,exam_number,points,reported_correct) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,owner,v.exam_number!-1,v.question_id,v.version,v.exam_number,v.points,!wrong.has(v.exam_number!)]);
   return {result:summary(row)};
  });
 }
 async list(owner:string){const rows=(await this.db.pool.query<PaperRow>('SELECT * FROM hanq.paper_exam_results WHERE user_id=$1 ORDER BY reported_at DESC,id DESC LIMIT 201',[owner])).rows;return {items:rows.slice(0,200).map(summary),hasMore:rows.length>200};}
 async get(owner:string,id:string){const row=(await this.db.pool.query<PaperRow>('SELECT * FROM hanq.paper_exam_results WHERE user_id=$1 AND id=$2',[owner,requireUuid(id)])).rows[0];if(!row)throw notFound();return {result:summary(row)};}
 async notebook(owner:string){
  const rows=(await this.db.pool.query<Item>(`SELECT DISTINCT ON(i.question_id) v.*,i.result_id,i.position,i.points,i.reported_correct FROM hanq.paper_exam_result_items i JOIN hanq.paper_exam_results r ON r.id=i.result_id AND r.user_id=i.user_id JOIN hanq.question_versions v ON v.question_id=i.question_id AND v.version=i.version WHERE i.user_id=$1 AND i.reported_correct=false AND hanq.wrong_history_visible(r.user_id,'history',r.reported_at) ORDER BY i.question_id,r.reported_at DESC,r.id DESC LIMIT 501`,[owner])).rows;
  return {scope:'paper-reported-wrong',limit:500,hasMore:rows.length>500,items:rows.slice(0,500).sort((a,b)=>b.exam_round!-a.exam_round!||a.exam_number!-b.exam_number!).map(i=>{
   const base=`/api/v1/cbt/paper-results/${i.result_id}/questions/${i.position}`,common=commonImage(i.exam_round!,i.exam_number!,i.public_payload);
   return {questionId:i.question_id,version:i.version,exam:i.exam_round,number:i.exam_number,position:i.position,runId:i.result_id,source:'paper-reported',points:i.points,selectedOptionId:null,image:base+'/image',common:common?{image:base+'/common',questionNumbers:common.numbers}:null,options:i.option_ids.map((id,k)=>({id,number:k+1})),review:{status:'wrong',correct:false,earned:0,correctNumber:i.option_ids.indexOf(i.correct_option_id)+1,correctOptionId:i.correct_option_id,era:i.era,part:'기타',item:stripAssets(i.review_payload),options:i.option_ids.map((id,k)=>({id,number:k+1,selected:false,correct:id===i.correct_option_id}))}};
  })};
 }
 async image(owner:string,id:string,position:number,which:'image'|'common'){
  const row=(await this.db.pool.query<Item>(`SELECT v.*,i.position,i.result_id,i.reported_correct FROM hanq.paper_exam_result_items i JOIN hanq.paper_exam_results r ON r.id=i.result_id AND r.user_id=i.user_id JOIN hanq.question_versions v ON v.question_id=i.question_id AND v.version=i.version WHERE i.user_id=$1 AND i.result_id=$2 AND i.position=$3 AND hanq.wrong_history_visible(r.user_id,'history',r.reported_at)`,[owner,requireUuid(id),position])).rows[0];
  if(!row)throw notFound();const name=which==='image'?questionImageName(row.exam_round!,row.exam_number!):commonImage(row.exam_round!,row.exam_number!,row.public_payload)?.name;if(!name)throw notFound();return this.assets.read(name);
 }
}

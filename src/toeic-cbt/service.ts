import {learningOwner} from './learning-owner';
import {part5OptionStudy} from './part5-options';
import {paraphrasing} from './paraphrasing';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService, type Queryable } from '../db/db.service';
import { CLOCK,type Clock } from '../common/tokens';
import { AppError,notFound } from '../common/app-error';
import { lockOwner } from '../common/owner-lock';
import { iso,sha256hex } from '../common/util';
import { inspectCatalog,selectParts,privateImage,privateAudio,type ToeicCollection } from './catalog';
import { loadStudyHistory,questionKey } from './history';
import { part7Evidence } from './part7-evidence';
import type { CreateToeicRunDto,ToeicAnswerDto,ToeicCheckpointDto,ToeicSubmitDto } from './dto';
interface Collection {id:string;source_key:string;version:string;title:string;content:ToeicCollection;}
interface Run {verification?:boolean;id:string;user_id:string;collection_id:string;status:'ready'|'active'|'final';revision:number;cursor:number;paused:boolean;created_at:Date;started_at:Date|null;final_at:Date|null;submission_key:string|null;submission_hash:string|null;result:Record<string,unknown>|null;}
interface Item {position:number;question_number:number;selected_option:string|null;correct:boolean|null;}
@Injectable()
export class ToeicCbtService {
 constructor(private readonly db:DbService,@Inject(CLOCK) private readonly clock:Clock){}
 private async collection(q:Queryable,owner:string,id:string){const r=(await q.query<Collection>('SELECT * FROM hanq.toeic_cbt_collections WHERE user_id=$1 AND id=$2',[owner,id])).rows[0];if(!r)throw notFound();return r;}
 private async owned(q:Queryable,owner:string,id:string,lock=false){const r=(await q.query<Run>("SELECT r.*,EXISTS(SELECT 1 FROM hanq.toeic_cbt_verification_runs v WHERE v.user_id=r.user_id AND v.run_id=r.id) verification FROM hanq.toeic_cbt_runs r WHERE r.user_id=$1 AND r.id=$2"+(lock?' FOR UPDATE OF r':''),[owner,id])).rows[0];if(!r)throw notFound();return r;}
 private ensure(c:Collection,numbers?:number[]){const data=numbers?{...c.content,questions:c.content.questions.filter(q=>numbers.includes(q.number)),wrongNumbers:c.content.wrongNumbers.filter(n=>numbers.includes(n)),...(c.content.replayNumbers?{replayNumbers:numbers}:{})}:c.content;const check=inspectCatalog(data);if(!check.ready)throw new AppError(409,'toeic_material_pending','Verified source material is required',{missing:check.missing});return data;}
 private summary(r:Run,c:Collection){return{id:r.id,collectionId:c.id,roundKey:c.source_key,title:c.title,verification:r.verification===true,metadata:c.content.metadata||null,coverage:c.content.coverage||null,sourceVersion:c.version,status:r.status,revision:r.revision,cursor:r.cursor,paused:r.paused,createdAt:iso(r.created_at),startedAt:iso(r.started_at),finalAt:iso(r.final_at),result:r.result};}
 async image(viewer:string,collectionId:string,key:string){
  const owner=await learningOwner(this.db.pool,viewer);
  if(!/^[a-f0-9]{64}$/.test(key))throw notFound();
  await this.collection(this.db.pool,owner,collectionId);
  const row=(await this.db.pool.query<{bytes:Buffer;media_type:string}>('SELECT bytes,media_type FROM hanq.toeic_cbt_images WHERE user_id=$1 AND collection_id=$2 AND asset_key=$3',[owner,collectionId,key])).rows[0];
  if(!row)throw notFound();return row;
 }
 private async history(q:Queryable,owner:string){return loadStudyHistory(q,owner);}
 async collections(viewer:string){const owner=await learningOwner(this.db.pool,viewer);const rows=(await this.db.pool.query<Collection>(`SELECT DISTINCT ON(source_key) * FROM hanq.toeic_cbt_collections WHERE user_id=$1 ORDER BY source_key,created_at DESC,id DESC`,[owner])).rows;return{collections:rows.map(c=>({id:c.id,roundKey:c.source_key,title:c.title,metadata:c.content.metadata||null,studyAvailable:c.content.questions.every(q=>q.answerStatus==='assistant_inferred_not_officially_verified'),coverage:c.content.coverage||null,version:c.version,...inspectCatalog(c.content),parts:[1,2,3,4,5,6,7].map(part=>({part,...inspectCatalog(selectParts(c.content,[part]))}))}))};}
 async study(viewer:string,id:string){const owner=await learningOwner(this.db.pool,viewer);const c=await this.collection(this.db.pool,owner,id);if(!c.content.questions.every(q=>q.answerStatus==='assistant_inferred_not_officially_verified'))throw notFound();return{title:c.title,officiallyVerified:false,gradingEnabled:false,questions:c.content.questions};}
 async runs(owner:string){const rows=(await this.db.pool.query<Run>('SELECT r.*,EXISTS(SELECT 1 FROM hanq.toeic_cbt_verification_runs v WHERE v.user_id=r.user_id AND v.run_id=r.id) verification FROM hanq.toeic_cbt_runs r WHERE r.user_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 100',[owner])).rows;const runs=[];for(const r of rows)runs.push(this.summary(r,await this.collection(this.db.pool,owner,r.collection_id)));return{runs};}
 async create(owner:string,d:CreateToeicRunDto){return this.db.tx(async q=>{
  await lockOwner(q,owner);
  const old=(await q.query<Run>('SELECT * FROM hanq.toeic_cbt_runs WHERE user_id=$1 AND idempotency_key=$2',[owner,d.idempotencyKey])).rows[0];
  if(old){const original=(await q.query<Item>('SELECT * FROM hanq.toeic_cbt_items WHERE user_id=$1 AND run_id=$2 ORDER BY position',[owner,old.id])).rows;const prior=await this.collection(q,owner,old.collection_id);const selected=selectParts(prior.content,d.parts).questions.map(q=>q.number).sort((a,b)=>a-b);if(old.collection_id!==d.collectionId||JSON.stringify(original.map(i=>i.question_number))!==JSON.stringify(selected))throw new AppError(409,'idempotency_conflict','Key belongs to another collection');return this.view(q,old);}
  const c=await this.collection(q,owner,d.collectionId),data=this.ensure({...c,content:selectParts(c.content,d.parts)}),id=randomUUID();
  const r=(await q.query<Run>(`INSERT INTO hanq.toeic_cbt_runs(id,user_id,collection_id,idempotency_key,status,created_at) VALUES($1,$2,$3,$4,'ready',$5) RETURNING *`,[id,owner,c.id,d.idempotencyKey,this.clock.now()])).rows[0];
  const sorted=data.questions.filter(q=>(data.replayNumbers||data.wrongNumbers).includes(q.number)).sort((a,b)=>a.number-b.number);
  await q.query('INSERT INTO hanq.toeic_cbt_items(run_id,user_id,position,question_number) SELECT $1,$2,(n.ordinality-1)::int,n.number FROM unnest($3::int[]) WITH ORDINALITY AS n(number,ordinality)',[id,owner,sorted.map(item=>item.number)]);
  return this.view(q,r);
 });}
 async get(owner:string,id:string){return this.db.tx(async q=>this.view(q,await this.owned(q,owner,id)));}
 async start(owner:string,id:string){return this.db.tx(async q=>{
  await lockOwner(q,owner);const r=await this.owned(q,owner,id,true);this.practiceRun(r);this.ensure(await this.collection(q,owner,r.collection_id),(await q.query<Item>('SELECT * FROM hanq.toeic_cbt_items WHERE user_id=$1 AND run_id=$2 ORDER BY position',[owner,id])).rows.map(i=>i.question_number));
  if(r.status==='ready')await q.query("UPDATE hanq.toeic_cbt_runs SET status='active',started_at=$3,revision=revision+1 WHERE user_id=$1 AND id=$2",[owner,id,this.clock.now()]);
  return this.view(q,await this.owned(q,owner,id));
 });}
 private practiceRun(r:Run){if(r.verification)throw new AppError(409,'toeic_verification_readonly','Deployment verification is excluded from study; create a new practice run');}
 private validate(data:ToeicCollection,items:Item[],answers:ToeicAnswerDto[],cursor:number){
  if(answers.length!==items.length||cursor>=items.length||answers.some((a,i)=>a.position!==i||a.optionId!==null&&!data.questions.find(q=>q.number===items[i].question_number)?.choices.some(o=>o.id===a.optionId)))throw new AppError(400,'invalid_toeic_answers','One ordered answer per owned question is required');
 }
 async checkpoint(owner:string,id:string,d:ToeicCheckpointDto){return this.db.tx(async q=>{
  await lockOwner(q,owner);const r=await this.owned(q,owner,id,true);this.practiceRun(r);const c=await this.collection(q,owner,r.collection_id),data=this.ensure(c,(await q.query<Item>('SELECT * FROM hanq.toeic_cbt_items WHERE user_id=$1 AND run_id=$2 ORDER BY position',[owner,id])).rows.map(i=>i.question_number));
  if(r.status!=='active')throw new AppError(409,'toeic_not_active','Start this replay first');
  const items=(await q.query<Item>('SELECT * FROM hanq.toeic_cbt_items WHERE user_id=$1 AND run_id=$2 ORDER BY position',[owner,id])).rows;this.validate(data,items,d.answers,d.cursor);
  const same=r.cursor===d.cursor&&r.paused===d.paused&&items.every((it,i)=>it.selected_option===d.answers[i].optionId);
  if(same)return this.view(q,r);
  if(r.paused)throw new AppError(409,'toeic_paused','Resume before editing');
  if(r.revision!==d.revision)throw new AppError(409,'toeic_checkpoint_conflict','Reload the newer saved replay');
  await q.query('UPDATE hanq.toeic_cbt_items i SET selected_option=a."optionId" FROM jsonb_to_recordset($3::jsonb) AS a(position int,"optionId" text) WHERE i.user_id=$1 AND i.run_id=$2 AND i.position=a.position',[owner,id,JSON.stringify(d.answers)]);
  await q.query('UPDATE hanq.toeic_cbt_runs SET cursor=$3,paused=$4,revision=revision+1 WHERE user_id=$1 AND id=$2',[owner,id,d.cursor,d.paused]);return this.view(q,await this.owned(q,owner,id));
 });}
 async resume(owner:string,id:string,revision:number){return this.db.tx(async q=>{await lockOwner(q,owner);const r=await this.owned(q,owner,id,true);this.practiceRun(r);if(r.status!=='active')throw new AppError(409,'toeic_not_active','Replay is not active');if(r.paused){if(r.revision!==revision)throw new AppError(409,'toeic_checkpoint_conflict','Reload the newer replay');await q.query('UPDATE hanq.toeic_cbt_runs SET paused=false,revision=revision+1 WHERE user_id=$1 AND id=$2',[owner,id]);}return this.view(q,await this.owned(q,owner,id));});}
 async submit(owner:string,id:string,d:ToeicSubmitDto){return this.db.tx(async q=>{
  await lockOwner(q,owner);const r=await this.owned(q,owner,id,true);this.practiceRun(r);const c=await this.collection(q,owner,r.collection_id),data=this.ensure(c,(await q.query<Item>('SELECT * FROM hanq.toeic_cbt_items WHERE user_id=$1 AND run_id=$2 ORDER BY position',[owner,id])).rows.map(i=>i.question_number));
  const hash=sha256hex(JSON.stringify([d.answers,d.cursor]));
  if(r.status==='final'){if(r.submission_key!==d.submissionKey||r.submission_hash!==hash)throw new AppError(409,'toeic_submission_conflict','Replay is already finalized');return this.view(q,r);}
  if(r.status!=='active'||r.paused)throw new AppError(409,'toeic_not_active','Resume before submitting');
  if(r.revision!==d.revision)throw new AppError(409,'toeic_checkpoint_conflict','Reload newer answers before submitting');
  const items=(await q.query<Item>('SELECT * FROM hanq.toeic_cbt_items WHERE user_id=$1 AND run_id=$2 ORDER BY position',[owner,id])).rows;this.validate(data,items,d.answers,d.cursor);
  let correct=0,wrong=0,unanswered=0;
  const grades=d.answers.map(a=>{const item=data.questions.find(q=>q.number===items[a.position].question_number)!;const good=a.optionId===null?null:a.optionId===item.correctOptionId;if(good===null)unanswered++;else if(good)correct++;else wrong++;return{position:a.position,optionId:a.optionId,correct:good};});
  await q.query('UPDATE hanq.toeic_cbt_items i SET selected_option=a."optionId",correct=a.correct FROM jsonb_to_recordset($3::jsonb) AS a(position int,"optionId" text,correct boolean) WHERE i.user_id=$1 AND i.run_id=$2 AND i.position=a.position',[owner,id,JSON.stringify(grades)]);
  const result={kind:'toeic-wrong-replay',total:items.length,answered:correct+wrong,correct,wrong,unanswered};
  await q.query("UPDATE hanq.toeic_cbt_runs SET status='final',paused=false,cursor=$3,revision=revision+1,final_at=$4,submission_key=$5,submission_hash=$6,result=$7 WHERE user_id=$1 AND id=$2",[owner,id,d.cursor,this.clock.now(),d.submissionKey,hash,JSON.stringify(result)]);
  return this.view(q,await this.owned(q,owner,id));
 });}
 private async view(q:Queryable,r:Run){
  const c=await this.collection(q,r.user_id,r.collection_id),numbers=(await q.query<Item>('SELECT * FROM hanq.toeic_cbt_items WHERE user_id=$1 AND run_id=$2 ORDER BY position',[r.user_id,r.id])).rows.map(i=>i.question_number),data=this.ensure(c,numbers),run={...this.summary(r,c),parts:[...new Set(data.questions.map(q=>q.part))],questions:numbers.length};
  if(r.status==='ready'||r.paused)return{run,items:[]};
  const items=(await q.query<Item>('SELECT * FROM hanq.toeic_cbt_items WHERE user_id=$1 AND run_id=$2 ORDER BY position',[r.user_id,r.id])).rows,history=await this.history(q,r.user_id);
  return{run,items:items.map(i=>{
   const source=data.questions.find(q=>q.number===i.question_number)!,group=data.groups.find(g=>g.id===source.groupId)!,final=r.status==='final';
   const item={studyHistory:history.get(c.source_key+'\0'+questionKey(source))||{wrongCount:0,reportedWrongCount:0,provisionalWrongCount:0,everWrong:false,repeatedWrong:false},sourceIdentity:source.sourceIdentity||null,originalWrong:data.wrongNumbers.includes(i.question_number),position:i.position,number:i.question_number,part:source.part,groupId:group.id,groupQuestionNumbers:group.questionNumbers,stem:source.part<=2?null:source.stem,passage:source.part>=6?group.passage:null,audioUrl:source.part<=4&&!privateAudio(group.audioUrl)?group.audioUrl:null,audioPath:source.part<=4&&privateAudio(group.audioUrl)?'/collections/'+c.id+'/audio/'+encodeURIComponent(group.id):null,photoUrl:privateImage(source.photoUrl)?null:source.photoUrl,photoPath:privateImage(source.photoUrl)?'/collections/'+c.id+'/images/'+source.photoUrl.slice('private-image:'.length):null,options:source.choices.map(o=>({id:o.id,text:source.part<=2?o.id:o.text})),selectedOptionId:i.selected_option};
   if(!final)return item;
   return{...item,review:{optionStudy:part5OptionStudy(source),paraphrases:paraphrasing(source.part<=4?(group.scriptStatus==='verified'?group.script:null):group.passage,source),correct:i.correct,status:i.correct===null?'unanswered':i.correct?'correct':'wrong',correctOptionId:source.correctOptionId,stem:source.stem,choices:source.choices,explanation:source.explanation,tutorExplanation:source.tutorExplanation||null,script:group.script,scriptStatus:group.scriptStatus,timing:group.timing||null,...(source.part===7?{evidence:part7Evidence(group.passage,source.number,source.correctOptionId)}:{})}};
  })};
 }
}

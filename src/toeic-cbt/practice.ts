import {learningOwner} from './learning-owner';
import {toeicGrowth} from '../common/toeic-growth';
import {part5OptionStudy} from './part5-options';
import {paraphrasing} from './paraphrasing';
import {Inject,Injectable} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {DbService,type Queryable} from '../db/db.service';
import {CLOCK,type Clock} from '../common/tokens';
import {AppError,notFound} from '../common/app-error';
import {lockOwner} from '../common/owner-lock';
import {inspectCatalog,privateImage,type ToeicCollection,type ToeicQuestion} from './catalog';
import {scriptStudy} from './lc-script';
import {lcEvidence} from './lc-evidence';
import {part7Evidence} from './part7-evidence';
import {part7PassageStudy} from './part7-translations';
import {practiceHistory} from './practice-history';
import {loadStudyHistory,questionKey} from './history';
import type {ToeicPracticeAnswerDto,ToeicPracticeGroupDto} from './dto';
interface Collection {id:string;source_key:string;title:string;content:ToeicCollection;}
interface Answer {id:string;collection_id:string;question_number:number;selected_option:string;answer_verified:boolean;correct:boolean|null;}
@Injectable()
export class ToeicPracticeService {
 constructor(private readonly db:DbService,@Inject(CLOCK) private readonly clock:Clock){}
 private async collection(q:Queryable,viewer:string,id:string){const owner=await learningOwner(q,viewer);const c=(await q.query<Collection>('SELECT id,source_key,title,content FROM hanq.toeic_cbt_collections WHERE user_id=$1 AND id=$2',[owner,id])).rows[0];if(!c)throw notFound();return c;}
 private readiness(c:Collection,item:ToeicQuestion){const check=inspectCatalog({...c.content,questions:[item],wrongNumbers:[item.number],replayNumbers:undefined});const provisional=item.answerStatus==='assistant_inferred_not_officially_verified';if(!check.ready&&!(provisional&&check.missing.every(m=>m.reasons.every(r=>r==='official_answer_key'))))throw new AppError(409,'toeic_material_pending','Verified question material is required');return !provisional&&item.answerVerified;}
 private safe(c:Collection,item:ToeicQuestion){const group=c.content.groups.find(g=>g.id===item.groupId)!;return{number:item.number,part:item.part,sourceIdentity:item.sourceIdentity||null,originalWrong:c.content.wrongNumbers.includes(item.number),groupId:group.id,groupQuestionNumbers:group.questionNumbers,stem:item.part<=2?null:item.stem,passage:item.part>=6?group.passage:null,audioUrl:item.part<=4?group.audioUrl:null,photoUrl:privateImage(item.photoUrl)?null:item.photoUrl,photoPath:privateImage(item.photoUrl)?'/collections/'+c.id+'/images/'+item.photoUrl.slice('private-image:'.length):null,options:item.choices.map(o=>({id:o.id,text:item.part<=2?o.id:o.text}))};}
 async audioFile(owner:string,id:string,groupId:string){
  const c=await this.collection(this.db.pool,owner,id),group=c.content.groups.find(g=>g.id===groupId);
  if(!group?.audioUrl)throw notFound();
  let url:URL;try{url=new URL(group.audioUrl);}catch{throw notFound();}
  if(url.protocol!=='https:'||url.hostname!=='hahiddo-company.s3.ap-northeast-2.amazonaws.com'||url.username||url.password||url.port)throw notFound();
  const limit=20*1024*1024;
  try{const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(60000)});
   if(!response.ok||!response.body||Number(response.headers.get('content-length'))>limit)throw Error('audio unavailable');
   const chunks:Uint8Array[]=[];let bytes=0;for await(const chunk of response.body){bytes+=chunk.length;if(bytes>limit){await response.body.cancel().catch(()=>{});throw Error('audio too large');}chunks.push(chunk);}
   if(!bytes)throw Error('empty audio');return Buffer.concat(chunks);
  }catch{throw new AppError(502,'lc_audio_unavailable','Audio file could not be prepared');}
 }
 async playlist(owner:string){return this.db.tx(async q=>{
  await q.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const sourceOwner=await learningOwner(q,owner);
  const collections=(await q.query<Collection>(`SELECT * FROM (SELECT DISTINCT ON(source_key) * FROM hanq.toeic_cbt_collections WHERE user_id=$1 ORDER BY source_key,created_at DESC,id DESC) latest ORDER BY created_at,source_key`,[sourceOwner])).rows;
  const history=await loadStudyHistory(q,sourceOwner),items=[];
  collections.sort((a,b)=>(a.content.metadata?.roundIndex??Number.MAX_SAFE_INTEGER)-(b.content.metadata?.roundIndex??Number.MAX_SAFE_INTEGER));
  for(const c of collections){const seen=new Set<string>();for(const item of [...c.content.questions].sort((a,b)=>a.number-b.number)){if(item.part>4||(!c.content.wrongNumbers.includes(item.number)&&!(history.get(c.source_key+'\0'+questionKey(item))?.wrongCount)))continue;const group=c.content.groups.find(g=>g.id===item.groupId);if(!group||seen.has(group.id))continue;seen.add(group.id);items.push({collectionId:c.id,sourceTitle:c.title,number:item.number,part:item.part,groupId:group.id,groupQuestionNumbers:group.questionNumbers,originalWrong:true,audioUrl:group.audioUrl,script:group.script,scriptStatus:group.scriptStatus,timing:group.timing||null});}}
  return{items};
 });}
 async history(owner:string,cursor?:unknown){return this.db.tx(async q=>{await q.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return practiceHistory(q,owner,cursor);});}
 async list(owner:string){return this.db.tx(async q=>{
  const sourceOwner=await learningOwner(q,owner);await lockOwner(q,sourceOwner);
  const collections=(await q.query<Collection>(`SELECT * FROM (SELECT DISTINCT ON(source_key) * FROM hanq.toeic_cbt_collections WHERE user_id=$1 ORDER BY source_key,created_at DESC,id DESC) latest ORDER BY created_at,source_key`,[sourceOwner])).rows;
  type NumberRow={source_key:string;question_key:string;bucket:string;display_number:number};
  const assigned=(await q.query<NumberRow>('SELECT source_key,question_key,bucket,display_number FROM hanq.toeic_cbt_display_numbers WHERE user_id=$1',[sourceOwner])).rows,map=new Map(assigned.map(n=>[n.source_key+'\0'+n.question_key,n]));
  const next:Record<string,number>={lc:1,p56:5000,p7:7000},limit:Record<string,number>={lc:4999,p56:6999,p7:9999};for(const n of assigned)next[n.bucket]=Math.max(next[n.bucket],n.display_number+1);
  const added:NumberRow[]=[];
  for(const c of collections)for(const item of [...c.content.questions].sort((a,b)=>a.number-b.number)){const bucket=item.part<=4?'lc':item.part<=6?'p56':'p7',key=c.source_key+'\0'+questionKey(item);if(!map.has(key)){if(next[bucket]>limit[bucket])throw new AppError(409,'toeic_number_range_full','Question number range is full');const n={source_key:c.source_key,question_key:questionKey(item),bucket,display_number:next[bucket]++};added.push(n);map.set(key,n);}}
  if(added.length)await q.query('INSERT INTO hanq.toeic_cbt_display_numbers(user_id,source_key,question_key,bucket,display_number) SELECT $1,x.source_key,x.question_key,x.bucket,x.display_number FROM jsonb_to_recordset($2::jsonb) AS x(source_key text,question_key text,bucket text,display_number int) ON CONFLICT DO NOTHING',[sourceOwner,JSON.stringify(added)]);
  const history=await loadStudyHistory(q,owner),items=[];
  for(const c of collections)for(const item of c.content.questions){const n=map.get(c.source_key+'\0'+questionKey(item))!;let available=true;try{this.readiness(c,item);}catch{available=false;}items.push({...this.safe(c,item),collectionId:c.id,sourceTitle:c.title,displayNumber:String(n.display_number).padStart(4,'0'),bucket:n.bucket,officiallyVerified:item.answerStatus!=='assistant_inferred_not_officially_verified'&&item.answerVerified,available,studyHistory:history.get(c.source_key+'\0'+questionKey(item))});}
  return{items:items.sort((a,b)=>Number(a.displayNumber)-Number(b.displayNumber))};
 });}
 async questions(owner:string,id:string){const c=await this.collection(this.db.pool,owner,id),history=await loadStudyHistory(this.db.pool,owner);return{collectionId:c.id,title:c.title,officiallyVerified:!c.content.questions.some(q=>q.answerStatus==='assistant_inferred_not_officially_verified'),items:c.content.questions.map(item=>{let available=true;try{this.readiness(c,item);}catch{available=false;}return{...this.safe(c,item),available,studyHistory:history.get(c.source_key+'\0'+questionKey(item))};})};}
 async reviews(owner:string,id:string){return this.db.tx(async q=>{
  await q.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const c=await this.collection(q,owner,id);
  const items=c.content.questions.flatMap(item=>{
   let verified:boolean;try{verified=this.readiness(c,item);}catch{return [];}
   const group=c.content.groups.find(g=>g.id===item.groupId);if(!group)return [];
   return [{...this.safe(c,item),review:{officiallyVerified:verified,correctOptionId:item.correctOptionId,stem:item.stem,choices:item.choices,explanation:item.explanation,tutorExplanation:item.tutorExplanation||null,script:group.script,scriptStatus:group.scriptStatus}}];
  });
  return {collectionId:c.id,items};
 });}
 async answer(owner:string,id:string,d:ToeicPracticeAnswerDto){return this.db.tx(async q=>{
  await lockOwner(q,owner);const c=await this.collection(q,owner,id);return this.saveAnswer(q,owner,c,d);
 });}
 private async saveAnswer(q:Queryable,owner:string,c:Collection,d:ToeicPracticeAnswerDto){const id=c.id,item=c.content.questions.find(q=>q.number===d.number);if(!item)throw notFound();const verified=this.readiness(c,item);if(!item.choices.some(o=>o.id===d.optionId))throw new AppError(400,'invalid_toeic_answers','Choose one listed option');
  let answer=(await q.query<Answer>('SELECT * FROM hanq.toeic_cbt_practice_answers WHERE user_id=$1 AND request_key=$2',[owner,d.requestKey])).rows[0];
  const isNew=!answer;
  if(answer){if(answer.collection_id!==id||answer.question_number!==d.number||answer.selected_option!==d.optionId)throw new AppError(409,'idempotency_conflict','Answer key belongs to a different selection');}
  else answer=(await q.query<Answer>('INSERT INTO hanq.toeic_cbt_practice_answers(id,user_id,collection_id,question_number,selected_option,answer_verified,correct,request_key,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[randomUUID(),owner,id,item.number,d.optionId,verified,verified?d.optionId===item.correctOptionId:null,d.requestKey,this.clock.now()])).rows[0];
  const growth=isNew&&typeof answer.correct==='boolean'?await toeicGrowth(q,owner,'toeic-practice:'+answer.id,answer.correct,this.clock.now()):null;
  const group=c.content.groups.find(g=>g.id===item.groupId)!,history=await loadStudyHistory(q,owner);
  // Part 7 근거 위치는 답이 저장·채점된 뒤의 review에만 붙는다(공개 목록·문제 조회에는 없음).
  return{growth,number:item.number,selectedOptionId:answer.selected_option,officiallyVerified:answer.answer_verified,correct:answer.correct,studyHistory:history.get(c.source_key+'\0'+questionKey(item)),review:{optionStudy:part5OptionStudy(item),paraphrases:paraphrasing(item.part<=4?(group.scriptStatus==='verified'?group.script:null):group.passage,item),officiallyVerified:answer.answer_verified,correct:answer.correct,correctOptionId:item.correctOptionId,stem:item.stem,choices:item.choices,explanation:item.explanation,tutorExplanation:item.tutorExplanation||null,script:group.script,scriptStatus:group.scriptStatus,scriptStudy:scriptStudy(group.script,group.scriptStatus),...(item.part===3||item.part===4?{scriptEvidence:lcEvidence(group.script,group.scriptStatus,item.number,item.correctOptionId)}:{}),timing:group.timing||null,...(item.part===7?{evidence:part7Evidence(group.passage,item.number,item.correctOptionId)}:{})}};
 }
 async answerGroup(owner:string,id:string,d:ToeicPracticeGroupDto){return this.db.tx(async q=>{
  await lockOwner(q,owner);const c=await this.collection(q,owner,id),group=c.content.groups.find(g=>g.id===d.groupId);
  const items=c.content.questions.filter(item=>item.groupId===d.groupId);
  if(!group||!items.length||group.questionNumbers.length!==items.length||group.questionNumbers.some(n=>!items.some(item=>item.number===n))||items.some(item=>![3,4,6,7].includes(item.part)||item.part!==items[0].part)||(items[0].part>=6?!group.passage:!group.audioUrl||!group.audioVerified))throw new AppError(400,'invalid_toeic_group','Choose a verified shared passage or audio group');
  const numbers=new Set(d.answers.map(a=>a.number)),keys=new Set(d.answers.map(a=>a.requestKey));
  if(numbers.size!==items.length||d.answers.length!==items.length||keys.size!==items.length||items.some(item=>!numbers.has(item.number)))throw new AppError(400,'incomplete_toeic_group','Choose one answer for every question in this passage');
  // Validate the entire group before any insert. The surrounding transaction also
  // rolls back all rows if an idempotency conflict or storage failure occurs.
  for(const item of items){this.readiness(c,item);if(!item.choices.some(o=>o.id===d.answers.find(a=>a.number===item.number)!.optionId))throw new AppError(400,'invalid_toeic_answers','Choose one listed option');}
  const results=[];for(const item of items)results.push(await this.saveAnswer(q,owner,c,d.answers.find(a=>a.number===item.number)!));
  // Part 7 전체 번역은 그룹 답안이 모두 저장된 뒤 그룹 응답에 한 번만 붙는다.
  return{groupId:group.id,results,...(items[0].part===7?{passageStudy:part7PassageStudy(group.passage)}:{})};
 });}
}

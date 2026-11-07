import type {Queryable} from '../db/db.service';
import type {SeedQuestion} from '../questions/catalog-loader';
import {AppError} from '../common/app-error';
import {sha256hex,UUID_RE} from '../common/util';

export interface HistoryPublicationInput {
 requestId:string;
 sourceLabel:string;
 chapter:string;
 era:string;
 questions:{number:number;stem:string;choices:{id:string;text:string}[];correctOptionId:string;passage?:string}[];
 explanations:{number:number;explanation:string}[];
 cleanImageUrls:Record<number,string>;
}

const choices=['1','2','3','4','5'];
const classification=/^[a-z][a-z-]{1,30}$/;
function invalid():never {throw new AppError(400,'history_publication_invalid','Verified history content and explicit classification are required');}
function conflict():never {throw new AppError(409,'history_publication_conflict','Published history content cannot be replaced');}

/** Caller must first verify owner consent to signed-in-member publication, ADMIN status, source review,
 * clean-image review and exact asset-to-question mapping. No source image is substituted here.
 * One practice point is the existing quiz convention, NOT an inferred official exam weight. */
export function buildHistoryPublication(input:HistoryPublicationInput):SeedQuestion[] {
 if(!UUID_RE.test(input.requestId)||!input.sourceLabel.trim()||input.sourceLabel.length>160||!classification.test(input.chapter)||!classification.test(input.era))invalid();
 if(!input.questions.length||input.questions.length>40||new Set(input.questions.map(q=>q.number)).size!==input.questions.length)invalid();
 if(input.explanations.length!==input.questions.length||new Set(input.explanations.map(e=>e.number)).size!==input.explanations.length)invalid();
 return [...input.questions].sort((a,b)=>a.number-b.number).map(q=>{
  const explanation=input.explanations.find(e=>e.number===q.number)?.explanation.trim();
  const image=input.cleanImageUrls[q.number];
  const prefix='/api/v1/published-question-assets/'+input.requestId+'/';
  if(!Number.isSafeInteger(q.number)||q.number<1||q.number>200||!q.stem.trim()||q.stem.length>10000||!explanation||explanation.length>4000||!image?.startsWith(prefix)||!UUID_RE.test(image.slice(prefix.length)))invalid();
  if(q.choices.length!==5||q.choices.some((o,i)=>o.id!==choices[i]||!o.text.trim()||o.text.length>3000)||!choices.includes(q.correctOptionId)||(q.passage||'').length>20000)invalid();
  const questionId='request-'+input.requestId+'-'+q.number;
  const options=q.choices.map(o=>({id:o.id,text:o.text.trim()}));
  const base={id:questionId,mode:'quiz',chapter:input.chapter,era:input.era,relatedEras:[] as string[],shape:'choice',prompt:q.stem.trim(),passage:(q.passage||'').trim(),image,options};
  const source={...base,publicationAudience:'authenticated-members',answer:q.correctOptionId,explanation,sourceLabel:input.sourceLabel.trim(),sourceQuestionNumber:q.number,answerSource:'manual',points:1,pointsKind:'practice'};
  const contentHash=sha256hex(JSON.stringify(source)),version='rq-'+contentHash;
  return {questionId,version,kind:'quiz',chapter:input.chapter,era:input.era,relatedEras:[],examRound:null,examNumber:null,points:1,optionIds:choices.slice(),correctOptionId:q.correctOptionId,publicPayload:{...base,v:version,visibility:'authenticated-members'},reviewPayload:{...source,publicationAudience:'authenticated-members',v:version,options:options.map(o=>({...o,correct:o.id===q.correctOptionId})),why:explanation},contentHash};
 });
}

/** Requires caller-owned transaction: append only, no global seeder/current-set recalculation.
 * Retry is accepted only for the exact existing immutable version/hash, still current.
 * Existing unrelated questions, attempts, progress and exam assignments are never written. */
export async function storeHistoryPublication(q:Queryable,items:SeedQuestion[],now:Date):Promise<{inserted:number;questionIds:string[]}> {
 if(!items.length||items.length>40||new Set(items.map(i=>i.questionId)).size!==items.length)invalid();
 const ordered=[...items].sort((a,b)=>a.questionId.localeCompare(b.questionId));
 for(const item of ordered){
  if(!/^request-[0-9a-f-]{36}-[1-9][0-9]{0,2}$/.test(item.questionId)||item.kind!=='quiz'||item.points!==1||item.examRound!==null||item.examNumber!==null||item.version!=='rq-'+item.contentHash)invalid();
  await q.query("SELECT pg_advisory_xact_lock(hashtext('hanq.request-history'),hashtext($1))",[item.questionId]);
 }
 const ids=ordered.map(i=>i.questionId);
 type Existing={question_id:string;version:string;content_hash:string;is_current:boolean};
 const verify=(rows:Existing[],complete:boolean)=>{
  for(const row of rows){const item=ordered.find(i=>i.questionId===row.question_id);if(!item||row.version!==item.version||row.content_hash!==item.contentHash||row.is_current!==true)conflict();}
  if(complete&&rows.length!==ordered.length)conflict();
 };
 const before=(await q.query<Existing>('SELECT question_id,version,content_hash,is_current FROM hanq.question_versions WHERE question_id=ANY($1::text[])',[ids])).rows;
 verify(before,false);
 let inserted=0;
 for(const item of ordered){
  const row=await q.query(
   'INSERT INTO hanq.question_versions(question_id,version,kind,is_current,chapter,era,related_eras,exam_round,exam_number,points,option_ids,correct_option_id,public_payload,review_payload,content_hash,seeded_at) VALUES($1,$2,$3,true,$4,$5,$6,NULL,NULL,1,$7,$8,$9::jsonb,$10::jsonb,$11,$12) ON CONFLICT (question_id,version) DO NOTHING',
   [item.questionId,item.version,item.kind,item.chapter,item.era,item.relatedEras,item.optionIds,item.correctOptionId,JSON.stringify(item.publicPayload),JSON.stringify(item.reviewPayload),item.contentHash,now]);
  inserted+=row.rowCount||0;
 }
 verify((await q.query<Existing>('SELECT question_id,version,content_hash,is_current FROM hanq.question_versions WHERE question_id=ANY($1::text[])',[ids])).rows,true);
 return{inserted,questionIds:ids};
}

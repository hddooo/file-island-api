import {Injectable} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {DbService,type Queryable} from '../db/db.service';
import {AppError,notFound} from '../common/app-error';
import {QuestionRequestService} from './question-request.service';
import {PortalService} from './portal.service';
import {buildToeicPublication,storeToeicPublication,type PublishAsset} from './question-request-toeic-publisher';
import {buildHistoryPublication,storeHistoryPublication} from './question-request-history-publisher';
import type {QuestionRequestPublishDto} from './question-request.dto';
const digest=(d:QuestionRequestPublishDto)=>createHash('sha256').update(JSON.stringify({audience:d.audience,mappings:d.mappings,groups:d.groups,historyClassification:d.historyClassification||null})).digest('hex');
@Injectable() export class QuestionRequestPublicationService {
 constructor(private readonly db:DbService,private readonly requests:QuestionRequestService,private readonly portal:PortalService){}
 async prepare(q:Queryable,actor:string,id:string,d:QuestionRequestPublishDto){
  const row=await this.requests.access(q,actor,id,true,true);const hash=digest(d);
  if(row.status==='published'){if(row.review_payload?.publication?.inputHash!==hash)throw new AppError(409,'publication_conflict','Already published with different mappings');return{row,hash,replayed:true,prepared:null};}
  this.requests.revision(row,d.expectedRevision);
  if(row.status!=='ready_for_publish'||row.review_payload?.sourceChecked!==true)throw new AppError(409,'review_required','Both review stages must finish before publishing');
  if(d.audience!=='authenticated-members'||row.payload.publicationAudience!=='authenticated-members')throw new AppError(409,'owner_consent_required','The uploader must explicitly consent to sharing with signed-in members');
  if(row.subject==='toeic'&&row.part===2?row.review_payload.audioChecked!==true:row.review_payload.cleanImageChecked!==true)throw new AppError(409,'second_review_required','Second media review is required');
  const assets=(await q.query<PublishAsset>('SELECT id,purpose,media_type,bytes,sha256 FROM hanq.question_request_assets WHERE request_id=$1',[id])).rows;
  for(const question of row.payload.questions){if(question.cropProvenance){const c=question.cropProvenance,mapping=d.mappings.find(m=>m.number===question.number);if(!assets.some(a=>a.purpose==='source_image'&&a.sha256===c.originalSha256)||!assets.some(a=>a.id===mapping?.cleanImageAssetId&&a.purpose==='clean_image'&&a.sha256===c.outputSha256&&a.media_type==='image/png'&&a.bytes.length>=24&&a.bytes.readUInt32BE(16)===c.outputWidth&&a.bytes.readUInt32BE(20)===c.outputHeight))throw new AppError(400,'crop_provenance_mismatch','Confirmed crop must match the original and mapped clean image bytes');}}
  let prepared;
  if(row.subject==='toeic'){
   const owner=(await q.query<{owner_id:string}>('SELECT owner_id FROM hanq.toeic_member_notebook WHERE singleton=true FOR SHARE')).rows[0]?.owner_id;if(!owner)throw new AppError(409,'publisher_owner_missing','Common learning publisher is not configured');
   const built=buildToeicPublication({requestId:id,sourceLabel:row.source_label,part:row.part,questions:row.payload.questions,explanations:row.review_payload.explanations,mappings:d.mappings,groups:d.groups,assets});prepared={kind:'toeic' as const,owner,built};
  }else{
   if(!d.historyClassification||d.groups.length||d.mappings.length!==row.payload.questions.length||new Set(d.mappings.map(m=>m.number)).size!==d.mappings.length)throw new AppError(400,'history_mapping_required','Explicit history classification and one clean image mapping per question are required');
   const urls:Record<number,string>={},assetIds:string[]=[];
   for(const mapping of d.mappings){const asset=assets.find(a=>a.id===mapping.cleanImageAssetId&&a.purpose==='clean_image');if(!asset)throw new AppError(400,'clean_image_mapping_required','Map each question to its confirmed clean image');urls[mapping.number]='/api/v1/published-question-assets/'+id+'/'+asset.id;assetIds.push(asset.id);}
   const items=buildHistoryPublication({requestId:id,sourceLabel:row.source_label,questions:row.payload.questions,explanations:row.review_payload.explanations,cleanImageUrls:urls,chapter:d.historyClassification.chapter,era:d.historyClassification.era});prepared={kind:'history' as const,items,assetIds:[...new Set(assetIds)]};
  }
  return{row,hash,replayed:false,prepared};
 }
 async preview(actor:string,id:string,d:QuestionRequestPublishDto){return this.db.tx(async q=>{try{const p=await this.prepare(q,actor,id,d);return{ready:true,replayed:p.replayed,audience:'authenticated-members',subject:p.row.subject,questionCount:p.row.payload.questions.length,blockers:[]};}catch(e){if(e instanceof AppError&&e.getStatus()!==403&&e.getStatus()!==404)return{ready:false,audience:'authenticated-members',blockers:[{code:e.code,message:e.message}]};throw e;}});}
 async publish(actor:string,id:string,d:QuestionRequestPublishDto){return this.db.tx(async q=>{
  const p=await this.prepare(q,actor,id,d);if(p.replayed)return{id,status:'published',revision:p.row.revision,publication:p.row.review_payload.publication,replayed:true};
  const prepared=p.prepared!;let data;
  if(prepared.kind==='toeic')data=await storeToeicPublication(q,prepared.owner,prepared.built);else{const saved=await storeHistoryPublication(q,prepared.items,new Date());data={questionIds:saved.questionIds,assetIds:prepared.assetIds};}
  const publication={...data,audience:'authenticated-members',inputHash:p.hash,mappings:d.mappings,groups:d.groups,historyClassification:d.historyClassification||null,publishedAt:new Date().toISOString(),publishedBy:actor};
  const row=(await q.query("UPDATE hanq.question_requests SET status='published',review_payload=$2::jsonb,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING revision",[id,JSON.stringify({...p.row.review_payload,publication})])).rows[0];await this.portal.audit(q,actor,'question-request.publish',id);return{id,status:'published',revision:row.revision,publication,replayed:false};
 });}
 async asset(id:string,assetId:string){const row=(await this.db.pool.query("SELECT a.media_type,a.bytes FROM hanq.question_requests r JOIN hanq.question_request_assets a ON a.request_id=r.id WHERE r.id=$1 AND a.id=$2 AND r.status='published' AND r.review_payload->'publication'->>'audience'='authenticated-members' AND (r.review_payload->'publication'->'assetIds') ? a.id::text AND a.purpose IN ('clean_image','audio')",[id,assetId])).rows[0];if(!row)throw notFound();return row;}
 async history(after:string,limit:number){if(after&&!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(after))throw new AppError(400,'invalid_cursor','Invalid cursor');const rows=(await this.db.pool.query("SELECT question_id,version,kind,points,public_payload FROM hanq.question_versions WHERE is_current AND public_payload->>'visibility'='authenticated-members' AND ($1='' OR question_id>$1) ORDER BY question_id LIMIT $2",[after,limit+1])).rows;return{items:rows.slice(0,limit).map(r=>({questionId:r.question_id,version:r.version,kind:r.kind,points:r.points,item:r.public_payload})),next:rows.length>limit?rows[limit-1].question_id:null};}
 async historyQuestion(id:string){const row=(await this.db.pool.query("SELECT question_id,version,kind,points,public_payload FROM hanq.question_versions WHERE question_id=$1 AND is_current AND public_payload->>'visibility'='authenticated-members'",[id])).rows[0];if(!row)throw notFound();return{questionId:row.question_id,version:row.version,kind:row.kind,points:row.points,item:row.public_payload};}
}

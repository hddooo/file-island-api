import { Injectable } from '@nestjs/common';
import { AppError, notFound } from '../common/app-error';
import { DbService } from '../db/db.service';
import { JoseonScriptService } from './joseon-script.service';
import { OpeningScriptService } from './opening-script.service';
import { OPENING_SCRIPT_PIN } from './opening-script.pin';
import { projectOpeningHistory81 } from './opening-history81-quiz';
import { GoryeoScriptService } from './goryeo-script.service';
import { JOSEON_SCRIPT_PIN } from './joseon-script.pin';
import { GORYEO_SCRIPT_PIN } from './goryeo-script.pin';
import { HISTORY81_PDF, projectHistory81, quizDigest } from './history81-quiz';
import { applySourceBatch, requestedGradingVersion, gradingStorageKey, gradingCapabilities, type GradingVersion, type SourceBatch, type SourceWorkspace } from './source-blank-progress';

const initial = ():SourceWorkspace=>({cursor:0,status:'active',responses:{}});
const conflict=()=>new AppError(409,'source_progress_conflict','Reload the saved progress before continuing');
export type History81Batch = SourceBatch & {selectedReviewQuestionIds?:string[]};
type Workspace81 = SourceWorkspace & {selectedReviewQuestionIds:string[]};
const withSelection=(workspace:SourceWorkspace & {selectedReviewQuestionIds?:string[]}):Workspace81=>({...workspace,selectedReviewQuestionIds:workspace.selectedReviewQuestionIds??[]});
type Saved81 = {version:string;revision:number;workspace:Workspace81;updatedAt:string|null;reviewSelectionAvailable:true} & ReturnType<typeof gradingCapabilities>;
@Injectable()
export class History81Service {
 constructor(private readonly db:DbService,private readonly joseon:JoseonScriptService,private readonly goryeo:GoryeoScriptService,private readonly opening:OpeningScriptService){}
 async quiz(revision:string,era:string){
  if(revision!==HISTORY81_PDF||(era!=='joseon'&&era!=='goryeo'&&era!=='opening'))throw notFound();
  if(era==='opening')return projectOpeningHistory81(JSON.parse((await this.opening.bundle(OPENING_SCRIPT_PIN.sourceSha256)).toString('utf8')));
  const pin=era==='joseon'?JOSEON_SCRIPT_PIN:GORYEO_SCRIPT_PIN,service=era==='joseon'?this.joseon:this.goryeo;
  return projectHistory81(era,JSON.parse((await service.bundle(pin.sourceSha256)).toString('utf8')));
 }
 private async source(revision:string,era:string,gradingVersion:GradingVersion=1){const quiz=await this.quiz(revision,era);return {quiz,key:gradingStorageKey(`history:81-2026:${era}:${quiz.source.scriptSha256}`,gradingVersion)};}
 async get(userId:string,revision:string,era:string,requested?:GradingVersion):Promise<Saved81>{
  const gradingVersion=requestedGradingVersion(requested);
  const {quiz,key}=await this.source(revision,era,gradingVersion),result=await this.db.pool.query('SELECT revision,workspace,updated_at FROM hanq.source_blank_workspaces WHERE user_id=$1 AND quiz_id=$2 AND source_version=$3',[userId,key,quiz.version]),row=result.rows[0];
  return {version:quiz.version,revision:row?.revision||0,workspace:withSelection(row?.workspace||initial()),updatedAt:row?.updated_at||null,reviewSelectionAvailable:true,...gradingCapabilities(gradingVersion)};
 }
 async save(userId:string,revision:string,era:string,m:History81Batch):Promise<Saved81>{
  const gradingVersion=requestedGradingVersion(m?.gradingVersion);
  const {quiz,key}=await this.source(revision,era,gradingVersion),version=quiz.version;
  if(!m||m.version!==version||!Number.isInteger(m.revision)||m.revision<0||m.revision>1000000||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(m.mutationId||''))throw new AppError(400,'invalid_source_progress','Invalid source progress');
  const selection=m.selectedReviewQuestionIds;
  if(selection!==undefined&&(!Array.isArray(selection)||selection.length>quiz.items.length||selection.some(id=>typeof id!=='string'||!quiz.items.some(item=>item.id===id))||new Set(selection).size!==selection.length))throw new AppError(400,'invalid_source_progress','Invalid source progress');
  // Validate the entire batch before entering a transaction; never trust client grades.
  applySourceBatch(quiz.items,initial(),m,gradingVersion,version);const hash=quizDigest(m);
  return this.db.tx(async q=>{
   await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[userId+':'+key+':'+version]);
   const result=await q.query('SELECT revision,workspace,mutation_id,mutation_hash,updated_at FROM hanq.source_blank_workspaces WHERE user_id=$1 AND quiz_id=$2 AND source_version=$3 FOR UPDATE',[userId,key,version]),row=result.rows[0];
   if(row?.mutation_id===m.mutationId){if(row.mutation_hash!==hash)throw conflict();return {version,revision:row.revision,workspace:withSelection(row.workspace),updatedAt:row.updated_at,reviewSelectionAvailable:true,...gradingCapabilities(gradingVersion)};}
   if((row?.revision||0)!==m.revision)throw conflict();
   const workspace=withSelection(applySourceBatch(quiz.items,withSelection(row?.workspace||initial()),m,gradingVersion,version)),nextRevision=m.revision+1;
   if(selection!==undefined)workspace.selectedReviewQuestionIds=[...selection];
   const saved=await q.query(`INSERT INTO hanq.source_blank_workspaces (user_id,quiz_id,source_version,revision,workspace,mutation_id,mutation_hash) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(user_id,quiz_id,source_version) DO UPDATE SET revision=EXCLUDED.revision,workspace=EXCLUDED.workspace,mutation_id=EXCLUDED.mutation_id,mutation_hash=EXCLUDED.mutation_hash,updated_at=now() RETURNING updated_at`,[userId,key,version,nextRevision,workspace,m.mutationId,hash]);
   return {version,revision:nextRevision,workspace,updatedAt:saved.rows[0].updated_at,reviewSelectionAvailable:true,...gradingCapabilities(gradingVersion)};
  });
 }
}

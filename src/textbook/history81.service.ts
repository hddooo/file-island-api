import { Injectable } from '@nestjs/common';
import { AppError, notFound } from '../common/app-error';
import { DbService } from '../db/db.service';
import { JoseonScriptService } from './joseon-script.service';
import { GoryeoScriptService } from './goryeo-script.service';
import { JOSEON_SCRIPT_PIN } from './joseon-script.pin';
import { GORYEO_SCRIPT_PIN } from './goryeo-script.pin';
import { HISTORY81_PDF, projectHistory81, quizDigest } from './history81-quiz';
import { applySourceBatch, type SourceBatch, type SourceWorkspace } from './source-blank-progress';

const initial = ():SourceWorkspace=>({cursor:0,status:'active',responses:{}});
const conflict=()=>new AppError(409,'source_progress_conflict','Reload the saved progress before continuing');
type Saved81 = {version:string;revision:number;workspace:SourceWorkspace;updatedAt:string|null};
@Injectable()
export class History81Service {
 constructor(private readonly db:DbService,private readonly joseon:JoseonScriptService,private readonly goryeo:GoryeoScriptService){}
 async quiz(revision:string,era:string){
  if(revision!==HISTORY81_PDF||(era!=='joseon'&&era!=='goryeo'))throw notFound();
  const pin=era==='joseon'?JOSEON_SCRIPT_PIN:GORYEO_SCRIPT_PIN,service=era==='joseon'?this.joseon:this.goryeo;
  return projectHistory81(era,JSON.parse((await service.bundle(pin.sourceSha256)).toString('utf8')));
 }
 private async source(revision:string,era:string){const quiz=await this.quiz(revision,era);return {quiz,key:`history:81-2026:${era}:${quiz.source.scriptSha256}`};}
 async get(userId:string,revision:string,era:string):Promise<Saved81>{
  const {quiz,key}=await this.source(revision,era),result=await this.db.pool.query('SELECT revision,workspace,updated_at FROM hanq.source_blank_workspaces WHERE user_id=$1 AND quiz_id=$2 AND source_version=$3',[userId,key,quiz.version]),row=result.rows[0];
  return {version:quiz.version,revision:row?.revision||0,workspace:row?.workspace||initial(),updatedAt:row?.updated_at||null};
 }
 async save(userId:string,revision:string,era:string,m:SourceBatch):Promise<Saved81>{
  const {quiz,key}=await this.source(revision,era),version=quiz.version;
  if(!m||m.version!==version||!Number.isInteger(m.revision)||m.revision<0||m.revision>1000000||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(m.mutationId||''))throw new AppError(400,'invalid_source_progress','Invalid source progress');
  // Validate the entire batch before entering a transaction; never trust client grades.
  applySourceBatch(quiz.items,initial(),m);const hash=quizDigest(m);
  return this.db.tx(async q=>{
   await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[userId+':'+key+':'+version]);
   const result=await q.query('SELECT revision,workspace,mutation_id,mutation_hash,updated_at FROM hanq.source_blank_workspaces WHERE user_id=$1 AND quiz_id=$2 AND source_version=$3 FOR UPDATE',[userId,key,version]),row=result.rows[0];
   if(row?.mutation_id===m.mutationId){if(row.mutation_hash!==hash)throw conflict();return {version,revision:row.revision,workspace:row.workspace,updatedAt:row.updated_at};}
   if((row?.revision||0)!==m.revision)throw conflict();
   const workspace=applySourceBatch(quiz.items,row?.workspace||initial(),m),nextRevision=m.revision+1;
   const saved=await q.query(`INSERT INTO hanq.source_blank_workspaces (user_id,quiz_id,source_version,revision,workspace,mutation_id,mutation_hash) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(user_id,quiz_id,source_version) DO UPDATE SET revision=EXCLUDED.revision,workspace=EXCLUDED.workspace,mutation_id=EXCLUDED.mutation_id,mutation_hash=EXCLUDED.mutation_hash,updated_at=now() RETURNING updated_at`,[userId,key,version,nextRevision,workspace,m.mutationId,hash]);
   return {version,revision:nextRevision,workspace,updatedAt:saved.rows[0].updated_at};
  });
 }
}

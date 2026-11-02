import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDatabaseConfig } from '../src/config/config';
import { createPool, type Queryable } from '../src/db/db.service';
import { lockOwner } from '../src/common/owner-lock';
import { importBookWrongNotes, type ManualEntry } from '../src/wrong-notes/manual-import';

type Package = {format:string;officiallyVerified:boolean;sourceReviewSha256:string;expectedUnique:number;entries:(ManualEntry & {verifiedOfficial:boolean;requiredAssets:{path:string;sha256:string}[]})[]};
const hash=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const protectedTables=['attempts','growth_ledger','runs','cbt_runs','attendance'];
async function protectedState(q:Queryable,userId:string){
 const state:Record<string,unknown>={};
 for(const table of protectedTables){
  const exists=(await q.query('SELECT to_regclass($1) name',['hanq.'+table])).rows[0].name;
  if(exists)state[table]=(await q.query(`SELECT * FROM hanq.${table} WHERE user_id=$1 ORDER BY to_jsonb(${table})::text`,[userId])).rows;
 }
 return state;
}
/** Explicit private package, source evidence and owner; dry-run is the default. No production migration is implicit. */
async function main(){
 const args=process.argv.slice(2),value=(flag:string)=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
 const file=value('--package'),source=value('--source-review'),email=value('--owner-email'),base=value('--front-url'),backup=value('--backup');
 const apply=args.includes('--apply');
 if(!file||!source||!email||!base||(apply&&!backup))throw Error('usage: --package --source-review --owner-email --front-url [--apply --backup]');
 const pack=JSON.parse(readFileSync(resolve(file),'utf8')) as Package;
 if(pack.format!=='hanq-book-wrong-notes-v1'||pack.officiallyVerified!==true||hash(readFileSync(resolve(source)))!==pack.sourceReviewSha256||!Array.isArray(pack.entries)||!pack.entries.length||pack.entries.length>100||new Set(pack.entries.map(e=>e.questionId)).size!==pack.expectedUnique||pack.entries.some(e=>e.verifiedOfficial!==true))throw Error('unverified_package');
 const evidence=JSON.parse(readFileSync(resolve(source),'utf8')) as {files?:{exam:number;question:number;answer:number;duplicate_of:unknown;fresh_pdf_answer_extraction_match:boolean;official_original_visual_match?:boolean;official_stem_and_options?:string;official_source_file?:string;official_answer_source?:string}[]};
 if(!Array.isArray(evidence.files))throw Error('source_evidence_missing');
 for(const e of pack.entries){const match=evidence.files.filter(f=>!f.duplicate_of&&f.exam===e.exam&&f.question===e.number);if(match.length!==1||match[0].answer!==e.answer||!match[0].fresh_pdf_answer_extraction_match||!(match[0].official_original_visual_match||(match[0].official_stem_and_options&&match[0].official_source_file&&match[0].official_answer_source)))throw Error('official_source_mapping_mismatch');}
 const url=new URL(base);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('invalid_front_url');
 const assets=new Map<string,string>();
 for(const e of pack.entries){if(!Array.isArray(e.requiredAssets)||!e.requiredAssets.length)throw Error('missing_asset_evidence');for(const a of e.requiredAssets){if(!/^media\/(?:exam(?:-expanded|-book)?|review-focus)\/[A-Za-z0-9_-]+\.(?:webp|png)$/.test(a.path)||!/^[a-f0-9]{64}$/.test(a.sha256))throw Error('invalid_asset_evidence');if(assets.has(a.path)&&assets.get(a.path)!==a.sha256)throw Error('conflicting_asset_evidence');assets.set(a.path,a.sha256);}}
 for(const [path,sha] of assets){const r=await fetch(new URL(path,url.href.endsWith('/')?url:new URL(url.href+'/')),{signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok||hash(new Uint8Array(await r.arrayBuffer()))!==sha)throw Error('deployed_asset_verification_failed');}
 const {database}=loadDatabaseConfig(process.env),pool=createPool(database),q=await pool.connect();
 try{
  await q.query('BEGIN');
  if(!(await q.query("SELECT to_regclass('hanq.manual_wrong_notes') name")).rows[0].name)throw Error('migration_010_required');
  const users=(await q.query<{id:string}>('SELECT id FROM hanq.users WHERE email_normalized=$1',[email.trim().toLowerCase()])).rows;if(users.length!==1)throw Error('owner_not_unique');const userId=users[0].id;
  await lockOwner(q,userId);const history=await protectedState(q,userId),before=hash(JSON.stringify(history));
  if(apply){
   const prior=(await q.query('SELECT * FROM hanq.manual_wrong_notes WHERE user_id=$1',[userId])).rows;
   const questions=(await q.query('SELECT * FROM hanq.question_versions WHERE question_id=ANY($1::text[])',[pack.entries.map(e=>e.questionId)])).rows;
   writeFileSync(resolve(backup!),JSON.stringify({createdAt:new Date().toISOString(),userId,sourceReviewSha256:pack.sourceReviewSha256,protectedState:before,protectedHistory:history,manualWrongNotes:prior,questions},null,2)+'\n',{mode:0o600,flag:'wx'});
  }
  const result=await importBookWrongNotes(q,userId,pack.entries,new Date());
  if(before!==hash(JSON.stringify(await protectedState(q,userId))))throw Error('protected_history_changed');
  await q.query(apply?'COMMIT':'ROLLBACK');console.log(JSON.stringify({mode:apply?'applied':'dry-run-rolled-back',...result,verifiedAssets:assets.size,protectedHistoryUnchanged:true}));
 }catch(e){await q.query('ROLLBACK').catch(()=>undefined);throw e;}finally{q.release();await pool.end();}
}
main().catch((e:Error)=>{console.error('[manual-import] '+(e.message.match(/^[a-z_]+$/)?e.message:'failed; no credentials or personal data logged'));process.exitCode=1;});

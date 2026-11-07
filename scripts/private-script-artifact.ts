import {projectOpeningHistory81} from '../src/textbook/opening-history81-quiz';
import {readFileSync,statSync} from 'node:fs';
import {loadDatabaseConfig} from '../src/config/config';
import {createPool} from '../src/db/db.service';
import {migratePrivateScriptArtifacts,importPrivateStructure} from '../src/db/private-script-artifact-import';
import {ARTIFACT_MAX_BYTES,verifyArtifactBytes,type ArtifactIdentity} from '../src/textbook/private-script-artifact';

/** Explicit operator command only. No .env auto-load, automatic schema setup, fixture output or credential logs. */
async function main(){
 const [action,...args]=process.argv.slice(2);
 if(action!=='schema'&&action!=='import'&&action!=='import-stdin')throw Error('expected_schema_or_import');
 if(action==='schema'&&(args.length!==1||args[0]!=='--apply'))throw Error('schema_requires_explicit_apply');
 let input:{identity:ArtifactIdentity;payload:Buffer;bundle:Buffer}|undefined;
 if(action==='import'){
  if(args.length!==4||args[3]!=='--apply')throw Error('import_requires_manifest_payload_bundle_and_apply');
  if(statSync(args[0]).size>16384||statSync(args[1]).size>ARTIFACT_MAX_BYTES||statSync(args[2]).size>ARTIFACT_MAX_BYTES)throw Error('input_limit');
  input={identity:JSON.parse(readFileSync(args[0],'utf8')),payload:readFileSync(args[1]),bundle:readFileSync(args[2])};
  verifyArtifactBytes(input.payload,input.identity,input.bundle);
 }
 if(action==='import-stdin'){
  if(args.length!==1||args[0]!=='--apply')throw Error('import_requires_explicit_apply');
  const chunks:Buffer[]=[];let length=0;
  for await(const chunk of process.stdin){const bytes=Buffer.from(chunk);length+=bytes.length;if(length>ARTIFACT_MAX_BYTES*3+16384)throw Error('input_limit');chunks.push(bytes);}
  const raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const decode=(value:unknown)=>{if(typeof value!=='string')throw Error('invalid_input');const bytes=Buffer.from(value,'base64');if(bytes.length>ARTIFACT_MAX_BYTES||bytes.toString('base64')!==value)throw Error('invalid_input');return bytes;};
  input={identity:raw.identity,payload:decode(raw.payloadBase64),bundle:decode(raw.bundleBase64)};
  verifyArtifactBytes(input.payload,input.identity,input.bundle);
 }
 const {database}=loadDatabaseConfig(process.env),pool=createPool(database);
 try{
  const changed=action==='schema'?await migratePrivateScriptArtifacts(pool):await importPrivateStructure(pool,input!.identity,input!.payload,input!.bundle,input!.identity.kind==='presentation'?projectOpeningHistory81(JSON.parse(input!.bundle.toString('utf8'))):undefined);
  console.log('[private-artifact] '+(changed?'applied':'already identical'));
 }finally{await pool.end();}
}
if(require.main===module)main().catch(()=>{console.error('[private-artifact] failed; no connection details or payload logged');process.exitCode=1;});

import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import type {Pool} from 'pg';
import {projectRoot} from '../common/project-root';
import type {Quiz81} from '../textbook/history81-quiz';
import {artifactHash,verifyPresentationArtifact,verifyStructureArtifact,type ArtifactIdentity} from '../textbook/private-script-artifact';

const MIGRATION='056_private_script_artifacts.sql';
const sqlBytes=(path:string)=>Buffer.from(readFileSync(path,'utf8').replace(/\r\n/g,'\n'));
/** Explicit single migration. Does not invoke the general migrator or execute permission SQL. */
export async function migratePrivateScriptArtifacts(pool:Pool):Promise<boolean>{
 const root=join(projectRoot(),'migrations'),sql=sqlBytes(join(root,'targeted',MIGRATION)).toString('utf8'),checksum=artifactHash(Buffer.from(sql)),client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('hanq.migrate'))");
  const existing=await client.query('SELECT version,checksum FROM hanq.schema_migrations'),done=new Map(existing.rows.map(r=>[r.version,r.checksum]));
  const baseline=readdirSync(root).filter(f=>/^\d{3}_[a-z0-9_]+\.sql$/.test(f));
  if([...done.keys()].some(version=>version!==MIGRATION&&!baseline.includes(version)))throw Error('unexpected_migration_receipt');
  for(const file of baseline)if(done.get(file)!==artifactHash(sqlBytes(join(root,file))))throw Error('baseline_migration_mismatch');
  if(done.has(MIGRATION)){if(done.get(MIGRATION)!==checksum)throw Error('targeted_migration_mismatch');await client.query('COMMIT');return false;}
  // Refuse unsafe defaults instead of changing access. Parent separately verifies backup and schema.
  const unsafe=await client.query("SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='hanq' AND a.grantee=0 UNION ALL SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND d.defaclobjtype='r' AND d.defaclnamespace IN (0,(SELECT oid FROM pg_namespace WHERE nspname='hanq')) AND a.grantee<>d.defaclrole");
  if(unsafe.rowCount)throw Error('private_schema_access_preflight_failed');
  const table=await client.query("SELECT to_regclass('hanq.private_script_artifacts') AS name");if(table.rows[0].name)throw Error('unrecorded_artifact_table');
  await client.query(sql);
  await client.query('INSERT INTO hanq.schema_migrations(version,checksum) VALUES($1,$2)',[MIGRATION,checksum]);
  await client.query('COMMIT');return true;
 }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}
export async function importPrivateStructure(pool:Pool,identity:ArtifactIdentity,payload:Buffer,bundle:Buffer,quiz?:Quiz81):Promise<boolean>{
 if(!/^[a-z][a-z0-9_-]{0,63}$/.test(identity.era)||!['structure','presentation'].includes(identity.kind))throw Error('invalid_artifact_identity');
 if(identity.kind==='structure')verifyStructureArtifact(payload,identity,bundle);
 else {if(!quiz)throw Error('verified_quiz_required');verifyPresentationArtifact(payload,identity,bundle,quiz);}
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const inserted=await client.query('INSERT INTO hanq.private_script_artifacts(era,artifact_kind,source_sha256,content_sha256,projection_sha256,byte_length,payload) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(era,artifact_kind,source_sha256) DO NOTHING',
   [identity.era,identity.kind,identity.sourceSha256,identity.contentSha256,identity.projectionSha256,identity.byteLength,payload]);
  const result=await client.query('SELECT content_sha256,projection_sha256,byte_length,payload FROM hanq.private_script_artifacts WHERE era=$1 AND artifact_kind=$2 AND source_sha256=$3',[identity.era,identity.kind,identity.sourceSha256]),row=result.rows[0];
  if(!row||row.content_sha256!==identity.contentSha256||row.projection_sha256!==identity.projectionSha256||row.byte_length!==identity.byteLength||!Buffer.isBuffer(row.payload)||!row.payload.equals(payload))throw Error('immutable_artifact_conflict');
  await client.query('COMMIT');return inserted.rowCount===1;
 }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}

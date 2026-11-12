import {Injectable} from '@nestjs/common';
import {DbService} from '../db/db.service';
import {OpeningScriptService} from './opening-script.service';
import {OPENING_SCRIPT_PIN} from './opening-script.pin';
import {History81Service} from './history81.service';
import {artifactUnavailable,verifyArtifactBytes,verifyPresentationArtifact,verifyStructureArtifact,type ArtifactIdentity,ARTIFACT_MAX_BYTES} from './private-script-artifact';

@Injectable()
export class OpeningStructureService {
 constructor(private readonly db:DbService,private readonly script:OpeningScriptService,private readonly history:History81Service){}
 async get(source:string,signal?:AbortSignal):Promise<Buffer>{
  signal?.throwIfAborted();
  // Reuse the existing server-owned edition identity, never a client-selected file or fallback.
  const selected=source==='current'?OPENING_SCRIPT_PIN.sourceSha256:source;
  const bundle=await this.script.bundle(selected,signal);
  signal?.throwIfAborted();
  try{
   const result=await this.db.pool.query(
    'SELECT artifact_kind,source_sha256,content_sha256,projection_sha256,byte_length,payload FROM hanq.private_script_artifacts WHERE era=$1 AND artifact_kind=ANY($2::text[]) AND source_sha256=$3 AND byte_length BETWEEN 1 AND $4',
    ['opening',source==='current'?['structure','presentation']:['structure'],selected,ARTIFACT_MAX_BYTES]);
   if(result.rows.length!==(source==='current'?2:1))throw artifactUnavailable();
   const identity=(row:Record<string,unknown>):ArtifactIdentity=>({era:'opening',kind:row.artifact_kind as string,sourceSha256:row.source_sha256 as string,contentSha256:row.content_sha256 as string,projectionSha256:row.projection_sha256 as string,byteLength:row.byte_length as number});
   const row=result.rows.find(r=>r.artifact_kind==='structure');if(!row)throw artifactUnavailable();
   verifyStructureArtifact(row.payload,identity(row),bundle);
   if(source!=='current'){signal?.throwIfAborted();return row.payload;}
   const config=result.rows.find(r=>r.artifact_kind==='presentation');if(!config)throw artifactUnavailable();
   verifyArtifactBytes(config.payload,identity(config),bundle);
   const settings=JSON.parse(config.payload.toString('utf8'));
   verifyPresentationArtifact(config.payload,identity(config),bundle,await this.history.quiz(settings.workspace?.revision,'opening'));
   signal?.throwIfAborted();return Buffer.from(JSON.stringify({structure:JSON.parse(row.payload.toString('utf8')),presentation:settings.presentation,workspace:settings.workspace}));
  }catch{signal?.throwIfAborted();throw artifactUnavailable();}
 }
}

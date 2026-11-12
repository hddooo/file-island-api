import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyStructureArtifact,verifyPresentationArtifact} from '../../src/textbook/private-script-artifact';
import {OpeningStructureService} from '../../src/textbook/opening-structure.service';
import {OpeningScriptService} from '../../src/textbook/opening-script.service';
import {History81Service} from '../../src/textbook/history81.service';
import type {DbService} from '../../src/db/db.service';

import {syntheticArtifact} from '../helpers/private-script-artifact';

test('private artifacts validate bytes, digests, bundle binding, projection and workspace without data constants',()=>{
 const f=syntheticArtifact();verifyStructureArtifact(f.payload,f.identity,f.bundle);verifyPresentationArtifact(f.config,f.configIdentity,f.bundle,f.quiz);
 for(const identity of [{...f.identity,byteLength:1},{...f.identity,contentSha256:'0'.repeat(64)},{...f.identity,projectionSha256:'0'.repeat(64)}])assert.throws(()=>verifyStructureArtifact(f.payload,identity,f.bundle));
 assert.throws(()=>verifyStructureArtifact(Buffer.from('tampered'),f.identity,f.bundle));
 assert.throws(()=>verifyPresentationArtifact(f.config,f.configIdentity,f.bundle,{...f.quiz,source:{...f.quiz.source,pdfSha256:'changed'}}));
});
test('DB structure exact/current response, missing/corrupt rows fail closed, no file fallback or writes',async()=>{
 const f=syntheticArtifact(),rows=[{artifact_kind:'structure',source_sha256:f.identity.sourceSha256,content_sha256:f.identity.contentSha256,projection_sha256:f.identity.projectionSha256,byte_length:f.payload.length,payload:f.payload},{artifact_kind:'presentation',source_sha256:f.identity.sourceSha256,content_sha256:f.configIdentity.contentSha256,projection_sha256:f.identity.projectionSha256,byte_length:f.config.length,payload:f.config}];
 let current=rows;
 const db={pool:{query:async(sql:string,values:unknown[])=>{assert(sql.startsWith('SELECT '));return {rows:current.filter(r=>(values[1] as string[]).includes(r.artifact_kind))};}}} as unknown as DbService;
 const script={bundle:async()=>f.bundle} as unknown as OpeningScriptService,history={quiz:async()=>f.quiz} as unknown as History81Service;
 const service=new OpeningStructureService(db,script,history);
 assert.deepEqual(await service.get(f.identity.sourceSha256),f.payload);
 assert.deepEqual(JSON.parse((await service.get('current')).toString()),{structure:JSON.parse(f.payload.toString()),...f.settings});
 current=[];await assert.rejects(service.get('current'),{code:'script_unavailable'});
 current=[{...rows[0],payload:Buffer.from('tampered')}];await assert.rejects(service.get(f.identity.sourceSha256),{code:'script_unavailable'});
 const abort=new AbortController();abort.abort();await assert.rejects(service.get('current',abort.signal));
});

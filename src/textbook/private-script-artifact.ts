import {createHash} from 'node:crypto';
import {sourceSlots} from './source-blank-progress';
import type {Quiz81} from './history81-quiz';
import {AppError} from '../common/app-error';

export const ARTIFACT_MAX_BYTES=512_000;
export type ArtifactIdentity={era:string;kind:string;sourceSha256:string;contentSha256:string;projectionSha256:string;byteLength:number};
export const artifactHash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export const artifactUnavailable=()=>new AppError(503,'script_unavailable','Private Script is unavailable');
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function verifyStructureArtifact(bytes:Buffer,identity:ArtifactIdentity,bundle:Buffer):void {
 verifyArtifactBytes(bytes,identity,bundle);
 const b=JSON.parse(bundle.toString('utf8'));
 const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(!data||typeof data!=='object'||Array.isArray(data)||data.sourceSha256!==identity.sourceSha256)throw artifactUnavailable();
 const {bundleDescriptor,bundlePin,...projection}=data;
 if(artifactHash(Buffer.from(JSON.stringify(projection)))!==identity.projectionSha256||
   bundlePin?.bytes!==bundle.length||bundlePin.sha256!==artifactHash(bundle)||
   bundleDescriptor?.schema!==b.schema||bundleDescriptor.source?.sha256!==identity.sourceSha256||
   bundleDescriptor.projectionSha256!==identity.projectionSha256)throw artifactUnavailable();
}

export function verifyArtifactBytes(bytes:Buffer,identity:ArtifactIdentity,bundle:Buffer):void {
 const b=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bundle));
 if(!Buffer.isBuffer(bytes)||!Number.isSafeInteger(identity.byteLength)||identity.byteLength<1||identity.byteLength>ARTIFACT_MAX_BYTES||
   bytes.length!==identity.byteLength||!digest(identity.sourceSha256)||!digest(identity.contentSha256)||!digest(identity.projectionSha256)||
   artifactHash(bytes)!==identity.contentSha256||b.source?.sha256!==identity.sourceSha256||b.projectionSha256!==identity.projectionSha256)throw artifactUnavailable();
}

export function verifyPresentationArtifact(bytes:Buffer,identity:ArtifactIdentity,bundle:Buffer,quiz:Quiz81):void {
 verifyArtifactBytes(bytes,identity,bundle);
 const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),w=data?.workspace;
 if(!data||typeof data!=='object'||Array.isArray(data)||!data.presentation||typeof data.presentation!=='object'||Array.isArray(data.presentation)||
   w?.sourceSha256!==identity.sourceSha256||w.sourceSha256!==quiz.source.scriptSha256||w.revision!==quiz.source.pdfSha256||
   w.counts?.items!==quiz.items.length||w.counts.groups!==(quiz.scriptResponseGroups as unknown[]).length||
   w.counts.slots!==quiz.items.reduce((n,item)=>n+sourceSlots(item).length,0))throw artifactUnavailable();
}

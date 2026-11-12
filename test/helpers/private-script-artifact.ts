import {artifactHash,type ArtifactIdentity} from '../../src/textbook/private-script-artifact';
import type {Quiz81} from '../../src/textbook/history81-quiz';
export function syntheticArtifact(){
 const sourceSha256=artifactHash(Buffer.from('synthetic source')),projection={sourceSha256,synthetic:true},projectionSha256=artifactHash(Buffer.from(JSON.stringify(projection)));
 const descriptor={schema:'synthetic-bundle/1',source:{sha256:sourceSha256},projectionSha256},bundle=Buffer.from(JSON.stringify({...descriptor,markdown:'synthetic source'}));
 const payload=Buffer.from(JSON.stringify({...projection,bundleDescriptor:descriptor,bundlePin:{bytes:bundle.length,sha256:artifactHash(bundle)}}));
 const identity:ArtifactIdentity={era:'opening',kind:'structure',sourceSha256,contentSha256:artifactHash(payload),projectionSha256,byteLength:payload.length};
 const quiz:Quiz81={schemaVersion:'synthetic/1',version:'synthetic-version',source:{scriptSha256:sourceSha256,pdfSha256:artifactHash(Buffer.from('synthetic PDF'))},items:[],scriptResponseGroups:[]};
 const settings={presentation:{synthetic:true},workspace:{revision:quiz.source.pdfSha256,sourceSha256,counts:{items:0,groups:0,slots:0}}},config=Buffer.from(JSON.stringify(settings));
 return {bundle,payload,identity,quiz,settings,config,configIdentity:{...identity,kind:'presentation',byteLength:config.length,contentSha256:artifactHash(config)}};
}

'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const schema54=require('./schema54-contract.cjs');
const REPOSITORY='hddooo/file-island-api',WORKFLOW='.github/workflows/image.yml';
const BASE='node:24-bookworm-slim@sha256:a43f7fc3e52e87d12a905f46eea0275def84ca8f2981a5b53fed44d7fb398ee0';
const DOCKERFILE='ops-prep/Dockerfile.runtime-mount.disabled',IGNORE=DOCKERFILE+'.dockerignore';
const REQUIRED_SUITES=['api-unit','api-integration','migration-compatibility','fe-unit','core-ui','deploy-controller'];
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function git(root,args,binary=false){return cp.execFileSync('git',['-C',root,...args],{encoding:binary?undefined:'utf8',maxBuffer:32*1024*1024,windowsHide:true});}
function identity(env,commit,local){
 assert(/^[a-f0-9]{40}$/.test(commit),'Exact source commit required');
 if(local){assert(env.GITHUB_ACTIONS!=='true','CI cannot claim local-build mode');return {mode:'local-unqualified',repository:REPOSITORY,sourceCommit:commit,workflowPath:null,runId:null,runAttempt:null,authenticated:false};}
 assert.equal(env.GITHUB_ACTIONS,'true','Use --local-build outside Actions');assert.equal(env.GITHUB_REPOSITORY,REPOSITORY,'Untrusted repository');assert.equal(env.GITHUB_SHA,commit,'CI source mismatch');assert.equal(env.GITHUB_REF,'refs/heads/main','Only main builds are supported');assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch','Manual image build only');assert.equal(env.GITHUB_WORKFLOW_REF,REPOSITORY+'/'+WORKFLOW+'@refs/heads/main','Unexpected workflow path');assert(/^\d+$/.test(env.GITHUB_RUN_ID||''));assert(/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT||''));
 return {mode:'github-actions-build',repository:REPOSITORY,sourceCommit:commit,workflowPath:WORKFLOW,runId:env.GITHUB_RUN_ID,runAttempt:env.GITHUB_RUN_ATTEMPT,authenticated:false};
}
function sourceManifest(root,commit){
 const names=git(root,['ls-tree','-r','--name-only',commit,'--','migrations']).trim().split('\n').filter(name=>/^migrations\/\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
 const rows=names.map(name=>({version:path.posix.basename(name),checksum:hash(git(root,['show',commit+':'+name],true))}));
 const privilegesSha256=hash(git(root,['show',commit+':migrations/repeatable/privileges.sql'],true));
 schema54.validateManifest({migrations:rows,privilegesSha256});
 return {rows,privilegesSha256,manifestSha256:hash(Buffer.from(JSON.stringify(rows)))};
}
function stageContext(root,commit,destination){
 assert(!fs.existsSync(destination),'Preserve existing build context');
 const roots=['package.json','package-lock.json','tsconfig.json','tsconfig.build.json','src','scripts','migrations','certs/supabase-prod-ca-2021.crt'];
 const entries=git(root,['ls-tree','-r',commit,'--',...roots]).trim().split('\n').map(line=>{const match=/^(100644|100755) blob [a-f0-9]{40}\t(.+)$/.exec(line);assert(match,'Nonregular context input');return match[2];});
 fs.mkdirSync(destination,{recursive:true});const files=[];
 for(const name of entries){assert(!/(^|\/)(?:\.env(?:\..*)?|\.git|\.credentials[^/]*|private-textbook[^/]*|node_modules)(\/|$)/i.test(name));assert(!name.split('/').includes('..'));const bytes=git(root,['show',commit+':'+name],true),target=path.join(destination,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});files.push({path:name,sha256:hash(bytes),bytes:bytes.length});}
 for(const [source,target]of [[DOCKERFILE,'Dockerfile'],[IGNORE,'.dockerignore']]){const bytes=git(root,['show',commit+':'+source],true);fs.writeFileSync(path.join(destination,target),bytes,{flag:'wx'});files.push({path:target,sourcePath:source,sha256:hash(bytes),bytes:bytes.length});}
 const dockerfile=fs.readFileSync(path.join(destination,'Dockerfile'),'utf8');assert.equal(dockerfile.split('\n').filter(line=>line.startsWith('FROM ')).length,2);assert(dockerfile.split('\n').filter(line=>line.startsWith('FROM ')).every(line=>line.includes(BASE)));assert(dockerfile.includes('USER node'));assert(dockerfile.includes('https://github.com/'+REPOSITORY));assert(dockerfile.includes('CMD ["node", "/run/hanq-production/bootstrap.mjs"]'));assert(!/COPY .*private-textbook/.test(dockerfile));
 const lock=JSON.parse(fs.readFileSync(path.join(destination,'package-lock.json'),'utf8'));assert(Object.values(lock.packages).filter(pkg=>pkg.resolved).every(pkg=>new URL(pkg.resolved).hostname==='registry.npmjs.org'),'Unexpected package source');
 return {files,privateMaterialIncluded:false,dockerfilePath:DOCKERFILE,dockerfileSha256:hash(Buffer.from(dockerfile))};
}
function tarEntries(bytes,visit){
 let nextName,count=0;for(let offset=0;offset+512<=bytes.length;){const header=bytes.subarray(offset,offset+512);if(header.every(byte=>byte===0))break;assert(++count<200000,'Too many tar entries');const text=(a,b)=>header.subarray(a,b).toString('utf8').replace(/\0.*$/s,'');const checksum=text(148,156).trim();assert(/^[0-7]+$/.test(checksum),'Invalid tar header checksum');let sum=0;for(let index=0;index<512;index++)sum+=index>=148&&index<156?32:header[index];assert.equal(sum,parseInt(checksum,8),'Tar header checksum mismatch');let name=text(0,100);const prefix=text(345,500);if(prefix)name=prefix+'/'+name;const sizeText=text(124,136).trim();assert(/^[0-7]+$/.test(sizeText),'Unsupported tar size');const size=parseInt(sizeText,8),type=text(156,157);assert(Number.isSafeInteger(size)&&offset+512+size<=bytes.length,'Invalid tar bounds');const data=bytes.subarray(offset+512,offset+512+size);offset+=512+Math.ceil(size/512)*512;if(type==='x'){for(const line of data.toString('utf8').split('\n')){const match=/^\d+ path=(.*)$/.exec(line);if(match)nextName=match[1];}continue;}if(type==='L'){nextName=data.toString('utf8').replace(/\0.*$/s,'');continue;}name=(nextName||name).replace(/^\.\//,'');nextName=undefined;visit({name,type,data});}
}
function verifyOciArchive(bytes,{imageId,configId,sourceCommit}){
 assert(/^sha256:[a-f0-9]{64}$/.test(imageId));assert(/^sha256:[a-f0-9]{64}$/.test(configId));const wanted=new Set(['index.json','blobs/sha256/'+imageId.slice(7),'blobs/sha256/'+configId.slice(7)]),found=new Map();
 tarEntries(bytes,entry=>{if(!wanted.has(entry.name))return;assert(entry.type==='0'||entry.type==='','Proof must be a regular file');assert(!found.has(entry.name),'Duplicate OCI proof');assert(entry.data.length<=4*1024*1024,'Oversized OCI metadata');found.set(entry.name,entry.data);});assert.equal(found.size,3,'OCI manifest/config proof missing');
 const index=JSON.parse(found.get('index.json')),manifestBytes=found.get('blobs/sha256/'+imageId.slice(7)),configBytes=found.get('blobs/sha256/'+configId.slice(7));assert(index.manifests.some(item=>item.digest===imageId),'Runtime digest absent from OCI index');assert.equal('sha256:'+hash(manifestBytes),imageId);const manifest=JSON.parse(manifestBytes);assert.equal(manifest.config?.digest,configId,'Runtime ID must identify a single image manifest, not an attestation/index');assert(Array.isArray(manifest.layers));assert.equal('sha256:'+hash(configBytes),configId);const config=JSON.parse(configBytes);assert.equal(config.os,'linux');assert.equal(config.architecture,'amd64');assert.equal(config.config.User,'node');assert.equal(config.config.Labels['org.opencontainers.image.source'],'https://github.com/'+REPOSITORY);assert.equal(config.config.Labels['org.opencontainers.image.revision'],sourceCommit);assert.deepEqual(config.config.Cmd,['node','/run/hanq-production/bootstrap.mjs']);
 return {imageId,imageConfigDigest:configId,sourceCommit,platform:'linux/amd64',user:'node',singleManifestVerified:true};
}
function qualification(){return {productionQualified:false,deploymentPerformed:false,requiredSuites:REQUIRED_SUITES.map(name=>({name,status:'not_run',conclusion:'unverified'})),blockers:['Six complete suites and authenticated functional receipt are not produced by image build','Installed controller trusts the original repository/functional.yml and hanq-release-evidence artifact prefix','Observed controller allows six mounts; approved runtime includes readonly private audio and must be preserved','External semantic bundle needs separately reviewed readonly mount and readability/integrity tests','Native controller/approval/compose/bootstrap and rollback must be reviewed before cutover']};}
module.exports={REPOSITORY,WORKFLOW,BASE,DOCKERFILE,REQUIRED_SUITES,hash,git,identity,sourceManifest,stageContext,tarEntries,verifyOciArchive,qualification};

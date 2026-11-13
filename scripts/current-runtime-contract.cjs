'use strict';
// OFFLINE CANDIDATE. Pure additional contracts; never executes Docker, SQL, builds or uploads.
const A=require('node:assert/strict'),crypto=require('node:crypto');
const PROFILE='schema61-local-private-retained-base';
const BRANCH='release/source-grading-current-runtime';
const REF='refs/heads/'+BRANCH;
const REPOSITORY='hddooo/file-island-api',WORKFLOW='.github/workflows/functional.yml';
const BASE='sha256:495cd87f834108a61ad81a53260d30a619f4ec4ee15b8d909a3cfc1ef768a4f6';
const LEDGER='c27f38853d20daa55a8b2e4047515b5efec43a79c7ed2feae563218aba34c8d8';
const TARGETED='7b7985167b9209d09edd84c05b235b5943a9ddc3129613e5ce804c19c83fa61e';
const EMBEDDED='5fd973a46c28e560b9f02eb8852423ebe50544a92ae3d8ee2013b663de69a3cf';
const BOOTSTRAP='acd7ff5192d5fd31995b75210a9e869723b6ecd2d52da634f0dc6a1bbd076e62';
const TARGET='/app/dist/src/textbook/source-blank-progress.js';
const FOUR_PROFILE='schema61-four-existing-js-v1';
const FOUR_PATHS=['source-blank-progress.js','textbook.controller.js','history81.controller.js','history81.service.js'].map(n=>'/app/dist/src/textbook/'+n);
const FIVE_PROFILE='schema61-five-existing-js-login-v1';
const FIVE_PATHS=[...FOUR_PATHS,'/app/dist/src/premium/premium.controller.js'];
function filePaths(profile){A(profile===FOUR_PROFILE||profile===FIVE_PROFILE,'unknown fixed file-set profile');return profile===FIVE_PROFILE?FIVE_PATHS:FOUR_PATHS;}
const sha=/^[a-f0-9]{40}$/,hex=/^[a-f0-9]{64}$/,digest=/^sha256:[a-f0-9]{64}$/;
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function producer(env,commit){
 A(sha.test(commit||''),'resolved recipe/source commit required');
 A.equal(env.HANQ_FUNCTIONAL_QUALIFICATION_PROFILE,PROFILE);
 A.equal(env.GITHUB_ACTIONS,'true');A.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');
 A.equal(env.GITHUB_REPOSITORY,REPOSITORY);A.equal(env.GITHUB_REF,REF);
 A.equal(env.GITHUB_SHA,commit);A.equal(env.GITHUB_WORKFLOW_REF,REPOSITORY+'/'+WORKFLOW+'@'+REF);
 A(/^\d+$/.test(env.GITHUB_RUN_ID||'')&&Number.isSafeInteger(Number(env.GITHUB_RUN_ID)));
 A(/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT||'')&&Number.isSafeInteger(Number(env.GITHUB_RUN_ATTEMPT)));
 return {repository:REPOSITORY,workflowPath:WORKFLOW,sourceCommit:commit,headBranch:BRANCH,runId:env.GITHUB_RUN_ID,runAttempt:Number(env.GITHUB_RUN_ATTEMPT),authenticated:false};
}
function rows(input,count){A(Array.isArray(input)&&input.length===count);A.equal(new Set(input.map(r=>r.version)).size,count);for(const r of input){A(/^\d{3}_[a-z0-9_]+\.sql$/.test(r.version));A(hex.test(r.checksum));}return input.map(({version,checksum})=>({version,checksum})).sort((a,b)=>a.version.localeCompare(b.version));}
function ledgerHash(input){return hash(JSON.stringify(input));}
function schema(input){
 A.equal(input.qualificationProfile,PROFILE);A.equal(input.baselineImageId,BASE);A.equal(input.bootstrapSha256,BOOTSTRAP);
 const top=rows(input.imageMigrations,59);A(!top.some(r=>/^064_/.test(r.version)),'source064 must not be copied into image');
 A.deepEqual(input.targeted056,{version:'056_private_script_artifacts.sql',checksum:TARGETED});
 A.deepEqual(input.bootstrap064,{version:'064_hongmungwan.sql',checksum:EMBEDDED});
 const union=rows([...top,input.targeted056,input.bootstrap064],61);A.equal(ledgerHash(union),LEDGER,'exact original SQL byte ledger required');
 A.equal(input.ledgerBeforeSha256,LEDGER);A.equal(input.ledgerAfterSha256,LEDGER);
 A.deepEqual(input.startArgv,['node','/run/hanq-production/bootstrap.mjs']);
 return {rows:union,manifestSha256:LEDGER,baselineCount:61,targetCount:61,expectedApplied:0,operationalMigrationAllowed:false};
}
function artifactPaths(profile,paths){A.equal(profile,PROFILE);A.deepEqual(paths,['release-evidence.json'],'private image/archive upload forbidden');return paths;}
function inventory(value,actual){
 A.equal(value.version,1);A.equal(value.qualificationProfile,PROFILE);A.equal(value.frozen,true);
 A.deepEqual(Object.keys(value.suites).sort(),['integration','unit']);
 for(const mode of ['unit','integration']){const selected=value.suites[mode];A(Array.isArray(selected)&&selected.length>0);A.equal(new Set(selected.map(x=>x.path)).size,selected.length);A.deepEqual(selected.map(x=>x.path),selected.map(x=>x.path).sort());for(const row of selected){A(new RegExp('^test/'+mode+'/[a-z0-9-]+\\.test\\.ts$').test(row.path));A(/^[a-f0-9]{40}$/.test(row.gitBlob));A(hex.test(row.sha256));}A.deepEqual(selected,actual[mode],'all committed test files and bytes required');}
 return value;
}
function stableDigest(value){const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;return hash(JSON.stringify(stable(value)));}
function localPrivate(proof,pins,baselineInventory,candidateConfig){
 A.equal(pins.qualificationProfile,PROFILE);A.equal(pins.baseImageId,BASE);A.equal(proof.baselineImageId,BASE);
 for(const k of ['candidateImageId','imageConfigDigest']){A(digest.test(pins[k]||''));A.equal(proof[k],pins[k]);}
 A(hex.test(pins.archiveSha256||''));A.equal(proof.archiveSha256,pins.archiveSha256);
 A(sha.test(pins.sourceCommit||''));A.equal(proof.sourceCommit,pins.sourceCommit,'verified OCI revision required');A.equal(candidateConfig.config.Labels['org.opencontainers.image.revision'],pins.sourceCommit);
 A(hex.test(pins.baselineInventorySha256||''));A.equal(stableDigest(baselineInventory),pins.baselineInventorySha256);A.equal(proof.baselineInventorySha256,pins.baselineInventorySha256,'stream-verified baseline inventory required');
 const privateFiles=baselineInventory.filter(r=>r.path.startsWith('/app/private-textbook-semantic-data/')&&r.type==='file');
 A.equal(privateFiles.length,298);A.equal(privateFiles.reduce((n,r)=>n+r.size,0),25667774);
 if(pins.fileSetProfile===FOUR_PROFILE||pins.fileSetProfile===FIVE_PROFILE){
  A.equal(proof.fileSetProfile,pins.fileSetProfile);for(const key of ['allowedDeltaSha256','layerDeltaSha256']){A(hex.test(pins[key]||''));A.equal(proof[key],pins[key]);}
  A.deepEqual(pins.verifiedFiles?.map(f=>f.path),filePaths(pins.fileSetProfile),'exact ordered approved existing files required');A.deepEqual(proof.verifiedFiles,pins.verifiedFiles,'stream-verified file list differs from independent source pins');
  for(const f of pins.verifiedFiles){A.deepEqual(Object.keys(f).sort(),['path','beforeSha256','afterSha256','beforeSize','afterSize','mode','uid','gid'].sort());A(hex.test(f.beforeSha256)&&hex.test(f.afterSha256));A.notEqual(f.beforeSha256,f.afterSha256);A(Number.isSafeInteger(f.afterSize)&&f.afterSize>0);const matches=baselineInventory.filter(r=>r.path===f.path);A.equal(matches.length,1);const old=matches[0];A.equal(old.type,'file');A.equal(old.sha256,f.beforeSha256);A.equal(old.size,f.beforeSize);for(const k of ['mode','uid','gid'])A.equal(old[k],f[k],'unchanged file metadata required');}
 }else{A.equal(pins.fileSetProfile,undefined,'unknown file-set profile');A.equal(proof.gradingPath,TARGET);}
 A.equal(proof.productionEnabled,false);
 // ONLY call inside withVerifiedArchive consume callback: stream verifier proves prefix + sole allowed delta.
 return {mode:'local-private-retained-base',baseImageId:BASE,privateBundleAbsent:false,privateBundlePresent:true,privateBundlePreserved:true,externalArchiveUploadAllowed:false,productionQualified:false};
}
function resolvedPins(p){for(const key of ['sourceCommit','frontendCommit','deployCommit'])A(sha.test(p[key]||''),'Unresolved '+key);for(const key of ['candidateImageId','imageConfigDigest'])A(digest.test(p[key]||''),'Unresolved '+key);for(const key of ['archiveSha256','controllerSha256','baselineInventorySha256','baselineAncestorObservationSha256','testInventorySha256','composeChainSha256','readonlyMountsSha256'])A(hex.test(p[key]||''),'Unresolved '+key);A.equal(p.qualificationProfile,PROFILE);return p;}
module.exports={PROFILE,BRANCH,REF,REPOSITORY,WORKFLOW,BASE,LEDGER,TARGETED,EMBEDDED,BOOTSTRAP,TARGET,FOUR_PROFILE,FOUR_PATHS,FIVE_PROFILE,FIVE_PATHS,filePaths,hash,stableDigest,producer,schema,artifactPaths,inventory,localPrivate,resolvedPins};


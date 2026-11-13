'use strict';
// Produces execution evidence, never deployment approval or authenticated provenance.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const P=require('./functional-schema-profile.cjs'),R=require('./current-runtime-contract.cjs'),{fileHash:hashFileBounded}=require('./bounded-file-hash.cjs');
const REPOSITORY='hddooo/file-island-api',WORKFLOW='.github/workflows/functional.yml';
const SUITES=['api-unit','api-integration','migration-compatibility','fe-unit','core-ui','deploy-controller'];
const CASES={
 'api-integration':['auth-session','profile-contract','collection-concurrency','server-hatch-clock','xp-preservation'],
 'migration-compatibility':['baseline-checksums','restore-and-upgrade','idempotent-migrations','legacy-xp-preserved','rollback-schema-compatible'],
 'core-ui':['login-session-restore','mypage-profile','zero-coin-egg','unique-family','server-hatch-60s','partner-switch','equipped-only-xp','stored-xp-preserved','account-xp-sum','pending-features-locked'],
};
const sha=/^[a-f0-9]{40}$/,hex=/^[a-f0-9]{64}$/,digest=/^sha256:[a-f0-9]{64}$/;
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const must=(x,message)=>assert(x,'Functional evidence: '+message);
const FAILURE_KINDS=['process-error','process-signal','child-exit','configuration-rejected','source-rejected','module-not-found','docker-failed','assertion-failed','tap-invalid','contract-rejected'];
function safeFailure(error){const f=error?.functionalFailure;if(!f||!FAILURE_KINDS.includes(f.kind))return {kind:'contract-rejected'};return {kind:f.kind,...(Number.isInteger(f.exitCode)?{exitCode:f.exitCode}:{}),...(hex.test(f.rawOutputSha256||'')?{rawOutputSha256:f.rawOutputSha256}:{})};}
function executionFailure(error,result,raw){let kind='tap-invalid';if(result.error)kind='process-error';else if(result.signal)kind='process-signal';else if(result.status!==0){kind='child-exit';if(raw.includes('MODULE_NOT_FOUND'))kind='module-not-found';else if(/(?:Migration harness rejected its configuration|Invalid (?:core UI|functional API) configuration)/.test(raw))kind='configuration-rejected';else if(raw.includes('Tracked Node test list/source verification failed'))kind='source-rejected';else if(/(?:Isolated migration Docker|Core UI docker|Functional API docker)/.test(raw))kind='docker-failed';else if(raw.includes('ERR_ASSERTION'))kind='assertion-failed';}error.functionalFailure={kind,exitCode:result.status,rawOutputSha256:hash(raw)};return error;}
function manifestHash(rows){return hash(JSON.stringify([...rows].map(({version,checksum})=>({version,checksum})).sort((a,b)=>a.version.localeCompare(b.version))));}

// Owner-approved single-release declaration. Deployment additionally binds exact release bytes.
const RELEASE_EXCEPTION=Object.freeze({id:'opening-era-migration-waiver-20261113',waivedSuite:'migration-compatibility',priorFailedRunId:'43387349864',reason:'owner-approved-one-release',status:'waived'});
function releaseException(b){
 if(!Object.prototype.hasOwnProperty.call(b,'releaseException'))return undefined;
 must(b.qualificationProfile===P.SCHEMA61,'release exception requires exact current profile');
 const x=b.releaseException;must(x&&typeof x==='object'&&!Array.isArray(x)&&JSON.stringify(Object.keys(x).sort())===JSON.stringify(Object.keys(RELEASE_EXCEPTION).sort()),'release exception keys mismatch');
 for(const k of Object.keys(RELEASE_EXCEPTION))must(x[k]===RELEASE_EXCEPTION[k],'release exception value mismatch');
 return {...RELEASE_EXCEPTION};
}
function waivedMigration(b){
 const x=releaseException(b);must(x,'explicit release exception required');
 return {name:'migration-compatibility',status:'not-executed',conclusion:'waived',sourceCommit:b.apiCommit,imageId:b.imageId,migrationManifestSha256:b.migrationManifestSha256,tests:0,passed:0,failed:0,skipped:0,cancelled:0,todo:0,caseIds:[],caseProofs:{},executions:[],releaseExceptionId:x.id};
}
function validateWaivedMigration(r,b){const expected=waivedMigration(b);must(JSON.stringify(Object.keys(r).sort())===JSON.stringify(Object.keys(expected).sort()),'waiver receipt keys mismatch');for(const k of Object.keys(expected))must(JSON.stringify(r[k])===JSON.stringify(expected[k]),'waiver receipt value mismatch: '+k);return r;}

function validateBindings(b){
 const exception=releaseException(b);
 const profile=P.name(b.qualificationProfile);
 for(const field of ['apiCommit','frontendCommit','deployCommit'])must(sha.test(b[field]),'exact '+field+' required');
 for(const field of ['imageId','imageConfigDigest'])must(digest.test(b[field]),field+' missing');
 for(const field of ['archiveSha256','composeSha256','bootstrapSha256','controllerSha256'])must(hex.test(b[field]),field+' missing');
 must(b.databaseTarget==='hanq_final_20261028','wrong intended deployment target');
 if(profile===P.SCHEMA61){const inspection=require('./current-runtime-inspection-bridge.cjs').binding(b.inspection);const schema=P.manifest(b.schemaContract,profile);must(b.bootstrapSha256===R.BOOTSTRAP,'Exact retained normal bootstrap required');must(b.privilegesSha256===schema.privilegesSha256,'Privileges binding mismatch');must(hex.test(b.testInventorySha256),'Independently pinned complete test inventory required');must(JSON.stringify(b.migrations)===JSON.stringify(schema.rows),'Exact composed schema61 binding required');return {qualificationProfile:profile,...(exception?{releaseException:exception}:{}),inspection,...Object.fromEntries(['apiCommit','frontendCommit','deployCommit','imageId','imageConfigDigest','archiveSha256','composeSha256','bootstrapSha256','controllerSha256','databaseTarget','privilegesSha256','testInventorySha256'].map(k=>[k,b[k]])),schemaContract:JSON.parse(JSON.stringify(b.schemaContract)),migrations:schema.rows,migrationManifestSha256:schema.manifestSha256};}
 if(profile===P.SCHEMA55)P.manifest({migrations:b.migrations,privilegesSha256:b.privilegesSha256},profile);
 const count=profile===P.SCHEMA55?55:54;
 must(Array.isArray(b.migrations)&&b.migrations.length===count,'schema54 required unless explicit reviewed schema55 qualification');
 const names=b.migrations.map(x=>x.version);must(new Set(names).size===count&&names.every(x=>/^\d{3}_[a-z0-9_]+\.sql$/.test(x)),'invalid migration inventory');
 must(names.some(x=>/^055_/.test(x))&&!names.some(x=>new RegExp(profile===P.SCHEMA55?'^047_':'^(047|056)_').test(x)),'unexpected migration boundary');
 must(b.migrations.every(x=>hex.test(x.checksum)),'migration checksum missing');
 const fields=['apiCommit','frontendCommit','deployCommit','imageId','imageConfigDigest','archiveSha256','composeSha256','bootstrapSha256','controllerSha256','databaseTarget'];
 return {...Object.fromEntries(fields.map(key=>[key,b[key]])),...(profile===P.SCHEMA55?{qualificationProfile:profile,privilegesSha256:b.privilegesSha256}:{}),migrations:b.migrations.map(({version,checksum})=>({version,checksum})),migrationManifestSha256:manifestHash(b.migrations)};
}
function requiredCases(suite,b){return P.cases(suite,CASES[suite]||[],b.qualificationProfile);}
function identity(env,apiCommit,profile=P.SCHEMA54){
 if(P.name(profile)===P.SCHEMA61)return R.producer(env,apiCommit);
 must(env.GITHUB_ACTIONS==='true','functional artifacts require the trusted Actions workflow; local output stays diagnostic');
 must(env.GITHUB_REPOSITORY===REPOSITORY&&env.GITHUB_SHA===apiCommit,'repository/source mismatch');
 must(env.GITHUB_REF==='refs/heads/main'&&['push','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME),'main push/manual only');
 must(env.GITHUB_WORKFLOW_REF===REPOSITORY+'/'+WORKFLOW+'@refs/heads/main','functional workflow required; image.yml is ineligible');
 must(/^\d+$/.test(env.GITHUB_RUN_ID||'')&&Number.isSafeInteger(Number(env.GITHUB_RUN_ID)),'run identity missing');
 must(/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT||'')&&Number.isSafeInteger(Number(env.GITHUB_RUN_ATTEMPT)),'attempt missing');
 return {repository:REPOSITORY,workflowPath:WORKFLOW,sourceCommit:apiCommit,headBranch:'main',runId:env.GITHUB_RUN_ID,runAttempt:Number(env.GITHUB_RUN_ATTEMPT),authenticated:false};
}
function parseTap(text,exitCode){
 must(exitCode===0,'test process did not exit successfully');
 const counts={};for(const field of ['tests','pass','fail','skipped','cancelled','todo']){
  const matches=[...text.matchAll(new RegExp('^# '+field+' (\\d+)\\r?$','gm'))];must(matches.length===1,'exactly one final TAP '+field+' summary required');counts[field]=Number(matches[0][1]);
 }
 must(Number.isSafeInteger(counts.tests)&&counts.tests>0&&counts.pass===counts.tests,'incomplete tests');
 for(const field of ['fail','skipped','cancelled','todo'])must(counts[field]===0,'nonzero '+field);
 must(!/^\s*not ok\b/m.test(text)&&!/^\s*(?:ok|not ok)\b[^\r\n]*#\s*(?:SKIP|TODO)\b/im.test(text)&&!/^\s*Bail out!/im.test(text),'failed/skipped/bailing TAP subtest');
 const passedTitles=[...text.matchAll(/^\s*ok\s+\d+\s+-\s+([^\r\n]+)$/gm)].map(x=>x[1]);
 must(passedTitles.length>=counts.tests,'TAP test inventory smaller than count');
 return {tests:counts.tests,passed:counts.pass,failed:0,skipped:0,cancelled:0,todo:0,passedTitles};
}
function executeStep(step,cwd,env={}){
 must(step&&typeof step.script==='string'&&/^[a-zA-Z0-9_./-]+\.c?js$/.test(step.script)&&!step.script.split('/').includes('..'),'reviewed relative Node script required');
 must(Array.isArray(step.args)&&step.args.every(x=>typeof x==='string'&&x.length<4096&&!/[\r\n\0]/.test(x)),'invalid arguments');
 must(Number.isSafeInteger(step.timeoutMs)&&step.timeoutMs>=1000&&step.timeoutMs<=3600000,'explicit bounded timeout required');
 const script=path.resolve(cwd,step.script);must(script.startsWith(path.resolve(cwd)+path.sep),'script escapes checkout');
 const startedAt=new Date().toISOString(),result=cp.spawnSync(process.execPath,['--test-reporter=tap',script,...step.args],{cwd,env,encoding:'utf8',shell:false,windowsHide:true,timeout:step.timeoutMs,maxBuffer:64*1024*1024});
 const raw=(result.stdout||'')+'\n'+(result.stderr||'');
 let parsed;try{must(!result.error&&!result.signal,'test process errored, timed out or was killed');parsed=parseTap(raw,result.status);}catch(error){throw executionFailure(error,result,raw);}
 return {...parsed,startedAt,finishedAt:new Date().toISOString(),exitCode:result.status,rawOutputSha256:hash(raw),scriptSha256:hash(fs.readFileSync(script)),rawOutputExported:false};
}
function sourceFor(name,b){return name==='fe-unit'?b.frontendCommit:name==='deploy-controller'?b.deployCommit:b.apiCommit;}
function validateSuite(receipt,b){
 if(receipt?.conclusion==='waived')return validateWaivedMigration(receipt,b);
 must(SUITES.includes(receipt?.name),'unsupported suite');must(receipt.sourceCommit===sourceFor(receipt.name,b),'suite source mismatch');
 must(receipt.status==='completed'&&receipt.conclusion==='success','suite did not complete successfully');
 must(Number.isSafeInteger(receipt.tests)&&receipt.tests>0&&receipt.passed===receipt.tests,'incomplete suite count');
 for(const field of ['failed','skipped','cancelled','todo'])must(receipt[field]===0,'suite '+field+' must be zero');
 must(Array.isArray(receipt.executions)&&receipt.executions.length>0,'real executions required');
 must(receipt.executions.every(x=>x.exitCode===0&&hex.test(x.rawOutputSha256)&&hex.test(x.scriptSha256)&&Number.isSafeInteger(x.tests)&&x.tests>0&&x.passed===x.tests&&['failed','skipped','cancelled','todo'].every(f=>x[f]===0)),'invalid process execution');
 must(receipt.executions.reduce((n,x)=>n+x.tests,0)===receipt.tests,'execution/suite count mismatch');
 const required=requiredCases(receipt.name,b);must(Array.isArray(receipt.caseIds)&&new Set(receipt.caseIds).size===receipt.caseIds.length,'duplicate/invalid cases');
 must(required.every(x=>receipt.caseIds.includes(x))&&receipt.tests>=required.length,'required functional case missing');
 must(receipt.caseProofs&&required.every(id=>receipt.caseProofs[id]?.executionIndex>=0&&receipt.caseProofs[id].executionIndex<receipt.executions.length&&hex.test(receipt.caseProofs[id].testTitleSha256)),'case execution proof missing');
 if(['api-integration','migration-compatibility','core-ui'].includes(receipt.name))must(receipt.imageId===b.imageId,'tested another image');
 if(receipt.name==='core-ui')must(receipt.frontendCommit===b.frontendCommit,'tested another UI source');
 if(receipt.name==='migration-compatibility')must(receipt.migrationManifestSha256===b.migrationManifestSha256,'migration suite mismatch');
 return receipt;
}
function suiteFromExecutions(name,b,steps,caseTitles){
 must(SUITES.includes(name)&&steps.length>0,'suite/steps missing');const caseProofs={};
 for(const id of requiredCases(name,b)){const title=caseTitles?.[id];must(typeof title==='string'&&title.length>0,'reviewed exact title missing for '+id);const indexes=steps.flatMap((x,i)=>x.passedTitles.includes(title)?[i]:[]);must(indexes.length===1,'required case did not pass exactly once: '+id);caseProofs[id]={executionIndex:indexes[0],testTitleSha256:hash(title)};}
 const executions=steps.map(step=>{const copy={...step};delete copy.passedTitles;return copy;});
 const receipt={name,status:'completed',conclusion:'success',sourceCommit:sourceFor(name,b),tests:steps.reduce((n,x)=>n+x.tests,0),passed:steps.reduce((n,x)=>n+x.passed,0),failed:0,skipped:0,cancelled:0,todo:0,caseIds:Object.keys(caseProofs),caseProofs,executions};
 if(['api-integration','migration-compatibility','core-ui'].includes(name))receipt.imageId=b.imageId;
 if(name==='core-ui')receipt.frontendCommit=b.frontendCommit;
 if(name==='migration-compatibility')receipt.migrationManifestSha256=b.migrationManifestSha256;
 return validateSuite(receipt,b);
}
function evidenceRuntimeBinding(b){if(b.qualificationProfile!==P.SCHEMA61)return {};must(hex.test(b.inspection?.currentRuntimeSha256),'verified current runtime hash required');return {currentRuntimeSha256:b.inspection.currentRuntimeSha256};}
function compose(bindings,receipts,env){
 const b=validateBindings(bindings),producer=identity(env,b.apiCommit,b.qualificationProfile);
 P.producerProfile(b.qualificationProfile,env);
 must(Array.isArray(receipts)&&receipts.length===SUITES.length&&new Set(receipts.map(x=>x.name)).size===SUITES.length,'exactly six suites required');
 const suites=SUITES.map(name=>validateSuite(receipts.find(x=>x.name===name),b));
 return {version:2,kind:'functional-execution-evidence',...b,...evidenceRuntimeBinding(b),buildRunId:producer.runId,producer,executionPhase:'completed',workflowStatus:'in_progress',workflowConclusion:null,fork:false,productionWrites:false,productionQualified:false,authenticated:false,suites,completionRequirement:'Deployment requires independently authenticated completed/success current run AND exact attempt, plus authenticated artifact bytes. This receipt does not claim final workflow status.'};
}
function git(cwd,args){return cp.execFileSync('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024}).trim();}
function verifyInputBytes(b,roots){
 const input=roots.inputs;must(input&&typeof input==='object','actual input file paths required');
 for(const [name,key]of [['archive','archiveSha256'],['compose','composeSha256'],['bootstrap','bootstrapSha256']]){
  must(typeof input[name]==='string'&&fs.lstatSync(input[name]).isFile()&&!fs.lstatSync(input[name]).isSymbolicLink(),'regular '+name+' file required');
  must((name==='archive'?hashFileBounded(input[name]):hash(fs.readFileSync(input[name])))===b[key],name+' byte hash mismatch');
 }
 const controller=path.join(roots.deploy,'scripts/deploy.cjs');must(hash(fs.readFileSync(controller))===b.controllerSha256,'controller bundle byte hash mismatch');
 if(P.name(b.qualificationProfile)===P.SCHEMA61){require('./current-runtime-test-inventory.cjs').committedInventory(roots.api,b.apiCommit,'ops-prep/functional-current-runtime-test-inventory.json',b.testInventorySha256);const committed=JSON.parse(git(roots.api,['show',b.apiCommit+':ops-prep/functional-current-runtime-schema.json']));must(JSON.stringify(committed)===JSON.stringify(b.schemaContract),'Schema contract differs from committed recipe bytes');return require('./current-runtime-inspection-bridge.cjs').verify(b,roots);}
 const source=require('./image-build-contract.cjs').sourceManifest(roots.api,b.apiCommit,P.buildProfile(b.qualificationProfile));must(source.manifestSha256===b.migrationManifestSha256,'Schema differs from committed Git LF bytes');
 const image=JSON.parse(fs.readFileSync(input.imageReceipt,'utf8'));
 if(P.name(b.qualificationProfile)===P.SCHEMA54)must(image.migrationProfile===undefined||image.migrationProfile==='schema54','schema55 image-only receipt is ineligible for schema54 functional qualification');
 else must(image.migrationProfile==='schema55-image-only'&&image.productionQualified===false&&image.operationalMigrationAllowed===false,'Schema55 image inventory never supplies functional or operating permission');
 require('./image-build-contract.cjs').validateSourceReceipt(b.apiCommit,source,image);
 must(image.kind==='api-image-build-only'&&image.repository===REPOSITORY&&image.sourceCommit===b.apiCommit&&image.imageId===b.imageId&&image.imageConfigDigest===b.imageConfigDigest&&image.archiveSha256===b.archiveSha256&&image.migrationManifestSha256===b.migrationManifestSha256,'image build/source/input receipt mismatch');
}
function executePlan(plan,roots,env,observe=()=>{}){
 const b=validateBindings(plan.bindings);must(plan.version===1&&Array.isArray(plan.suites)&&plan.suites.length===6,'invalid execution plan');
 P.producerProfile(b.qualificationProfile,env);
 for(const key of ['api','frontend','deploy']){must(typeof roots[key]==='string','checkout path missing');must(git(roots[key],['rev-parse','HEAD'])===b[key==='api'?'apiCommit':key==='frontend'?'frontendCommit':'deployCommit'],'checkout HEAD mismatch');must(!git(roots[key],['status','--porcelain','--untracked-files=no']),'modified tracked checkout');}
 must(typeof plan.definitionPath==='string'&&/^ops-prep\/[a-z0-9-]+\.json$/.test(plan.definitionPath),'committed execution definition required');
 const definition=JSON.parse(git(roots.api,['show',b.apiCommit+':'+plan.definitionPath]));must(JSON.stringify(definition)===JSON.stringify({version:plan.version,suites:plan.suites}),'execution definition differs from reviewed API Git blob');
 verifyInputBytes(b,roots);
 const runtimeEnv={...env};for(const key of ['api','frontend','deploy']){runtimeEnv['HANQ_FUNCTIONAL_'+key.toUpperCase()+'_ROOT']=path.resolve(roots[key]);runtimeEnv['HANQ_FUNCTIONAL_'+key.toUpperCase()+'_COMMIT']=b[key==='api'?'apiCommit':key==='frontend'?'frontendCommit':'deployCommit'];}
 runtimeEnv.HANQ_FUNCTIONAL_IMAGE_ID=b.imageId;
 runtimeEnv.HANQ_FUNCTIONAL_QUALIFICATION_PROFILE=P.name(b.qualificationProfile);
 const receipts=plan.suites.map(suite=>{must(SUITES.includes(suite.name)&&Array.isArray(suite.steps),'invalid suite plan');const key=suite.name==='fe-unit'?'frontend':suite.name==='deploy-controller'?'deploy':'api';let stage='step-source',stepIndex=0;
  if(suite.name==='migration-compatibility'&&releaseException(b)){const receipt=waivedMigration(b);observe({suite:suite.name,phase:'waived',tests:0,releaseExceptionId:receipt.releaseExceptionId});return receipt;}
  observe({suite:suite.name,phase:'starting'});
  try{const results=suite.steps.map((step,index)=>{stepIndex=index;stage='step-source';const checkout=step.checkout||key;must(['api','frontend','deploy'].includes(checkout),'invalid script checkout');must(git(roots[checkout],['ls-files','--error-unmatch','--',step.script])===step.script,'untracked executable');stage='step-execution';observe({suite:suite.name,phase:'executing',stepIndex});return executeStep(step,roots[checkout],runtimeEnv);});stage='suite-contract';const receipt=suiteFromExecutions(suite.name,b,results,suite.caseTitles);observe({suite:suite.name,phase:'passed',tests:receipt.tests});return receipt;}catch(error){observe({suite:suite.name,phase:'failed',stage,stepIndex,failure:safeFailure(error)});throw error;}});
 return compose(b,receipts,env);
}
module.exports={evidenceRuntimeBinding,RELEASE_EXCEPTION,releaseException,waivedMigration,REPOSITORY,WORKFLOW,SUITES,CASES,requiredCases,hash,manifestHash,validateBindings,identity,parseTap,executeStep,suiteFromExecutions,validateSuite,compose,verifyInputBytes,executePlan,safeFailure};

'use strict';
// Produces execution evidence, never deployment approval or authenticated provenance.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
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
function manifestHash(rows){return hash(JSON.stringify([...rows].map(({version,checksum})=>({version,checksum})).sort((a,b)=>a.version.localeCompare(b.version))));}
function validateBindings(b){
 for(const field of ['apiCommit','frontendCommit','deployCommit'])must(sha.test(b[field]),'exact '+field+' required');
 for(const field of ['imageId','imageConfigDigest'])must(digest.test(b[field]),field+' missing');
 for(const field of ['archiveSha256','composeSha256','bootstrapSha256','controllerSha256'])must(hex.test(b[field]),field+' missing');
 must(b.databaseTarget==='hanq_final_20261028','wrong intended deployment target');
 must(Array.isArray(b.migrations)&&b.migrations.length===54,'schema54 required');
 const names=b.migrations.map(x=>x.version);must(new Set(names).size===54&&names.every(x=>/^\d{3}_[a-z0-9_]+\.sql$/.test(x)),'invalid migration inventory');
 must(names.some(x=>/^055_/.test(x))&&!names.some(x=>/^(047|056)_/.test(x)),'unexpected migration boundary');
 must(b.migrations.every(x=>hex.test(x.checksum)),'migration checksum missing');
 const fields=['apiCommit','frontendCommit','deployCommit','imageId','imageConfigDigest','archiveSha256','composeSha256','bootstrapSha256','controllerSha256','databaseTarget'];
 return {...Object.fromEntries(fields.map(key=>[key,b[key]])),migrations:b.migrations.map(({version,checksum})=>({version,checksum})),migrationManifestSha256:manifestHash(b.migrations)};
}
function identity(env,apiCommit){
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
 must(!result.error&&!result.signal,'test process errored, timed out or was killed');
 const parsed=parseTap(raw,result.status);
 return {...parsed,startedAt,finishedAt:new Date().toISOString(),exitCode:result.status,rawOutputSha256:hash(raw),scriptSha256:hash(fs.readFileSync(script)),rawOutputExported:false};
}
function sourceFor(name,b){return name==='fe-unit'?b.frontendCommit:name==='deploy-controller'?b.deployCommit:b.apiCommit;}
function validateSuite(receipt,b){
 must(SUITES.includes(receipt?.name),'unsupported suite');must(receipt.sourceCommit===sourceFor(receipt.name,b),'suite source mismatch');
 must(receipt.status==='completed'&&receipt.conclusion==='success','suite did not complete successfully');
 must(Number.isSafeInteger(receipt.tests)&&receipt.tests>0&&receipt.passed===receipt.tests,'incomplete suite count');
 for(const field of ['failed','skipped','cancelled','todo'])must(receipt[field]===0,'suite '+field+' must be zero');
 must(Array.isArray(receipt.executions)&&receipt.executions.length>0,'real executions required');
 must(receipt.executions.every(x=>x.exitCode===0&&hex.test(x.rawOutputSha256)&&hex.test(x.scriptSha256)&&Number.isSafeInteger(x.tests)&&x.tests>0&&x.passed===x.tests&&['failed','skipped','cancelled','todo'].every(f=>x[f]===0)),'invalid process execution');
 must(receipt.executions.reduce((n,x)=>n+x.tests,0)===receipt.tests,'execution/suite count mismatch');
 const required=CASES[receipt.name]||[];must(Array.isArray(receipt.caseIds)&&new Set(receipt.caseIds).size===receipt.caseIds.length,'duplicate/invalid cases');
 must(required.every(x=>receipt.caseIds.includes(x))&&receipt.tests>=required.length,'required functional case missing');
 must(receipt.caseProofs&&required.every(id=>receipt.caseProofs[id]?.executionIndex>=0&&receipt.caseProofs[id].executionIndex<receipt.executions.length&&hex.test(receipt.caseProofs[id].testTitleSha256)),'case execution proof missing');
 if(['api-integration','migration-compatibility','core-ui'].includes(receipt.name))must(receipt.imageId===b.imageId,'tested another image');
 if(receipt.name==='core-ui')must(receipt.frontendCommit===b.frontendCommit,'tested another UI source');
 if(receipt.name==='migration-compatibility')must(receipt.migrationManifestSha256===b.migrationManifestSha256,'migration suite mismatch');
 return receipt;
}
function suiteFromExecutions(name,b,steps,caseTitles){
 must(SUITES.includes(name)&&steps.length>0,'suite/steps missing');const caseProofs={};
 for(const id of CASES[name]||[]){const title=caseTitles?.[id];must(typeof title==='string'&&title.length>0,'reviewed exact title missing for '+id);const indexes=steps.flatMap((x,i)=>x.passedTitles.includes(title)?[i]:[]);must(indexes.length===1,'required case did not pass exactly once: '+id);caseProofs[id]={executionIndex:indexes[0],testTitleSha256:hash(title)};}
 const executions=steps.map(step=>{const copy={...step};delete copy.passedTitles;return copy;});
 const receipt={name,status:'completed',conclusion:'success',sourceCommit:sourceFor(name,b),tests:steps.reduce((n,x)=>n+x.tests,0),passed:steps.reduce((n,x)=>n+x.passed,0),failed:0,skipped:0,cancelled:0,todo:0,caseIds:Object.keys(caseProofs),caseProofs,executions};
 if(['api-integration','migration-compatibility','core-ui'].includes(name))receipt.imageId=b.imageId;
 if(name==='core-ui')receipt.frontendCommit=b.frontendCommit;
 if(name==='migration-compatibility')receipt.migrationManifestSha256=b.migrationManifestSha256;
 return validateSuite(receipt,b);
}
function compose(bindings,receipts,env){
 const b=validateBindings(bindings),producer=identity(env,b.apiCommit);
 must(Array.isArray(receipts)&&receipts.length===SUITES.length&&new Set(receipts.map(x=>x.name)).size===SUITES.length,'exactly six suites required');
 const suites=SUITES.map(name=>validateSuite(receipts.find(x=>x.name===name),b));
 return {version:2,kind:'functional-execution-evidence',...b,buildRunId:producer.runId,producer,executionPhase:'completed',workflowStatus:'in_progress',workflowConclusion:null,fork:false,productionWrites:false,productionQualified:false,authenticated:false,suites,completionRequirement:'Deployment requires independently authenticated completed/success current run AND exact attempt, plus authenticated artifact bytes. This receipt does not claim final workflow status.'};
}
function git(cwd,args){return cp.execFileSync('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024}).trim();}
function verifyInputBytes(b,roots){
 const input=roots.inputs;must(input&&typeof input==='object','actual input file paths required');
 for(const [name,key]of [['archive','archiveSha256'],['compose','composeSha256'],['bootstrap','bootstrapSha256']]){
  must(typeof input[name]==='string'&&fs.lstatSync(input[name]).isFile()&&!fs.lstatSync(input[name]).isSymbolicLink(),'regular '+name+' file required');
  must(hash(fs.readFileSync(input[name]))===b[key],name+' byte hash mismatch');
 }
 const controller=path.join(roots.deploy,'scripts/deploy.cjs');must(hash(fs.readFileSync(controller))===b.controllerSha256,'controller bundle byte hash mismatch');
 const source=require('./image-build-contract.cjs').sourceManifest(roots.api,b.apiCommit);must(source.manifestSha256===b.migrationManifestSha256,'schema54 differs from committed Git LF bytes');
 const image=JSON.parse(fs.readFileSync(input.imageReceipt,'utf8'));
 must(image.migrationProfile===undefined||image.migrationProfile==='schema54','schema55 image-only receipt is ineligible for schema54 functional qualification');
 require('./image-build-contract.cjs').validateSourceReceipt(b.apiCommit,source,image);
 must(image.kind==='api-image-build-only'&&image.repository===REPOSITORY&&image.sourceCommit===b.apiCommit&&image.imageId===b.imageId&&image.imageConfigDigest===b.imageConfigDigest&&image.archiveSha256===b.archiveSha256&&image.migrationManifestSha256===b.migrationManifestSha256,'image build/source/input receipt mismatch');
}
function executePlan(plan,roots,env){
 const b=validateBindings(plan.bindings);must(plan.version===1&&Array.isArray(plan.suites)&&plan.suites.length===6,'invalid execution plan');
 for(const key of ['api','frontend','deploy']){must(typeof roots[key]==='string','checkout path missing');must(git(roots[key],['rev-parse','HEAD'])===b[key==='api'?'apiCommit':key==='frontend'?'frontendCommit':'deployCommit'],'checkout HEAD mismatch');must(!git(roots[key],['status','--porcelain','--untracked-files=no']),'modified tracked checkout');}
 must(typeof plan.definitionPath==='string'&&/^ops-prep\/[a-z0-9-]+\.json$/.test(plan.definitionPath),'committed execution definition required');
 const definition=JSON.parse(git(roots.api,['show',b.apiCommit+':'+plan.definitionPath]));must(JSON.stringify(definition)===JSON.stringify({version:plan.version,suites:plan.suites}),'execution definition differs from reviewed API Git blob');
 verifyInputBytes(b,roots);
 const runtimeEnv={...env};for(const key of ['api','frontend','deploy']){runtimeEnv['HANQ_FUNCTIONAL_'+key.toUpperCase()+'_ROOT']=path.resolve(roots[key]);runtimeEnv['HANQ_FUNCTIONAL_'+key.toUpperCase()+'_COMMIT']=b[key==='api'?'apiCommit':key==='frontend'?'frontendCommit':'deployCommit'];}
 runtimeEnv.HANQ_FUNCTIONAL_IMAGE_ID=b.imageId;
 const receipts=plan.suites.map(suite=>{must(SUITES.includes(suite.name)&&Array.isArray(suite.steps),'invalid suite plan');const key=suite.name==='fe-unit'?'frontend':suite.name==='deploy-controller'?'deploy':'api';
  const results=suite.steps.map(step=>{const checkout=step.checkout||key;must(['api','frontend','deploy'].includes(checkout),'invalid script checkout');must(git(roots[checkout],['ls-files','--error-unmatch','--',step.script])===step.script,'untracked executable');return executeStep(step,roots[checkout],runtimeEnv);});return suiteFromExecutions(suite.name,b,results,suite.caseTitles);});
 return compose(b,receipts,env);
}
module.exports={REPOSITORY,WORKFLOW,SUITES,CASES,hash,manifestHash,validateBindings,identity,parseTap,executeStep,suiteFromExecutions,validateSuite,compose,verifyInputBytes,executePlan};

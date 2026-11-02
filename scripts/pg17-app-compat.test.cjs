'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const {test}=require('node:test');
const C=require('./pg17-app-compat.cjs');
const source='a'.repeat(40);
const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'hddooo/file-island-api',GITHUB_EVENT_NAME:'workflow_dispatch',PG17_APP_COMPAT_OPT_IN:'true',GITHUB_SHA:source};
test('manual exact-source gate rejects push, another repository, absent opt-in and mismatched checkout',()=>{
 assert.equal(C.preflight(env,()=>source),source);
 for(const change of [{GITHUB_ACTIONS:'false'},{GITHUB_REPOSITORY:'other/repo'},{GITHUB_EVENT_NAME:'push'},{PG17_APP_COMPAT_OPT_IN:'false'},{GITHUB_SHA:'main'}])assert.throws(()=>C.preflight({...env,...change},()=>source));
 assert.throws(()=>C.preflight(env,()=> 'b'.repeat(40)));
});
test('ambient production database and remote Docker inputs are refused before execution',()=>{
 for(const key of ['DATABASE_URL','HANQ_TEST_DATABASE_URL','PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','PGSERVICEFILE','DOCKER_HOST','DOCKER_CONTEXT'])assert.throws(()=>C.preflight({...env,[key]:'untrusted'},()=>source));
});
test('application, SQL, existing tests, dependency manifests and Dockerfile remain frozen to reviewed 3af9 blobs',()=>{
 const lock=C.validateProtected();assert.equal(lock.applicationSource,C.BASE);
 assert.throws(()=>C.validateProtected(()=> '0'.repeat(40)));
 const actual=cp.spawnSync('git',['diff',C.BASE,'--',...C.PROTECTED],{encoding:'utf8'});assert.equal(actual.status,0);assert.equal(actual.stdout,'');
});
test('synthetic catalog is parseable by existing real loader without private fixtures',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hanq-pg17-catalog-check-'));try{
  fs.mkdirSync(path.join(temp,'media'));for(const [file,[global,data]] of Object.entries(C.fixture()))fs.writeFileSync(path.join(temp,'media',file),'window.'+global+'='+JSON.stringify(data)+';');
  const {loadFrontCatalog}=require('../dist/src/questions/catalog-loader.js');const rows=loadFrontCatalog(temp);
  assert.equal(rows.filter(x=>x.kind==='quiz').length,30);assert.equal(rows.filter(x=>x.kind==='mock').length,10);assert.equal(new Set(rows.map(x=>x.questionId)).size,40);
  assert(rows.every(x=>x.optionIds.includes(x.correctOptionId)));assert(rows.every(x=>x.publicPayload.options.every(o=>!Object.hasOwn(o,'correct'))));
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('selected existing HTTP suites are explicit; this does not claim the complete integration inventory',()=>{
 assert.deepEqual(C.FILES,['auth.test.js','admin-partner-xp.test.js','hall-public-profile.test.js','profile-attempts.test.js','growth-history.test.js']);
 for(const file of C.FILES)assert(fs.existsSync(path.join('test/integration',file.replace(/\.js$/,'.ts'))));
 assert(fs.readdirSync('test/integration').filter(x=>x.endsWith('.test.ts')).length>C.FILES.length);
});
test('workflow keeps source push gate and read-only manual compatibility opt-in without operational paths',()=>{
 const workflow=fs.readFileSync('.github/workflows/ci.yml','utf8');
 assert(workflow.includes('branches: [main]'));assert(workflow.includes('contents: read'));assert(workflow.includes('default: false'));
 assert(workflow.includes("if: github.event_name == 'workflow_dispatch' && inputs.pg17_app_compat == true"));assert(workflow.includes('needs: independent'));
 assert(!/secrets\.|self-hosted|workflow_run|npm run migrate|build-file-island-image|install.*controller/i.test(workflow));
 assert(workflow.includes('path: pg17-app-compat-result.json'));
});
test('failed/skipped TAP retains honest counts and cannot be promoted to pass; missing summaries stay unknown',()=>{
 const tap=(fail,skip)=>`TAP version 13\n${fail?'not ok':'ok'} 1 - synthetic\n# tests 2\n# pass ${2-fail-skip}\n# fail ${fail}\n# skipped ${skip}\n# cancelled 0\n# todo 0\n`;
 for(const [fail,skip] of [[1,0],[0,1]]){const row=C.summarize({stdout:tap(fail,skip),status:fail?1:0});assert.equal(row.counts.tests,2);assert.equal(row.counts.fail,fail);assert.equal(row.counts.skipped,skip);assert.equal(row.tapValid,false);}
 const missing=C.summarize({stdout:'',status:1});assert.equal(missing.counts.tests,null);assert.equal(missing.tapValid,false);
 assert.equal(C.summarize({stdout:tap(0,0),status:0}).tapValid,true);
});

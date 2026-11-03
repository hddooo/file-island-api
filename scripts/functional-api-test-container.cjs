'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const REQUIRED_CASES={
 'auth-session':['auth.test.js'],
 'profile-contract':['profile-attempts.test.js','member-portal.test.js'],
 'collection-concurrency':['coin-eggs.test.js'],
 'server-hatch-clock':['coin-eggs.test.js'],
 'xp-preservation':['coin-eggs.test.js'],
};
function files(root){return fs.readdirSync(root,{withFileTypes:true}).flatMap(item=>{const file=path.join(root,item.name);assert(!fs.lstatSync(file).isSymbolicLink(),'Symlink test input');return item.isDirectory()?files(file):item.name.endsWith('.test.js')?[file]:[];}).sort();}
function countsFromTap(text){const result={};for(const m of text.matchAll(/^# (tests|pass|fail|skipped|cancelled|todo) (\d+)\r?$/gm))result[m[1]]=Number(m[2]);assert(['tests','pass','fail','skipped','cancelled','todo'].every(k=>Number.isInteger(result[k])),'Missing complete TAP counts');return result;}
function passed(row){const c=row?.counts;return !!c&&['tests','pass','fail','skipped','cancelled','todo'].every(k=>Number.isInteger(c[k])&&c[k]>=0)&&row.exitCode===0&&!row.signal&&c.tests>0&&c.pass===c.tests&&c.fail===0&&c.skipped===0&&c.cancelled===0&&c.todo===0;}
function semanticIdentity(root){const rows=[];function walk(relative){for(const name of fs.readdirSync(path.join(root,relative)).sort((a,b)=>a.localeCompare(b,'en'))){const file=path.join(root,relative,name),s=fs.lstatSync(file);assert(!s.isSymbolicLink(),'Semantic symlink');if(s.isDirectory())walk(path.join(relative,name));else{assert(s.isFile());rows.push({path:path.join(relative,name).split(path.sep).join('/'),size:s.size,sha256:sha(fs.readFileSync(file))});}}}walk('');assert.equal(rows.length,298,'Expected semantic298');return {files:rows.length,sha256:sha(JSON.stringify(rows))};}
function treeIdentity(root){const rows=[];function walk(relative){for(const name of fs.readdirSync(path.join(root,relative)).sort()){const file=path.join(root,relative,name),s=fs.lstatSync(file);assert(!s.isSymbolicLink(),'Code/SQL symlink input');if(s.isDirectory())walk(path.join(relative,name));else{assert(s.isFile(),'Regular code/SQL required');rows.push({path:path.join(relative,name).split(path.sep).join('/'),size:s.size,sha256:sha(fs.readFileSync(file))});}}}walk('');return {files:rows.length,sha256:sha(JSON.stringify(rows))};}
async function prepareRevisionContext(file,{appRoot='/app',temporaryRoot=os.tmpdir()}={}){
 const relative='dist/test/integration/textbook-revision-routing.test.js';assert.equal(path.resolve(file),path.resolve(appRoot,relative),'Only the synthetic revision HTTP fixture may use this isolation');
 const parent=fs.realpathSync(temporaryRoot),root=fs.mkdtempSync(path.join(parent,'hanq-revision-fixture-'));
 const cleanup=()=>{assert.equal(path.dirname(path.resolve(root)),parent);assert(path.basename(root).startsWith('hanq-revision-fixture-'));fs.rmSync(root,{recursive:true,force:true});};
 try{
  const appBefore=treeIdentity(path.join(appRoot,'dist/src')),sqlBefore=treeIdentity(path.join(appRoot,'migrations')),testHash=sha(fs.readFileSync(file));
  for(const name of ['package.json','dist/src','migrations','dist/test/helpers',relative]){const source=path.join(appRoot,name),target=path.join(root,name);assert(!fs.lstatSync(source).isSymbolicLink());if(fs.lstatSync(source).isDirectory())treeIdentity(source);fs.mkdirSync(path.dirname(target),{recursive:true});fs.cpSync(source,target,{recursive:true,errorOnExist:true,force:false});}
  fs.symlinkSync(path.resolve(appRoot,'node_modules'),path.join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
  const fixture=require(path.join(root,'dist/test/helpers/semantic-source-fixture.js'));await fixture.writeSyntheticBundle(root,fixture.syntheticSemanticBundle(fixture.OLD_PDF_SHA,144));
  const synthetic=JSON.parse(fs.readFileSync(path.join(root,'private-textbook-semantic-data/manifest.json'),'utf8'));assert.equal(synthetic.source.sha256,'35d850c6e9d9910c24cccce4b2ae37b963ee1ecd24f1926033f48d98f9de0442');assert.equal(synthetic.source.totalPdfPages,144);
  assert.deepEqual(treeIdentity(path.join(root,'dist/src')),appBefore);assert.deepEqual(treeIdentity(path.join(root,'migrations')),sqlBefore);assert.equal(sha(fs.readFileSync(path.join(root,relative))),testHash);
  return {file:path.join(root,relative),cleanup,proof:{kind:'synthetic-default144-context',applicationUnchanged:true,applicationFiles:appBefore.files,applicationTreeSha256:appBefore.sha256,migrationTreeSha256:sqlBefore.sha256,testSha256:testHash,privateOriginalsCopied:false}};
 }catch(error){cleanup();throw error;}
}
async function main(){
 const mode=process.argv[2];assert(['unit','integration'].includes(mode));assert.equal(process.env.NODE_ENV,'test');
 const source=process.env.HANQ_QUAL_SOURCE_COMMIT;assert(/^[a-f0-9]{40}$/.test(source||''));
 if(mode==='integration'){const u=new URL(process.env.HANQ_TEST_DATABASE_URL);assert.equal(u.hostname,'127.0.0.1');assert(u.pathname.endsWith('_test'));}
 const original='/run/toeic-fixture/round-with-checks.prepared.json';if(mode==='unit')assert(fs.statSync(original).isFile(),'Original TOEIC fixture is required; no optional skip qualification');const originalHash=mode==='unit'?sha(fs.readFileSync(original)):null;
 const inventory=files('/app/dist/test/'+mode);assert.equal(inventory.length,mode==='unit'?67:40,'Unexpected complete API test inventory');
 const semantic=semanticIdentity('/app/private-textbook-semantic-data'),results=[];assert.equal(semantic.sha256,process.env.HANQ_QUAL_SEMANTIC_SHA256,'Semantic identity mismatch');
 for(const file of inventory){const context=mode==='integration'&&path.basename(file)==='textbook-revision-routing.test.js'?await prepareRevisionContext(file):null;try{const child=cp.spawnSync(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap',context?.file||file],{encoding:'utf8',timeout:240000,maxBuffer:64*1024*1024});const text=(child.stdout||'')+'\n'+(child.stderr||'');let counts;try{counts=countsFromTap(text);}catch{counts={tests:0,pass:0,fail:1,skipped:0,cancelled:0,todo:0};}results.push({file:path.basename(file),counts,exitCode:child.status,signal:child.signal||null,rawTapSha256:sha(text),...(context?{fixtureIsolation:context.proof}:{})});}finally{context?.cleanup();}}
 const caseResults=mode==='integration'?Object.entries(REQUIRED_CASES).map(([title,requiredFiles])=>({title,files:requiredFiles,passed:requiredFiles.every(file=>results.some(r=>r.file===file&&passed(r)))})):[];
 assert.deepEqual(semanticIdentity('/app/private-textbook-semantic-data'),semantic,'Semantic input changed during tests');if(mode==='unit')assert.equal(sha(fs.readFileSync(original)),originalHash,'Original fixture changed during tests');
 const result={version:1,suite:'api-'+mode,sourceCommit:source,files:results,caseResults,semantic,originalFixture:mode==='unit'?{sha256:originalHash}:null,privateTapExported:false,passed:results.every(passed)&&caseResults.every(x=>x.passed)};
 process.stdout.write(JSON.stringify(result));if(!result.passed)process.exitCode=1;
}
if(require.main===module)main().catch(()=>{process.stdout.write(JSON.stringify({version:1,passed:false,error:'API test container preflight or execution failed; private details withheld'}));process.exitCode=1;});
module.exports={REQUIRED_CASES,countsFromTap,passed,treeIdentity,prepareRevisionContext};

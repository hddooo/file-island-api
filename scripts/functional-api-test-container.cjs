'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
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
function main(){
 const mode=process.argv[2];assert(['unit','integration'].includes(mode));assert.equal(process.env.NODE_ENV,'test');
 const source=process.env.HANQ_QUAL_SOURCE_COMMIT;assert(/^[a-f0-9]{40}$/.test(source||''));
 if(mode==='integration'){const u=new URL(process.env.HANQ_TEST_DATABASE_URL);assert.equal(u.hostname,'127.0.0.1');assert(u.pathname.endsWith('_test'));}
 const original='/run/toeic-fixture/round-with-checks.prepared.json';if(mode==='unit')assert(fs.statSync(original).isFile(),'Original TOEIC fixture is required; no optional skip qualification');const originalHash=mode==='unit'?sha(fs.readFileSync(original)):null;
 const inventory=files('/app/dist/test/'+mode);assert.equal(inventory.length,mode==='unit'?66:40,'Unexpected complete API test inventory');
 const semantic=semanticIdentity('/app/private-textbook-semantic-data'),results=[];assert.equal(semantic.sha256,process.env.HANQ_QUAL_SEMANTIC_SHA256,'Semantic identity mismatch');
 for(const file of inventory){const child=cp.spawnSync(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap',file],{encoding:'utf8',timeout:240000,maxBuffer:64*1024*1024});const text=(child.stdout||'')+'\n'+(child.stderr||'');let counts;try{counts=countsFromTap(text);}catch{counts={tests:0,pass:0,fail:1,skipped:0,cancelled:0,todo:0};}results.push({file:path.basename(file),counts,exitCode:child.status,signal:child.signal||null,rawTapSha256:sha(text)});}
 const caseResults=mode==='integration'?Object.entries(REQUIRED_CASES).map(([title,requiredFiles])=>({title,files:requiredFiles,passed:requiredFiles.every(file=>results.some(r=>r.file===file&&passed(r)))})):[];
 assert.deepEqual(semanticIdentity('/app/private-textbook-semantic-data'),semantic,'Semantic input changed during tests');if(mode==='unit')assert.equal(sha(fs.readFileSync(original)),originalHash,'Original fixture changed during tests');
 const result={version:1,suite:'api-'+mode,sourceCommit:source,files:results,caseResults,semantic,originalFixture:mode==='unit'?{sha256:originalHash}:null,privateTapExported:false,passed:results.every(passed)&&caseResults.every(x=>x.passed)};
 process.stdout.write(JSON.stringify(result));if(!result.passed)process.exitCode=1;
}
if(require.main===module){try{main();}catch{process.stdout.write(JSON.stringify({version:1,passed:false,error:'API test container preflight or execution failed; private details withheld'}));process.exitCode=1;}}
module.exports={REQUIRED_CASES,countsFromTap,passed};

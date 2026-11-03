'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const C=require('./image-build-contract.cjs');
const FILE='ops-prep/api-test-inventory.json',COUNTS={unit:67,integration:40};
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function validate(inventory,actual){
 assert.equal(inventory?.version,1);assert(/^[a-f0-9]{40}$/.test(inventory.sourceBaseCommit||''));
 assert.deepEqual(Object.keys(inventory.suites).sort(),['integration','unit']);
 for(const mode of Object.keys(COUNTS)){
  const rows=inventory.suites[mode];assert(Array.isArray(rows)&&rows.length===COUNTS[mode],'Exact '+mode+' inventory required');
  assert.equal(new Set(rows.map(x=>x.path)).size,COUNTS[mode],'Duplicate test input');
  assert.deepEqual(rows.map(x=>x.path),rows.map(x=>x.path).sort(),'Sorted test inventory required');
  for(const row of rows){assert(new RegExp('^test/'+mode+'/[a-z0-9-]+\\.test\\.ts$').test(row.path));assert(/^[a-f0-9]{40}$/.test(row.gitBlob));assert(/^[a-f0-9]{64}$/.test(row.sha256));}
  assert.deepEqual(rows,actual[mode],'Committed '+mode+' test names/blob bytes differ');
 }
 return inventory;
}
function verify(root,commit){
 assert(/^[a-f0-9]{40}$/.test(commit));
 const inventory=JSON.parse(C.git(root,['show',commit+':'+FILE])),actual={};
 for(const mode of Object.keys(COUNTS))actual[mode]=C.git(root,['ls-tree','-r',commit,'--','test/'+mode]).trim().split('\n').filter(x=>/\.test\.ts$/.test(x)).map(line=>{
  const m=/^100644 blob ([a-f0-9]{40})\t(.+)$/.exec(line);assert(m,'Regular committed test required');
  return {path:m[2],gitBlob:m[1],sha256:hash(C.git(root,['show',commit+':'+m[2]],true))};
 }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 return validate(inventory,actual);
}
module.exports={FILE,COUNTS,validate,verify};
if(require.main===module){try{const root=path.resolve(__dirname,'..'),commit=C.git(root,['rev-parse','HEAD']).trim();verify(root,commit);console.log(JSON.stringify({sourceCommit:commit,unitFiles:67,integrationFiles:40,gitBlobBytesVerified:true,productionQualified:false}));}catch{console.error('Exact committed API67/40 test inventory verification failed');process.exitCode=1;}}

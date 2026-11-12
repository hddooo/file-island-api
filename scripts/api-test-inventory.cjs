'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const C=require('./image-build-contract.cjs');
const P=require('./functional-schema-profile.cjs');
const FILE='ops-prep/api-test-inventory.json',COUNTS={unit:67,integration:40};
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function validate(inventory,actual,profile=P.SCHEMA54){
 const counts=P.counts(profile);
 assert.equal(inventory?.version,1);assert(/^[a-f0-9]{40}$/.test(inventory.sourceBaseCommit||''));
 assert.deepEqual(Object.keys(inventory.suites).sort(),['integration','unit']);
 for(const mode of Object.keys(counts)){
  const rows=inventory.suites[mode];assert(Array.isArray(rows)&&rows.length===counts[mode],'Exact '+mode+' inventory required');
  assert.equal(new Set(rows.map(x=>x.path)).size,counts[mode],'Duplicate test input');
  assert.deepEqual(rows.map(x=>x.path),rows.map(x=>x.path).sort(),'Sorted test inventory required');
  for(const row of rows){assert(new RegExp('^test/'+mode+'/[a-z0-9-]+\\.test\\.ts$').test(row.path));assert(/^[a-f0-9]{40}$/.test(row.gitBlob));assert(/^[a-f0-9]{64}$/.test(row.sha256));}
  assert.deepEqual(rows,actual[mode],'Committed '+mode+' test names/blob bytes differ');
 }
 return inventory;
}
function verify(root,commit,profile=P.SCHEMA54,pinnedInventorySha256){
 if(P.name(profile)===P.SCHEMA61){require('./current-runtime-test-inventory.cjs').committedInventory(root,commit,'ops-prep/functional-current-runtime-test-inventory.json',pinnedInventorySha256);return JSON.parse(C.git(root,['show',commit+':ops-prep/functional-current-runtime-test-inventory.json'],true));}
 assert(/^[a-f0-9]{40}$/.test(commit));
 P.name(profile);const bytes=C.git(root,['show',commit+':'+(profile===P.SCHEMA55?P.INVENTORY55:FILE)],true),inventory=JSON.parse(bytes),actual={};
 if(profile===P.SCHEMA55){assert.equal(hash(bytes),P.INVENTORY55_SHA256,'Pinned schema55 test inventory changed');assert.equal(inventory.sourceBaseCommit,P.SOURCE_BASE);}
 for(const mode of Object.keys(COUNTS))actual[mode]=C.git(root,['ls-tree','-r',commit,'--','test/'+mode]).trim().split('\n').filter(x=>/\.test\.ts$/.test(x)).map(line=>{
  const m=/^100644 blob ([a-f0-9]{40})\t(.+)$/.exec(line);assert(m,'Regular committed test required');
  return {path:m[2],gitBlob:m[1],sha256:hash(C.git(root,['show',commit+':'+m[2]],true))};
 }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 return validate(inventory,actual,profile);
}
function parseArgs(args){
 assert(Array.isArray(args));
 if(args.length===0)return {profile:P.SCHEMA54};
 assert.equal(args[0],'--qualification-profile');
 const profile=P.name(args[1]);
 if(profile===P.SCHEMA61){assert.equal(args.length,4);assert.equal(args[2],'--inventory-sha256');assert(/^[a-f0-9]{64}$/.test(args[3]||''));return {profile,pinnedInventorySha256:args[3]};}
 assert.equal(args.length,2);return {profile};
}
function runCli(args,root,git=C.git,verifyFn=verify){const {profile,pinnedInventorySha256}=parseArgs(args),commit=git(root,['rev-parse','HEAD']).trim(),inventory=verifyFn(root,commit,profile,pinnedInventorySha256),counts=P.counts(profile,inventory);return {sourceCommit:commit,qualificationProfile:profile,unitFiles:counts.unit,integrationFiles:counts.integration,gitBlobBytesVerified:true,productionQualified:false};}
module.exports={FILE,COUNTS,validate,verify,parseArgs,runCli};
if(require.main===module){try{console.log(JSON.stringify(runCli(process.argv.slice(2),path.resolve(__dirname,'..'))));}catch{console.error('Exact committed API test inventory verification failed');process.exitCode=1;}}

'use strict';
const cp=require('node:child_process'),A=require('node:assert/strict'),C=require('./current-runtime-contract.cjs');
function git(root,args,raw=false){return cp.execFileSync('git',['-C',root,...args],{encoding:raw?undefined:'utf8',windowsHide:true,maxBuffer:16*1024*1024});}
function committedInventory(root,sourceCommit,file,expectedSha256){
 A(/^[a-f0-9]{40}$/.test(sourceCommit||''));A(/^[a-f0-9]{64}$/.test(expectedSha256||''));A.equal(file,'ops-prep/functional-current-runtime-test-inventory.json');
 A.equal(git(root,['rev-parse','HEAD']).trim(),sourceCommit);A.equal(git(root,['status','--porcelain']).trim(),'','clean recipe/source required');
 const bytes=git(root,['show',sourceCommit+':'+file],true);A.equal(C.hash(bytes),expectedSha256,'independently pinned inventory bytes required');const inventory=JSON.parse(bytes),actual={};
 for(const mode of ['unit','integration'])actual[mode]=git(root,['ls-tree','-r',sourceCommit,'--','test/'+mode]).trim().split('\n').filter(x=>/\.test\.ts$/.test(x)).map(line=>{const m=/^100644 blob ([a-f0-9]{40})\t(.+)$/.exec(line);A(m,'regular committed test only');return {path:m[2],gitBlob:m[1],sha256:C.hash(git(root,['show',sourceCommit+':'+m[2]],true))};}).sort((a,b)=>a.path.localeCompare(b.path));
 C.inventory(inventory,actual);return {unit:actual.unit.length,integration:actual.integration.length,sourceCommit,testInventorySha256:expectedSha256,productionQualified:false};
}
module.exports={committedInventory};

'use strict';
// Exact-byte preparation for future network-isolated synthetic tests. Does not execute SQL.
const fs=require('node:fs'),path=require('node:path'),A=require('node:assert/strict'),C=require('./current-runtime-contract.cjs');
function loadExactSql(manifest,directory){
 const contract=C.schema(manifest),root=fs.realpathSync(directory),rows=[];A.deepEqual(fs.readdirSync(root).sort(),contract.rows.map(r=>r.version).sort(),'Exact61 SQL directory only; no extra migration files');
 for(const row of contract.rows){const file=path.join(root,row.version),stat=fs.lstatSync(file);A(stat.isFile()&&!stat.isSymbolicLink(),'exact regular SQL file required');const bytes=fs.readFileSync(file);A.equal(C.hash(bytes),row.checksum,'original SQL bytes required: '+row.version);rows.push({...row,bytes});}
 return {contract,rows};
}
function isolatedFixturePlan(manifest,directory,{databaseName,networkMode,publishedPorts}){
 A(/^hanq_[a-z0-9_]+_test$/.test(databaseName)&&databaseName!=='hanq_final_20261028','owned synthetic test DB only');A.equal(networkMode,'none');A.deepEqual(publishedPorts,[]);
 const loaded=loadExactSql(manifest,directory),topNames=new Set(manifest.imageMigrations.map(r=>r.version));
 return {productionAccess:false,sqlExecuted:false,databaseName,imageTopLevel:loaded.rows.filter(r=>topNames.has(r.version)),targeted056:loaded.rows.find(r=>r.version==='056_private_script_artifacts.sql'),bootstrap064:loaded.rows.find(r=>r.version==='064_hongmungwan.sql'),normalStartArgv:['node','/run/hanq-production/bootstrap.mjs'],ledgerSha256:C.LEDGER,expectedNormalRestartApplied:0};
}
module.exports={loadExactSql,isolatedFixturePlan};

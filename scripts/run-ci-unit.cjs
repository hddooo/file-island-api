'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const {CI_UNIT_EXCLUSIONS}=require('./functional-api-test-container.cjs');
const M=require('./migration-build-profile.cjs'),inventory=require('../ops-prep/api-test-inventory.json');
const GROWTH_UNIT=['admin-xp-floor.test.js','admin-xp-idempotency.test.js','growth-public-profile.test.js','my-records-activities.test.js','record-evidence-redaction.test.js'];
const crypto=require('node:crypto'),pins=require('../ops-prep/source-ci-schema55-unit-pins.json');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function expectedRows(profile=M.SCHEMA54){
 M.validateName(profile);assert.equal(pins.growthSourceCommit,'fe0058f2eeca76d01a247c1bc61b9456ed90ee3d');assert.equal(pins.growthSourceTree,'5fb16ad7b9d32cb2ba621af88b42eafbd6673c20');assert.equal(hash(fs.readFileSync(path.join(__dirname,'../ops-prep/api-test-inventory.json'))),pins.baselineInventorySha256,'Reviewed baseline inventory changed');
 assert.deepEqual(pins.added.map(x=>path.basename(x.path).replace(/\.ts$/,'.js')).sort(),[...GROWTH_UNIT].sort());assert.deepEqual(pins.reviewedOverrides.map(x=>x.path),['test/unit/hall-of-fame.test.ts']);
 const rows=inventory.suites.unit.map(x=>({...x}));if(profile===M.SCHEMA55_IMAGE_ONLY){for(const override of pins.reviewedOverrides){const index=rows.findIndex(x=>x.path===override.path);assert(index>=0);rows[index]={...override};}rows.push(...pins.added.map(x=>({...x})));}return rows.sort((a,b)=>a.path.localeCompare(b.path));
}
function validateRows(actual,profile=M.SCHEMA54){assert.deepEqual(actual,expectedRows(profile),'Committed source unit names/blob/hash differ from reviewed inventory');return true;}
function verifyCommitted(root,commit,profile=M.SCHEMA54){
 assert(/^[a-f0-9]{40}$/.test(commit));const git=(args,binary=false)=>cp.execFileSync('git',['-C',root,...args],{encoding:binary?undefined:'utf8',maxBuffer:16*1024*1024});
 const actual=git(['ls-tree','-r',commit,'--','test/unit']).trim().split('\n').filter(x=>/\.test\.ts$/.test(x)).map(line=>{const m=/^100644 blob ([a-f0-9]{40})\t(.+)$/.exec(line);assert(m);return {path:m[2],gitBlob:m[1],sha256:hash(git(['show',commit+':'+m[2]],true))};}).sort((a,b)=>a.path.localeCompare(b.path));validateRows(actual,profile);
 for(const row of actual){const file=path.join(root,row.path);assert(!fs.lstatSync(file).isSymbolicLink());assert.equal(hash(fs.readFileSync(file)),row.sha256,'Working source test bytes differ from committed inventory');}return true;
}
function validateFiles(all,profile=M.SCHEMA54){
 const expected=expectedRows(profile).map(x=>path.basename(x.path).replace(/\.ts$/,'.js')).sort();assert.deepEqual([...all].sort(),expected,'Exact source unit filenames required');
 for(const name of CI_UNIT_EXCLUSIONS)assert(expected.includes(name));const files=expected.filter(x=>!CI_UNIT_EXCLUSIONS.includes(x));assert.equal(files.length,profile===M.SCHEMA54?62:67);return files;
}
function main(){const root=path.resolve(__dirname,'..'),profile=M.validateName(process.env.SOURCE_CONTRACT_MIGRATION_PROFILE??M.SCHEMA54),commit=cp.execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();verifyCommitted(root,commit,profile);const dir=path.join(root,'dist/test/unit'),all=fs.readdirSync(dir).filter(x=>x.endsWith('.test.js')),files=validateFiles(all,profile);const r=cp.spawnSync(process.execPath,['--test','--test-concurrency=1',...files.map(x=>path.join(dir,x))],{cwd:root,stdio:'inherit',windowsHide:true});process.exitCode=r.status===0?0:1;}
if(require.main===module)main();
module.exports={GROWTH_UNIT,expectedRows,validateRows,verifyCommitted,validateFiles};

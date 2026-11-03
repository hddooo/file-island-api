'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const M=require('./migration-build-profile.cjs'),C=require('./image-build-contract.cjs'),B=require('./build-file-island-image.cjs');
const root=path.resolve(__dirname,'..'),head=C.git(root,['rev-parse','HEAD']).trim();
function baseline(){
 // Synthetic validator baseline only. Independent pins in M validate these rows.
 const names=C.git(root,['ls-tree','-r','--name-only',head,'--','migrations']).trim().split('\n').filter(x=>/^migrations\/\d{3}_[a-z0-9_]+\.sql$/.test(x)&&!/^migrations\/056_/.test(x));
 const m={migrations:names.map(n=>({version:path.basename(n),checksum:C.hash(C.git(root,['show',head+':'+n],true))})),privilegesSha256:C.hash(C.git(root,['show',head+':migrations/repeatable/privileges.sql'],true))};M.validateManifest(m);return m;
}
const candidate=()=>({migrations:[...baseline().migrations,{...M.EXTRA_056}],privilegesSha256:M.PRIVILEGES_SHA256});
test('default54 pins every row and privileges; only explicit55 accepts the exact extension',()=>{
 assert.equal(M.validateManifest(baseline()).migrationProfile,M.SCHEMA54);assert.throws(()=>M.validateManifest(candidate()));assert.throws(()=>M.validateManifest(baseline(),M.SCHEMA55_IMAGE_ONLY));
 const c=M.validateManifest(candidate(),M.SCHEMA55_IMAGE_ONLY);assert.equal(c.rows.length,55);assert.equal(c.manifestSha256,M.SCHEMA55_SHA256);
});
test('55 rejects count drift, duplicates, changed baseline,056 rename/checksum and privileges drift',()=>{
 for(const mutate of [m=>m.migrations.pop(),m=>m.migrations.push({...M.EXTRA_056}),m=>m.migrations[0].checksum='a'.repeat(64),m=>m.migrations[0].version='047_unreviewed.sql',m=>m.migrations.at(-1).version='056_other.sql',m=>m.migrations.at(-1).checksum='b'.repeat(64),m=>m.privilegesSha256='0'.repeat(64)]){const m=candidate();mutate(m);assert.throws(()=>M.validateManifest(m,M.SCHEMA55_IMAGE_ONLY));}
});
test('normalization permits ordering only; malformed rows and implicit profiles fail closed',()=>{
 const m=candidate();m.migrations.reverse();assert.equal(M.validateManifest(m,M.SCHEMA55_IMAGE_ONLY).manifestSha256,M.SCHEMA55_SHA256);
 for(const p of ['auto','schema55','',null])assert.throws(()=>M.validateManifest(candidate(),p));m.migrations[0].checksum='ABC';assert.throws(()=>M.validateManifest(m,M.SCHEMA55_IMAGE_ONLY));
});
test('actual HEAD follows an explicit source-test profile without SQL-based profile detection',()=>{
 const profile=M.validateName(process.env.SOURCE_CONTRACT_MIGRATION_PROFILE??M.SCHEMA54),source=C.sourceManifest(root,head,profile);
 assert.equal(source.migrationProfile,profile);if(profile===M.SCHEMA55_IMAGE_ONLY){assert.equal(source.manifestSha256,M.SCHEMA55_SHA256);assert.throws(()=>C.sourceManifest(root,head));}else{assert.equal(source.manifestSha256,M.BASELINE54_SHA256);assert.throws(()=>C.sourceManifest(root,head,M.SCHEMA55_IMAGE_ONLY));}
 for(const ref of ['HEAD','main',head.slice(0,7),head+'\n'])assert.throws(()=>C.sourceManifest(root,ref,profile));
});
test('CLI preserves default54 and requires exactly one explicit reviewed profile without Docker',()=>{
 assert.equal(B.options(['--verify-config']).profile,M.SCHEMA54);assert.equal(B.options(['--build','--migration-profile',M.SCHEMA55_IMAGE_ONLY]).profile,M.SCHEMA55_IMAGE_ONLY);
 for(const args of [[],['--build','--migration-profile','auto'],['--build','extra'],['--build','--migration-profile',M.SCHEMA54,'extra']])assert.throws(()=>B.options(args));
});
test('55 image permission leaves every operating flag false and all six suites unverified',()=>{
 const q=C.qualification(M.SCHEMA55_IMAGE_ONLY);for(const k of ['productionQualified','deploymentPerformed','migrationPerformed','operationalMigrationAllowed'])assert.equal(q[k],false);assert.equal(q.requiredSuites.length,6);assert(q.requiredSuites.every(x=>x.status==='not_run'&&x.conclusion==='unverified'));assert(q.blockers.includes(M.MIGRATION_BLOCKER));
 assert.throws(()=>require('./functional-evidence.cjs').validateBindings({apiCommit:head,frontendCommit:head,deployCommit:head,imageId:'sha256:'+'a'.repeat(64),imageConfigDigest:'sha256:'+'b'.repeat(64),archiveSha256:'c'.repeat(64),composeSha256:'d'.repeat(64),bootstrapSha256:'e'.repeat(64),controllerSha256:'f'.repeat(64),databaseTarget:'hanq_final_20261028',migrations:candidate().migrations}),/schema54/);
});
test('offline handoff never promotes claimed authenticated55 inventory into operating permission',()=>{
 const c=M.validateManifest(candidate(),M.SCHEMA55_IMAGE_ONLY),r=require('./check-image-cd-handoff.cjs').inspect({kind:'api-image-build-only',repository:C.REPOSITORY,authenticated:true,productionQualified:false,migrationProfile:M.SCHEMA55_IMAGE_ONLY,migrations:c.rows,privilegesSha256:c.privilegesSha256,migrationManifestSha256:c.manifestSha256});
 assert.equal(r.ready,false);assert.equal(r.applyPerformed,false);assert.equal(r.operationalMigrationAllowed,false);assert(r.blockers.includes(M.MIGRATION_BLOCKER));
});
test('existing migration adapter rejects55 before Docker execution',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'file-island-profile-'));try{const file=path.join(dir,'manifest.json');fs.writeFileSync(file,JSON.stringify(candidate()));assert.throws(()=>require('./run-functional-migration.cjs').config({sourceCommit:head,postgresImage:'sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe',baselineImage:'sha256:'+'a'.repeat(64),candidateImage:'sha256:'+'b'.repeat(64),manifestFile:file},{}));}finally{assert(path.basename(dir).startsWith('file-island-profile-'));fs.rmSync(dir,{recursive:true,force:true});}
});
test('explicit source/image positive receipt binds actual HEAD, LF inventory, privileges and exact source SHA',()=>{
 const profile=M.validateName(process.env.SOURCE_CONTRACT_MIGRATION_PROFILE??M.SCHEMA54),source=C.sourceManifest(root,head,profile),receipt={kind:'api-image-build-only',repository:C.REPOSITORY,sourceCommit:head,migrationProfile:profile,migrations:source.rows,privilegesSha256:source.privilegesSha256,migrationManifestSha256:source.manifestSha256,...C.qualification(profile)};
 assert.equal(C.validateSourceReceipt(head,source,receipt),true);assert.equal(receipt.productionQualified,false);
 for(const change of [{sourceCommit:'a'.repeat(40)},{migrationManifestSha256:'b'.repeat(64)},{privilegesSha256:'c'.repeat(64)},{migrationProfile:'auto'}])assert.throws(()=>C.validateSourceReceipt(head,source,{...receipt,...change}));
 const changed=JSON.parse(JSON.stringify(receipt));changed.migrations[0].checksum='d'.repeat(64);assert.throws(()=>C.validateSourceReceipt(head,source,changed));
});
test('dirty build input is refused before source staging, Docker or image creation',()=>{
 for(const status of [' M migrations/056_admin_partner_xp.sql','?? extra-input','D package.json'])assert.throws(()=>B.cleanSource(root,head,M.SCHEMA55_IMAGE_ONLY,status),/Clean committed/);
});
test('source-only unit inventory extends exactly five reviewed Growth names without changing54 or functional inventory',()=>{
 const R=require('./run-ci-unit.cjs'),base=require('../ops-prep/api-test-inventory.json').suites.unit.map(x=>path.basename(x.path).replace(/\.ts$/,'.js')),all=[...base,...R.GROWTH_UNIT];
 assert.equal(R.validateFiles(base).length,62);assert.equal(R.validateFiles(all,M.SCHEMA55_IMAGE_ONLY).length,67);assert.throws(()=>R.validateFiles(all));
 for(const values of [all.slice(1),[...all,'unknown.test.js'],[...all.slice(1),all[1]]])assert.throws(()=>R.validateFiles(values,M.SCHEMA55_IMAGE_ONLY));
 assert.equal(require('./api-test-inventory.cjs').COUNTS.integration,40);
});
test('reviewed source unit blob/hash pins reject baseline substitution and all extra, missing or changed inputs',()=>{
 const R=require('./run-ci-unit.cjs'),profile=M.validateName(process.env.SOURCE_CONTRACT_MIGRATION_PROFILE??M.SCHEMA54),rows=R.expectedRows(profile);assert.equal(R.verifyCommitted(root,head,profile),true);assert.equal(rows.length,profile===M.SCHEMA54?67:72);
 for(const mutate of [r=>r.pop(),r=>r.push(r[0]),r=>r[0].gitBlob='a'.repeat(40),r=>r[0].sha256='b'.repeat(64),r=>r[0].path='test/unit/unreviewed.test.ts']){const changed=JSON.parse(JSON.stringify(rows));mutate(changed);assert.throws(()=>R.validateRows(changed,profile));}
});
function unitRunnerProbe(child){
 const R=require('./run-ci-unit.cjs'),profile=M.validateName(process.env.SOURCE_CONTRACT_MIGRATION_PROFILE??M.SCHEMA54),all=R.expectedRows(profile).map(x=>path.basename(x.path).replace(/\.ts$/,'.js')),out=[],errors=[];let calls=0;
 const code=R.runUnits({env:{...process.env,SOURCE_CONTRACT_MIGRATION_PROFILE:profile},listCompiled:()=>all,spawn:(binary,args,options)=>{calls++;assert.equal(binary,process.execPath);assert(args.includes('--test-reporter=tap'));assert.equal(args.filter(x=>x.endsWith('.test.js')).length,profile===M.SCHEMA54?62:67);assert.equal(options.encoding,'utf8');return child;},writeOut:x=>out.push(x),writeError:x=>errors.push(x)});
 assert.equal(calls,1,'Real committed Git and inventory gates must reach the injected child');return {code,out:out.join(''),errors:errors.join('')};
}
const completeUnitTap='TAP version 13\nok 1 - synthetic unit\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
test('actual source-unit runner seam accepts real Node TAP after real Git and inventory verification',()=>{
 const cp=require('node:child_process'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'file-island-unit-tap-'));try{
  const file=path.join(dir,'synthetic.test.cjs');fs.writeFileSync(file,"require('node:test').test('synthetic real Node unit',()=>{});\n");const env={...process.env};delete env.NODE_TEST_CONTEXT;const child=cp.spawnSync(process.execPath,['--test','--test-reporter=tap',file],{env,encoding:'utf8',timeout:10000});assert.equal(child.status,0);const probe=unitRunnerProbe(child);assert.equal(probe.code,0);assert.equal(probe.out,child.stdout);
 }finally{assert(path.basename(dir).startsWith('file-island-unit-tap-'));fs.rmSync(dir,{recursive:true,force:true});}
});
test('actual source-unit runner rejects empty, truncated, duplicate, failed, mismatched, skipped and interrupted child output',()=>{
 const invalid=[{stdout:''},{stdout:completeUnitTap.replace('# todo 0\n','')},{stdout:completeUnitTap+'# tests 1\n'},{stdout:completeUnitTap.replace('ok 1','not ok 1')},{stdout:completeUnitTap.replace('# tests 1','# tests 2')},{stdout:completeUnitTap.replace('# skipped 0','# skipped 1')},{stdout:completeUnitTap.replace('synthetic unit','synthetic unit # SKIP optional')},{stdout:completeUnitTap.replace('# cancelled 0','# cancelled 1')},{stdout:completeUnitTap.replace('# todo 0','# todo 1')},{stdout:completeUnitTap.replace('# tests 1','# tests 0').replace('# pass 1','# pass 0')},{stdout:completeUnitTap,status:1},{stdout:completeUnitTap,signal:'SIGTERM'},{stdout:completeUnitTap,error:Error('synthetic spawn error')},{stdout:completeUnitTap+'Bail out!\n'}];
 for(const change of invalid){const probe=unitRunnerProbe({status:0,stdout:completeUnitTap,stderr:'',signal:null,...change});assert.equal(probe.code,1);assert(probe.errors.includes('strict TAP completion gate'));}
});
test('strict runner preserves original child stdout and stderr while rejecting hidden stderr failure',()=>{
 const stderr='synthetic child diagnostic\nnot ok 9 - synthetic hidden failure\n',probe=unitRunnerProbe({status:0,stdout:completeUnitTap,stderr,signal:null});assert.equal(probe.code,1);assert.equal(probe.out,completeUnitTap);assert(probe.errors.startsWith(stderr));
});

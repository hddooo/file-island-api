'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('./migration-build-profile.cjs'),S=require('./schema54-contract.cjs'),C=require('./image-build-contract.cjs');
const B=require('./build-file-island-image.cjs'),H=require('./check-image-cd-handoff.cjs'),F=require('./functional-evidence.cjs');
function manifest55(){return {migrations:[...S.baselineRows(),{...P.EXTRA_056}],privilegesSha256:S.PRIVILEGES_SHA256};}
test('source manifest rejects symbolic refs and abbreviated commits before reading Git bytes',()=>{
 for(const source of ['HEAD','main','7e13f38','a'.repeat(40)+'\n',undefined])assert.throws(()=>C.sourceManifest(process.cwd(),source,P.SCHEMA55_IMAGE_ONLY),/Exact source commit required/);
});
test('schema54 stays the default and schema55 requires the explicit image-only profile',()=>{
 const baseline={migrations:S.baselineRows(),privilegesSha256:S.PRIVILEGES_SHA256};
 assert.equal(P.validateManifest(baseline).manifestSha256,S.MANIFEST_SHA256);
 assert.throws(()=>P.validateManifest(manifest55()),/schema-preserving schema54/);
 const actual=P.validateManifest(manifest55(),P.SCHEMA55_IMAGE_ONLY);assert.equal(actual.rows.length,55);assert.equal(actual.manifestSha256,P.SCHEMA55_MANIFEST_SHA256);
 assert.equal(P.validateManifest({...manifest55(),migrations:manifest55().migrations.reverse()},P.SCHEMA55_IMAGE_ONLY).manifestSha256,P.SCHEMA55_MANIFEST_SHA256);
 assert.throws(()=>P.validateManifest(baseline,P.SCHEMA55_IMAGE_ONLY),/exactly 55/);
});
test('schema55 preserves all baseline bytes, exact056 filename/checksum and privileges',()=>{
 for(const change of [m=>{m.migrations[0].checksum='0'.repeat(64);},m=>{m.migrations[0].version='001_substituted.sql';},m=>{m.migrations[54].checksum='0'.repeat(64);},m=>{m.migrations[54].version='056_renamed.sql';},m=>{m.migrations[54]={...m.migrations[0]};},m=>{m.migrations.push({version:'057_extra.sql',checksum:'0'.repeat(64)});},m=>{m.privilegesSha256='0'.repeat(64);}]){
  const m=manifest55();change(m);assert.throws(()=>P.validateManifest(m,P.SCHEMA55_IMAGE_ONLY));
 }
 for(const profile of ['schema55','auto','latest'])assert.throws(()=>P.validateManifest(manifest55(),profile));
});
test('CLI cannot silently select schema55 or accept unreviewed extra flags',()=>{
 for(const mode of ['--verify-config','--build','--local-build']){
  assert.deepEqual(B.parseArguments([mode]),{mode,profile:P.SCHEMA54});
  assert.deepEqual(B.parseArguments([mode,'--migration-profile',P.SCHEMA55_IMAGE_ONLY]),{mode,profile:P.SCHEMA55_IMAGE_ONLY});
 }
 for(const args of [[],['--apply'],['--build','--migration-profile'],['--build','--migration-profile','schema55'],['--build','--migration-profile',P.SCHEMA55_IMAGE_ONLY,'--apply'],['--build','--unknown',P.SCHEMA55_IMAGE_ONLY]])assert.throws(()=>B.parseArguments(args));
});
test('schema55 image permission never creates successful suites or functional migration evidence',()=>{
 const q=C.qualification(P.SCHEMA55_IMAGE_ONLY);assert.equal(q.productionQualified,false);assert.equal(q.deploymentPerformed,false);assert(q.requiredSuites.every(s=>s.status==='not_run'&&s.conclusion==='unverified'));assert(q.blockers.includes(P.MIGRATION_BLOCKER));
 const hex='a'.repeat(64),sha='b'.repeat(40),binding={apiCommit:sha,frontendCommit:sha,deployCommit:sha,imageId:'sha256:'+hex,imageConfigDigest:'sha256:'+hex,archiveSha256:hex,composeSha256:hex,bootstrapSha256:hex,controllerSha256:hex,databaseTarget:'hanq_final_20261028',migrations:manifest55().migrations};
 assert.throws(()=>F.validateBindings(binding),/schema-preserving schema54/);
 assert.throws(()=>S.validateManifest(manifest55()),/schema-preserving schema54/);
});
test('offline readiness verifies exact inventory but never trusts forged authentication flags',()=>{
 const receipt={kind:'api-image-build-only',repository:C.REPOSITORY,sourceCommit:'b'.repeat(40),migrationProfile:P.SCHEMA55_IMAGE_ONLY,...manifest55(),migrationManifestSha256:P.SCHEMA55_MANIFEST_SHA256,authenticated:true,productionQualified:false};
 const result=H.inspect(receipt);assert.equal(result.migrationProfile.inventoryVerified,true);assert.equal(result.migrationProfile.operationalMigrationAllowed,false);assert.equal(result.ready,false);assert.equal(result.applyPerformed,false);assert(result.blockers.includes(P.MIGRATION_BLOCKER));assert(result.blockers.some(x=>x.includes('receipt flags are not independent provenance')));
 for(const change of [r=>{r.migrationManifestSha256='0'.repeat(64);},r=>{r.migrationProfile=P.SCHEMA54;},r=>{r.privilegesSha256='0'.repeat(64);}]){const changed=JSON.parse(JSON.stringify(receipt));change(changed);const bad=H.inspect(changed);assert.equal(bad.migrationProfile.inventoryVerified,false);assert.equal(bad.ready,false);}
});

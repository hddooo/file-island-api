'use strict';
// Explicit image-build inventories only. Neither profile grants migration or deployment qualification.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const S=require('./schema54-contract.cjs');
const SCHEMA54='schema54',SCHEMA55_IMAGE_ONLY='schema55-image-only';
const EXTRA_056={version:'056_admin_partner_xp.sql',checksum:'13eeb81ff165a6ad1ad03aa2c1793ede79e020cdd5cc5383917fe740cd6796ab'};
const SCHEMA55_MANIFEST_SHA256='e7f9138ab0372e165396771c5eec671b738cdc31b497261158b451c012a35b83';
const MIGRATION_BLOCKER='Schema55 image bytes are not migration qualification: PG17 backup/restore, exact 056 upgrade, idempotency, legacy-data preservation and rollback evidence remain required. Schema54 compatibility receipts are ineligible.';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function validateName(profile){assert([SCHEMA54,SCHEMA55_IMAGE_ONLY].includes(profile),'Explicit reviewed migration build profile required');return profile;}
function validateManifest(manifest,profile=SCHEMA54){
 validateName(profile);
 let rows;
 if(profile===SCHEMA54)rows=S.validateManifest(manifest);
 else{
  assert(Array.isArray(manifest?.migrations)&&manifest.migrations.length===55,'Schema55 image profile requires exactly 55 migrations');
  assert(manifest.migrations.every(row=>row&&typeof row.version==='string'&&/^\d{3}_[a-z0-9_]+\.sql$/.test(row.version)&&/^[a-f0-9]{64}$/.test(row.checksum)),'Invalid schema55 migration inventory');
  rows=manifest.migrations.map(({version,checksum})=>({version,checksum})).sort((a,b)=>a.version.localeCompare(b.version));
  assert.equal(new Set(rows.map(row=>row.version)).size,55,'Duplicate schema55 migration version');
  const extra=rows.filter(row=>/^056_/.test(row.version));assert.deepEqual(extra,[EXTRA_056],'Only the exact reviewed 056 filename and checksum may extend schema54');
  S.validateManifest({migrations:rows.filter(row=>row.version!==EXTRA_056.version),privilegesSha256:manifest.privilegesSha256});
  assert.equal(hash(JSON.stringify(rows)),SCHEMA55_MANIFEST_SHA256,'Schema55 canonical row manifest differs');
 }
 return {migrationProfile:profile,rows,privilegesSha256:manifest.privilegesSha256,manifestSha256:hash(JSON.stringify(rows))};
}
module.exports={SCHEMA54,SCHEMA55_IMAGE_ONLY,EXTRA_056,SCHEMA55_MANIFEST_SHA256,MIGRATION_BLOCKER,validateName,validateManifest};

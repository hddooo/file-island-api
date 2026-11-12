'use strict';
// Image inventory permission only; never migration or deployment qualification.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const SCHEMA54='schema54',SCHEMA55_IMAGE_ONLY='schema55-image-only';
const BASELINE54_SHA256='c082a2e30f2caab4d2e7802944fb58c4f60e890c636e6d5a30958ebd9d04fdfa';
const PRIVILEGES_SHA256='9fc57d632355720757da4ec9ba9a44fcb59bae296b295fb561e0a494039960c0';
const EXTRA_056={version:'056_admin_partner_xp.sql',checksum:'13eeb81ff165a6ad1ad03aa2c1793ede79e020cdd5cc5383917fe740cd6796ab'};
const SCHEMA55_SHA256='e7f9138ab0372e165396771c5eec671b738cdc31b497261158b451c012a35b83';
const MIGRATION_BLOCKER='Schema55 image-only inventory is not PG17 restore/upgrade/rollback or six-suite qualification; schema54 receipts cannot qualify schema55.';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function validateName(profile){assert([SCHEMA54,SCHEMA55_IMAGE_ONLY].includes(profile),'Explicit reviewed migration build profile required');return profile;}
function normalize(rows){
 assert(Array.isArray(rows)&&rows.every(r=>r&&typeof r.version==='string'&&/^\d{3}_[a-z0-9_]+\.sql$/.test(r.version)&&/^[a-f0-9]{64}$/.test(r.checksum)),'Invalid migration inventory');
 assert.equal(new Set(rows.map(r=>r.version)).size,rows.length,'Duplicate migration version');
 return rows.map(({version,checksum})=>({version,checksum})).sort((a,b)=>a.version.localeCompare(b.version));
}
function validate54(rows){assert.equal(rows.length,54,'Exact schema54 baseline required');assert.equal(hash(JSON.stringify(rows)),BASELINE54_SHA256,'Pinned schema54 rows differ');}
function validateManifest(manifest,profile=SCHEMA54){
 validateName(profile);assert.equal(manifest?.privilegesSha256,PRIVILEGES_SHA256,'Pinned privileges differ');const rows=normalize(manifest.migrations);
 if(profile===SCHEMA54)validate54(rows);
 else{assert.equal(rows.length,55,'Exact schema55 image inventory required');assert.deepEqual(rows.filter(r=>/^056_/.test(r.version)),[EXTRA_056],'Only exact reviewed056 may extend schema54');validate54(rows.filter(r=>r.version!==EXTRA_056.version));assert.equal(hash(JSON.stringify(rows)),SCHEMA55_SHA256,'Pinned schema55 rows differ');}
 return {migrationProfile:profile,rows,privilegesSha256:manifest.privilegesSha256,manifestSha256:hash(JSON.stringify(rows))};
}
module.exports={SCHEMA54,SCHEMA55_IMAGE_ONLY,BASELINE54_SHA256,PRIVILEGES_SHA256,EXTRA_056,SCHEMA55_SHA256,MIGRATION_BLOCKER,validateName,validateManifest};

'use strict';
// The existing compatibility harness proves a schema-preserving schema54 release only.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const fixture=require('../test/fixtures/migration-manifest-20261030.json');
const MANIFEST_SHA256='c082a2e30f2caab4d2e7802944fb58c4f60e890c636e6d5a30958ebd9d04fdfa';
const PRIVILEGES_SHA256='9fc57d632355720757da4ec9ba9a44fcb59bae296b295fb561e0a494039960c0';
const BLOCKED_056='Schema55/056 requires separately reviewed restore, upgrade and rollback evidence; the existing harness qualifies schema-preserving schema54 only.';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function normalize(rows){
 assert(Array.isArray(rows),'Exact reviewed schema54 migration inventory required');
 assert(rows.every(row=>row&&typeof row.version==='string'&&/^\d{3}_[a-z0-9_]+\.sql$/.test(row.version)&&/^[a-f0-9]{64}$/.test(row.checksum)),'Invalid migration inventory');
 assert.equal(new Set(rows.map(row=>row.version)).size,rows.length,'Duplicate migration version');
 return rows.map(({version,checksum})=>({version,checksum})).sort((a,b)=>a.version.localeCompare(b.version));
}
// Keep the 54-row expectation pinned even when a separately reviewed fixture adds 056.
// Filtering the fixture never authorizes 056 in a candidate or derives expectations from SQL under test.
const baseline=normalize(fixture.migrations.filter(row=>!/^056_/.test(row.version)));
assert.equal(baseline.length,54,'Reviewed schema54 baseline must contain exactly 54 rows');
assert.equal(hash(JSON.stringify(baseline)),MANIFEST_SHA256,'Reviewed schema54 baseline changed');
assert.equal(fixture.privilegesSha256,PRIVILEGES_SHA256,'Reviewed privileges baseline changed');
function validateRows(rows){
 const normalized=normalize(rows);
 assert(!normalized.some(row=>/^056_/.test(row.version)),BLOCKED_056);
 assert.equal(normalized.length,54,'Exact reviewed schema54 inventory required (001–055, without 047)');
 assert.equal(hash(JSON.stringify(normalized)),MANIFEST_SHA256,'Migration filenames/checksums differ from the reviewed schema54 baseline');
 return normalized;
}
function validateManifest(manifest){
 const rows=validateRows(manifest.migrations);
 assert.equal(manifest.privilegesSha256,PRIVILEGES_SHA256,'Repeatable privileges differ from the reviewed schema54 baseline');
 return rows;
}
function baselineRows(){return baseline.map(row=>({...row}));}
module.exports={MANIFEST_SHA256,PRIVILEGES_SHA256,BLOCKED_056,validateRows,validateManifest,baselineRows};

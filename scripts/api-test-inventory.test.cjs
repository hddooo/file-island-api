'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const V=require('./api-test-inventory.cjs'),inventory=require('../ops-prep/api-test-inventory.json');
const clone=value=>JSON.parse(JSON.stringify(value));
const actual=()=>clone(inventory.suites);
test('exact API66/40 inventory retains all original and four new test files',()=>{assert(V.validate(inventory,actual()));assert.equal(inventory.suites.unit.length,66);assert.equal(inventory.suites.integration.length,40);for(const [mode,names]of Object.entries({unit:['semantic-source-profile','textbook-revisions'],integration:['semantic-source-revisions','textbook-revision-routing']}))for(const name of names)assert(inventory.suites[mode].some(x=>x.path==='test/'+mode+'/'+name+'.test.ts'));});
test('missing, additional and duplicate test paths are rejected',()=>{for(const mode of ['unit','integration'])for(const mutate of [r=>r.pop(),r=>r.push(r[0]),r=>{r[1]=r[0]}]){const value=clone(inventory);mutate(value.suites[mode]);assert.throws(()=>V.validate(value,actual()));}});
test('changed source hash or Git blob cannot qualify the original inventory',()=>{for(const key of ['sha256','gitBlob']){const rows=actual();rows.unit[0][key]='f'.repeat(key==='sha256'?64:40);assert.throws(()=>V.validate(inventory,rows));}});
test('wrong suite, unsorted list and path escape cannot qualify',()=>{const extra=clone(inventory);extra.suites.unreviewed=[];assert.throws(()=>V.validate(extra,actual()));for(const mutate of [r=>r.reverse(),r=>{r[0].path='../test.ts'}]){const value=clone(inventory);mutate(value.suites.integration);assert.throws(()=>V.validate(value,actual()));}});

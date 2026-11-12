'use strict';
// Explicit test selection only. This module never grants deployment or migration permission.
const assert=require('node:assert/strict'),M=require('./migration-build-profile.cjs');
const R=require('./current-runtime-contract.cjs');
const SCHEMA54='schema54',SCHEMA55='schema55-qualification',SCHEMA61=R.PROFILE;
const INVENTORY55='ops-prep/functional-schema55-test-inventory.json';
const INVENTORY55_SHA256='749bdd1802b7ec60f5fc768243cf02591247deffefb5d76ce88c5716bdadb29b';
const SOURCE_BASE='19077b447af00a86230ddb668f2c0c133ed76588';
const GROWTH_CASES=['admin-partner-xp','hall-public-profile','growth-xp-preservation'];
function name(value=SCHEMA54){assert([SCHEMA54,SCHEMA55,SCHEMA61].includes(value),'Explicit functional qualification profile required');return value;}
function buildProfile(value){assert.notEqual(name(value),SCHEMA61,'Retained image source is composed; do not treat source SQL as image inventory');return name(value)===SCHEMA55?M.SCHEMA55_IMAGE_ONLY:M.SCHEMA54;}
function counts(value,inventory){if(name(value)===SCHEMA61){assert(inventory?.frozen===true,'Verified complete current-runtime inventory required');R.inventory(inventory,inventory.suites);return {unit:inventory.suites.unit.length,integration:inventory.suites.integration.length};}return name(value)===SCHEMA55?{unit:72,integration:43}:{unit:67,integration:40};}
function selectedCounts(value,inventory){const c=counts(value,inventory);return {...c,unit:c.unit-5};}
function cases(suite,base,value){if(name(value)===SCHEMA61){if(suite==='api-integration')return [...base,...GROWTH_CASES];if(suite==='migration-compatibility')return [...base,'current-runtime-normal-start-no-numbered-migration','current-runtime-rollback-schema61'];return base;}if(name(value)!==SCHEMA55)return base;if(suite==='api-integration')return [...base,...GROWTH_CASES];if(suite==='migration-compatibility')return [...base,'production-bootstrap55-rollback','default54-bootstrap-rejects55'];return base;}
function manifest(value,profile){if(name(profile)===SCHEMA61){const result=R.schema(value);assert.equal(value.privilegesSha256,'9fc57d632355720757da4ec9ba9a44fcb59bae296b295fb561e0a494039960c0');return {...result,privilegesSha256:value.privilegesSha256};}return M.validateManifest(value,buildProfile(profile));}
function producerProfile(value,env){const p=name(value);if(env.GITHUB_ACTIONS==='true'||env.HANQ_FUNCTIONAL_IMAGE_ID)assert.equal(p,name(env.HANQ_FUNCTIONAL_QUALIFICATION_PROFILE),'Functional profile differs from producer binding');return p;}
function migrationPlan(value,profile){const p=name(profile);if(p===SCHEMA61){const target=manifest(value,p);return {qualificationProfile:p,baselineRows:target.rows,targetRows:target.rows,baselineSha256:target.manifestSha256,targetSha256:target.manifestSha256,expectedNew:[],baselineCount:61,targetCount:61};}const target=manifest(value,p),baseline=p===SCHEMA55?M.validateManifest({migrations:target.rows.filter(r=>r.version!==M.EXTRA_056.version),privilegesSha256:target.privilegesSha256}):target;return {qualificationProfile:p,baselineRows:baseline.rows,targetRows:target.rows,baselineSha256:baseline.manifestSha256,targetSha256:target.manifestSha256,expectedNew:p===SCHEMA55?[M.EXTRA_056.version]:[],baselineCount:54,targetCount:p===SCHEMA55?55:54};}
module.exports={SCHEMA54,SCHEMA55,SCHEMA61,INVENTORY55,INVENTORY55_SHA256,SOURCE_BASE,GROWTH_CASES,name,buildProfile,counts,selectedCounts,cases,manifest,producerProfile,migrationPlan};

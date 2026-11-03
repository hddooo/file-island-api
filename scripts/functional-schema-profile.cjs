'use strict';
// Explicit test selection only. This module never grants deployment or migration permission.
const assert=require('node:assert/strict'),M=require('./migration-build-profile.cjs');
const SCHEMA54='schema54',SCHEMA55='schema55-qualification';
const INVENTORY55='ops-prep/functional-schema55-test-inventory.json';
const INVENTORY55_SHA256='749bdd1802b7ec60f5fc768243cf02591247deffefb5d76ce88c5716bdadb29b';
const SOURCE_BASE='19077b447af00a86230ddb668f2c0c133ed76588';
const GROWTH_CASES=['admin-partner-xp','hall-public-profile','growth-xp-preservation'];
function name(value=SCHEMA54){assert([SCHEMA54,SCHEMA55].includes(value),'Explicit functional qualification profile required');return value;}
function buildProfile(value){return name(value)===SCHEMA55?M.SCHEMA55_IMAGE_ONLY:M.SCHEMA54;}
function counts(value){return name(value)===SCHEMA55?{unit:72,integration:43}:{unit:67,integration:40};}
function selectedCounts(value){const c=counts(value);return {...c,unit:c.unit-5};}
function cases(suite,base,value){return suite==='api-integration'&&name(value)===SCHEMA55?[...base,...GROWTH_CASES]:base;}
function manifest(value,profile){return M.validateManifest(value,buildProfile(profile));}
function producerProfile(value,env){const p=name(value);if(env.GITHUB_ACTIONS==='true'||env.HANQ_FUNCTIONAL_IMAGE_ID)assert.equal(p,name(env.HANQ_FUNCTIONAL_QUALIFICATION_PROFILE),'Functional profile differs from producer binding');return p;}
function migrationPlan(value,profile){const p=name(profile),target=manifest(value,p),baseline=p===SCHEMA55?M.validateManifest({migrations:target.rows.filter(r=>r.version!==M.EXTRA_056.version),privilegesSha256:target.privilegesSha256}):target;return {qualificationProfile:p,baselineRows:baseline.rows,targetRows:target.rows,baselineSha256:baseline.manifestSha256,targetSha256:target.manifestSha256,expectedNew:p===SCHEMA55?[M.EXTRA_056.version]:[],baselineCount:54,targetCount:p===SCHEMA55?55:54};}
module.exports={SCHEMA54,SCHEMA55,INVENTORY55,INVENTORY55_SHA256,SOURCE_BASE,GROWTH_CASES,name,buildProfile,counts,selectedCounts,cases,manifest,producerProfile,migrationPlan};

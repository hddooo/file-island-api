'use strict';
const fs=require('node:fs');
const C=require('./image-build-contract.cjs');
const profiles=require('./migration-build-profile.cjs');
function inspect(receipt,controllerSource=''){
 const blockers=C.qualification().blockers.slice();
 const claimedProfile=receipt?.migrationProfile??profiles.SCHEMA54;let inventory=null;
 try{inventory=profiles.validateManifest({migrations:receipt?.migrations,privilegesSha256:receipt?.privilegesSha256},claimedProfile);if(inventory.manifestSha256!==receipt.migrationManifestSha256)throw Error('Manifest mismatch');}catch{inventory=null;blockers.push('Image migration profile/inventory/privileges are missing or differ from the exact reviewed manifest');}
 if(claimedProfile===profiles.SCHEMA55_IMAGE_ONLY)blockers.push(profiles.MIGRATION_BLOCKER);
 if(receipt?.kind!=='api-image-build-only'||receipt?.repository!==C.REPOSITORY)blockers.push('Unsupported image receipt/source repository');
 if(receipt?.mode==='local-unqualified')blockers.push('Local execution is not an authenticated GitHub run');
 blockers.push('Offline inspection cannot authenticate a completed/success run, exact attempt and artifact digest; receipt flags are not independent provenance');
 if(receipt?.productionQualified!==false)blockers.push('Image-only receipt must never claim production qualification');
 const trustedRepository=/REPOSITORY=['"]([^'"]+)['"]/.exec(controllerSource)?.[1]||null;
 const trustedWorkflow=/WORKFLOW=['"]([^'"]+)['"]/.exec(controllerSource)?.[1]||null;
 const mountText=/const required=\[([^\]]+)\]/.exec(controllerSource)?.[1];
 const allowedMountTargets=mountText?[...mountText.matchAll(/['"]([^'"]+)['"]/g)].map(match=>match[1]):[];
 const additionalRequiredReadonlyTargets=['/run/hanq-private-toeic-audio','/app/private-textbook-semantic-data'];
 const missingApprovedTargets=additionalRequiredReadonlyTargets.filter(target=>!allowedMountTargets.includes(target));
 if(trustedRepository&&trustedRepository!==C.REPOSITORY)blockers.push('Installed producer repository differs from new API repository');
 if(missingApprovedTargets.length)blockers.push('Required private media targets need an exact reviewed readonly mount policy; never remove existing audio');
 return {ready:false,applyPerformed:false,sourceCommit:receipt?.sourceCommit||null,imageId:receipt?.imageId||null,migrationProfile:{claimed:claimedProfile,name:inventory?.migrationProfile||null,inventoryVerified:inventory!==null,operationalMigrationAllowed:false},controller:{trustedRepository,trustedWorkflow,allowedMountTargets},missingApprovedTargets,requiredSuites:C.REQUIRED_SUITES,blockers:[...new Set(blockers)]};
}
module.exports={inspect};
if(require.main===module){try{const receipt=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),source=process.argv[3]?fs.readFileSync(process.argv[3],'utf8'):'';console.log(JSON.stringify(inspect(receipt,source),null,2));process.exitCode=2;}catch{console.error('Image handoff inputs unavailable; no deployment performed.');process.exitCode=1;}}

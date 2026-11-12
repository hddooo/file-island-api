'use strict';
// Explicit current61 FE-only entrypoint. Not a generic environment/command runner.
const fs=require('node:fs'),A=require('node:assert/strict'),H=require('./fe-unit-host.cjs'),C=require('./fe-unit-contract.cjs');
function run(file,env=process.env){A.equal(env.HANQ_FUNCTIONAL_QUALIFICATION_PROFILE,'schema61-local-private-retained-base');const c=JSON.parse(fs.readFileSync(file));for(const [key,e]of [['apiRoot','HANQ_FUNCTIONAL_API_ROOT'],['apiCommit','HANQ_FUNCTIONAL_API_COMMIT'],['frontendRoot','HANQ_FUNCTIONAL_FRONTEND_ROOT'],['frontendCommit','HANQ_FUNCTIONAL_FRONTEND_COMMIT']])A.equal(c[key],env[e]);const result=H.execute(c);process.stdout.write(C.tap(result.rows));return result;}
module.exports={run};if(require.main===module){try{A.equal(process.argv.length,3);run(process.argv[2]);}catch(e){console.error(JSON.stringify({kind:'CURRENT61_FE_UNIT_FAILED',class:e.name,detailsWithheld:true}));process.exitCode=1;}}

'use strict';
const fs=require('node:fs'),path=require('node:path');
const C=require('./functional-evidence.cjs');
// Docker's Windows CLI discovers its system BuildKit plugin under ProgramFiles.
// Keep this OS installation path while still excluding arbitrary host/secret configuration.
function filterEnvironment(env){
 const allowed=/^(?:PATH|Path|PATHEXT|SystemRoot|SYSTEMROOT|ProgramFiles|PROGRAMFILES|TEMP|TMP|HOME|USERPROFILE|CI|GITHUB_ACTIONS|GITHUB_REPOSITORY|GITHUB_SHA|GITHUB_REF|GITHUB_EVENT_NAME|GITHUB_WORKFLOW_REF|GITHUB_RUN_ID|GITHUB_RUN_ATTEMPT)$/;
 return Object.fromEntries(Object.entries(env).filter(([key])=>allowed.test(key)));
}
// No shell, environment dump, token lookup, Docker access, installation or deployment here.
if(require.main===module){try{
 const [planFile,rootsFile,outputFile]=process.argv.slice(2);if(!planFile||!rootsFile||!outputFile)throw Error('Usage: node scripts/run-functional-evidence.cjs <reviewed-plan.json> <checkout-paths.json> <new-output.json>');
 if(fs.existsSync(outputFile))throw Error('Preserve existing evidence; output must be new');
 const plan=JSON.parse(fs.readFileSync(planFile,'utf8')),roots=JSON.parse(fs.readFileSync(rootsFile,'utf8'));
 // Inherit only ordinary process necessities and non-secret test fixture/configuration names.
 // Test harnesses generate synthetic database/JWT credentials in memory; production variables are never inherited.
 const env=filterEnvironment(process.env);
 const evidence=C.executePlan(plan,roots,env);fs.writeFileSync(path.resolve(outputFile),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({output:path.basename(outputFile),sourceCommit:evidence.apiCommit,executionPhase:evidence.executionPhase,workflowStatus:evidence.workflowStatus,authenticated:false,productionQualified:false,artifactName:'hanq-release-evidence-'+evidence.apiCommit+'-'+evidence.producer.runId+'-'+evidence.producer.runAttempt}));
}catch{console.error('Functional evidence rejected: incomplete, failed or mismatched execution/binding. No evidence or deployment was produced.');process.exitCode=1;}}
module.exports={filterEnvironment};

'use strict';
// Runs an exact committed list of real Node tests, including legacy plain-assert FE scripts.
const cp=require('node:child_process'),path=require('node:path'),assert=require('node:assert/strict');
function run(repository,listPath,env=process.env){
 assert(['api','frontend','deploy'].includes(repository));assert(/^ops-prep\/[a-z0-9-]+\.json$/.test(listPath));
 const api=env.HANQ_FUNCTIONAL_API_ROOT,apiCommit=env.HANQ_FUNCTIONAL_API_COMMIT,root=env['HANQ_FUNCTIONAL_'+repository.toUpperCase()+'_ROOT'],commit=env['HANQ_FUNCTIONAL_'+repository.toUpperCase()+'_COMMIT'];
 assert(api&&root&&/^[a-f0-9]{40}$/.test(apiCommit||'')&&/^[a-f0-9]{40}$/.test(commit||''));
 const git=(cwd,args)=>cp.execFileSync('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024}).trim();
 assert.equal(git(api,['rev-parse','HEAD']),apiCommit);assert.equal(git(root,['rev-parse','HEAD']),commit);assert.equal(git(root,['status','--porcelain','--untracked-files=no']),'');
 const scripts=JSON.parse(git(api,['show',apiCommit+':'+listPath]));assert(Array.isArray(scripts)&&scripts.length>0&&new Set(scripts).size===scripts.length);
 for(const script of scripts){assert(typeof script==='string'&&/^[a-zA-Z0-9_./-]+\.(?:cjs|js|mjs)$/.test(script)&&!script.split('/').includes('..'));assert.equal(git(root,['ls-files','--error-unmatch','--',script]),script);}
 const result=cp.spawnSync(process.execPath,['--test','--test-reporter=tap','--test-concurrency=1',...scripts],{cwd:root,env:{...env,NODE_PATH:[path.join(root,'.ci-tools/node_modules'),path.join(root,'node_modules')].join(path.delimiter)},encoding:'utf8',shell:false,windowsHide:true,timeout:3000000,maxBuffer:64*1024*1024});
 assert(!result.error&&!result.signal,'real test process interrupted');process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');return result.status===0?0:1;
}
module.exports={run};
if(require.main===module){try{process.exitCode=run(process.argv[2],process.argv[3]);}catch{console.error('Tracked Node test list/source verification failed; no test success claimed.');process.exitCode=1;}}

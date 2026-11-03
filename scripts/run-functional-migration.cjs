'use strict';
// Creates its own network-isolated synthetic PostgreSQL cluster. Never accepts a database URL.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const C=require('./functional-evidence.cjs');
const P=require('./functional-schema-profile.cjs');
const PG17='sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe';
const digest=/^sha256:[a-f0-9]{64}$/;
function config(input,env=process.env){
 if(env.GITHUB_ACTIONS==='true'||env.HANQ_FUNCTIONAL_IMAGE_ID){assert.equal(input.sourceCommit,env.HANQ_FUNCTIONAL_API_COMMIT,'Migration source differs from producer binding');assert.equal(input.candidateImage,env.HANQ_FUNCTIONAL_IMAGE_ID,'Migration tested another candidate image');}
 assert.equal(input.postgresImage,PG17,'reviewed existing PostgreSQL17 image required');
 const qualificationProfile=P.producerProfile(input.qualificationProfile,env);
 for(const field of ['baselineImage','candidateImage'])assert(digest.test(input[field]),'immutable image required');
 assert(/^[a-f0-9]{40}$/.test(input.sourceCommit));assert(path.isAbsolute(input.manifestFile));
 const m=JSON.parse(fs.readFileSync(input.manifestFile,'utf8'));
 if(qualificationProfile===P.SCHEMA55){assert.equal(input.baselineImage,'sha256:5ffd2cc49f557fab789dd8f5092350ff27c8396ccfee0dda1c29c774e0a347b6','Reviewed schema54 baseline image required');const plan=P.migrationPlan(m,qualificationProfile);return {...input,qualificationProfile,manifestSha256:plan.targetSha256,baselineManifestSha256:plan.baselineSha256,expectedApplied:1,targetCount:55};}
 assert.equal(m.migrations.length,54);assert(m.migrations.some(x=>/^055_/.test(x.version)));assert(!m.migrations.some(x=>/^(047|056)_/.test(x.version)));
 return {...input,qualificationProfile,manifestSha256:C.manifestHash(m.migrations),baselineManifestSha256:C.manifestHash(m.migrations),expectedApplied:0,targetCount:54};
}
function docker(args,options={}){
 const result=cp.spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:2*1024*1024,...options});
 assert.equal(result.status,0,'Isolated migration Docker '+args[0]+' failed; private output withheld');return result.stdout.trim();
}
async function prepare(input){
 const cfg=config(input),suffix=crypto.randomBytes(6).toString('hex'),name='hanq-functional-pg-'+suffix,volume='hanq-functional-pgdata-'+suffix,role='fixture_'+suffix,baseline='hanq_baseline_'+suffix+'_test',restored='hanq_restore_'+suffix+'_test';
 // Pull/install never occurs: all images must already be available in the authorized execution environment.
 for(const image of [cfg.postgresImage,cfg.baselineImage,cfg.candidateImage])docker(['image','inspect',image,'--format','{{.Id}}']);
 const revision=docker(['image','inspect',cfg.candidateImage,'--format','{{index .Config.Labels "org.opencontainers.image.revision"}}']);assert.equal(revision,cfg.sourceCommit,'candidate source label mismatch');
 docker(['volume','create','--label','hanq.purpose=synthetic-migration-qualification','--label','hanq.source='+cfg.sourceCommit,volume]);
 docker(['run','--rm','--pull','never','--network','none','--user','999:999','--read-only','--mount','type=volume,source='+volume+',target=/var/lib/postgresql/data','--entrypoint','sh',PG17,'-c','test -w /var/lib/postgresql/data']);
 const containerId=docker(['run','--detach','--pull','never','--name',name,'--label','hanq.purpose=synthetic-migration-qualification','--label','hanq.source='+cfg.sourceCommit,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','999:999','--mount','type=volume,source='+volume+',target=/var/lib/postgresql/data','--tmpfs','/var/run/postgresql:rw,nosuid,noexec,size=16m,uid=999,gid=999,mode=0770','--tmpfs','/tmp:rw,nosuid,noexec,size=64m','--env','POSTGRES_HOST_AUTH_METHOD=trust',PG17,'-c','shared_buffers=32MB','-c','max_wal_size=256MB','-c','checkpoint_timeout=30s']);
 let ready=false;for(let i=0;i<30;i++){const r=cp.spawnSync('docker',['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],{windowsHide:true,timeout:5000});if(r.status===0){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,1000));}assert(ready,'isolated PG readiness failed');
 assert.equal(docker(['inspect',name,'--format','{{.Id}} {{.HostConfig.NetworkMode}}']),containerId+' none');
 docker(['exec','-i',name,'psql','-X','-w','-U','postgres','-d','postgres','-q','-v','ON_ERROR_STOP=1'],{input:'CREATE ROLE '+role+' LOGIN;\nCREATE DATABASE '+baseline+' OWNER '+role+';\nCREATE DATABASE '+restored+' OWNER '+role+';\n'});
 function phase(image,database,mode){
  const supportMounts=['functional-schema-profile.cjs','migration-build-profile.cjs'].flatMap(file=>['--mount','type=bind,source='+path.join(__dirname,file)+',target=/run/'+file+',readonly']);
  assert(/_test$/.test(database));const result=docker(['run','--rm','--pull','never','--network','container:'+name,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','node','--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--mount','type=bind,source='+path.join(__dirname,'functional-migration-container.cjs')+',target=/run/compatibility.cjs,readonly','--mount','type=bind,source='+cfg.manifestFile+',target=/run/manifest.json,readonly',...supportMounts,'--env','NODE_ENV=test','--env','HANQ_QUAL_QUALIFICATION_PROFILE='+cfg.qualificationProfile,'--env','NODE_PATH=/app/node_modules','--env','HANQ_TEST_DATABASE_URL=postgresql://'+role+'@127.0.0.1:5432/'+database,'--entrypoint','node',image,'/run/compatibility.cjs',mode]);return JSON.parse(result);
 }
 return {cfg,name,volume,containerId,baseline,restored,phase};
}
function register(input){
 const {before,test,after}=require('node:test');let s,beforeResult,candidateResult;
 before(async()=>{s=await prepare(input);});
 test('baseline-checksums',()=>{beforeResult=s.phase(s.cfg.baselineImage,s.baseline,'baseline');assert.equal(beforeResult.applied,54);assert.equal(beforeResult.schemaSha256,s.cfg.baselineManifestSha256);});
 test('restore-and-upgrade',()=>{assert(beforeResult);const dump='/tmp/owned-synthetic-baseline.dump';docker(['exec',s.name,'pg_dump','-w','-U','postgres','-d',s.baseline,'--format=custom','--file',dump]);docker(['exec',s.name,'pg_restore','-w','-U','postgres','-d',s.restored,'--exit-on-error',dump]);candidateResult=s.phase(s.cfg.candidateImage,s.restored,'candidate');assert.equal(candidateResult.snapshotSha256,beforeResult.snapshotSha256);});
 test('idempotent-migrations',()=>{assert(candidateResult);assert.equal(candidateResult.applied,s.cfg.expectedApplied);assert.equal(candidateResult.alreadyApplied,54);assert.equal(candidateResult.rerunApplied,0);assert.equal(candidateResult.schemaSha256,s.cfg.manifestSha256);});
 test('legacy-xp-preserved',()=>{assert.equal(candidateResult.syntheticUsers,1);assert.equal(candidateResult.syntheticXp,1000);assert.equal(candidateResult.snapshotSha256,beforeResult.snapshotSha256);});
 test('rollback-schema-compatible',()=>{const result=s.phase(s.cfg.baselineImage,s.restored,'rollback-probe');assert.equal(result.healthStatus,200);assert.equal(result.snapshotSha256,beforeResult.snapshotSha256);assert.equal(result.dataUnchanged,true);});
 // Preserve isolated resources for diagnosis; no prune/deletion of existing resources.
 after(()=>{if(s)console.log('# isolated synthetic migration resources retained; no production connection, credential or published host port');});
}
module.exports={config,register};
if(require.main===module){try{register(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));}catch{console.error('Migration harness rejected its configuration; no test success claimed.');process.exitCode=1;}}

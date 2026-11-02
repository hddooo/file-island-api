'use strict';
// App compatibility only: no production inputs, image qualification, backup or restore.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {Pool}=require('pg');
const {countsFromTap,passed}=require('./functional-api-test-container.cjs');
const M=require('./migration-build-profile.cjs');
const BASE='3af9a175c69f976e4cc74346245caf68654ef746';
const FILES=['auth','admin-partner-xp','hall-public-profile','profile-attempts','growth-history'].map(name=>name+'.test.js');
const PROTECTED=['src','migrations','test','package.json','package-lock.json','Dockerfile'];
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function command(bin,args,options={}){const r=cp.spawnSync(bin,args,{encoding:'utf8',timeout:240000,maxBuffer:32*1024*1024,...options});assert.equal(r.status,0,bin+' '+args[0]+' failed; output withheld');return r.stdout.trim();}
function preflight(env=process.env,git=args=>command('git',args)){
 assert.equal(env.GITHUB_ACTIONS,'true');assert.equal(env.GITHUB_REPOSITORY,'hddooo/file-island-api');assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');assert.equal(env.PG17_APP_COMPAT_OPT_IN,'true');
 assert(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||''),'Exact event source SHA required');assert.equal(git(['rev-parse','HEAD']),env.GITHUB_SHA,'Checkout differs from event source');
 // Checkout depth=1 may omit BASE; compare immutable blob IDs in the checked-in lock instead.
 for(const key of ['DATABASE_URL','HANQ_TEST_DATABASE_URL','PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','PGSERVICEFILE','DOCKER_HOST','DOCKER_CONTEXT'])assert(!env[key],'Ambient database or remote Docker input refused');
 return env.GITHUB_SHA;
}
function fixture(){
 const questions={};for(let i=0;i<30;i++){const id='synthetic-pg17-'+String(i).padStart(2,'0');questions[id]={id,v:1,chapter:'prehistory',prompt:'Synthetic compatibility item '+i,options:[{id:id+'-a',text:'Synthetic A',correct:true},{id:id+'-b',text:'Synthetic B',correct:false}]};}
 const exams={};for(let i=1;i<=10;i++){const id='exam-75-'+String(i).padStart(2,'0');exams[id]={id,v:1,exam:75,number:i,answer:1,points:2,era:'prehistory',options:Array.from({length:5},(_,j)=>({id:id+'-option-'+(j+1),text:'Synthetic '+(j+1),correct:j===0}))};}
 return {'quiz-catalog.js':['HANQ_QUIZ_CATALOG',{questions}],'exam-pool.js':['HANQ_EXAM_POOL',{questions:exams}]};
}
function validateProtected(git=args=>command('git',args)){
 const lock=JSON.parse(fs.readFileSync(path.join(__dirname,'pg17-app-compat-lock.json'),'utf8'));assert.equal(lock.applicationSource,BASE);assert.deepEqual(Object.keys(lock.blobs).sort(),[...PROTECTED].sort());
 for(const name of PROTECTED)assert.equal(git(['rev-parse','HEAD:'+name]),lock.blobs[name],'Protected source changed: '+name);
 return lock;
}
function summarize(child){
 const text=(child.stdout||'')+'\n'+(child.stderr||'');let counts={},tapValid=false;
 for(const field of ['tests','pass','fail','skipped','cancelled','todo']){const matches=[...text.matchAll(new RegExp('^# '+field+' (\\d+)\\r?$','gm'))];const value=matches.length===1?Number(matches[0][1]):null;counts[field]=Number.isSafeInteger(value)&&value>=0?value:null;}
 try{counts=countsFromTap(text);tapValid=passed({counts,exitCode:child.status,signal:child.signal||null});}catch{/* Preserve actual final counts even when failed/skipped TAP is ineligible. */}
 return {counts,tapValid,exitCode:child.status,signal:child.signal||null};
}
async function main(){
 const result={kind:'pg17-app-compatibility-only',passed:false,productionQualified:false,backupRestoreQualified:false,upgrade056Qualified:false,imageQualified:false,sixSuiteQualified:false,files:[],cleanup:false};
 const name='hanq-pg17-compat-'+crypto.randomBytes(6).toString('hex');let temp,pool,created=false,stage='preflight';
 try{
  result.sourceCommit=preflight();validateProtected();result.applicationSource=BASE;result.runId=process.env.GITHUB_RUN_ID;result.runAttempt=process.env.GITHUB_RUN_ATTEMPT;
  result.excludedIntegrationFiles=fs.readdirSync('test/integration').filter(x=>x.endsWith('.test.ts')&&!FILES.includes(x.replace(/\.ts$/,'.js'))).sort();
  const manifest={migrations:fs.readdirSync('migrations').filter(x=>/^\d{3}_[a-z0-9_]+\.sql$/.test(x)).sort().map(version=>({version,checksum:sha(fs.readFileSync(path.join('migrations',version)))})),privilegesSha256:sha(fs.readFileSync('migrations/repeatable/privileges.sql'))};
  const checked=M.validateManifest(manifest,M.SCHEMA55_IMAGE_ONLY);result.sql55Sha256=checked.manifestSha256;result.privilegesSha256=checked.privilegesSha256;
  stage='postgres-image';command('docker',['pull','postgres:17-bookworm']);
  const digests=JSON.parse(command('docker',['image','inspect','postgres:17-bookworm','--format','{{json .RepoDigests}}']));
  const image=digests.find(x=>/^postgres@sha256:[a-f0-9]{64}$/.test(x));assert(image,'Official postgres immutable repository digest required');result.postgresImage=image;result.postgresImageId=command('docker',['image','inspect',image,'--format','{{.Id}}']);
  const password=crypto.randomBytes(32).toString('hex'),database='hanq_pg17_compat_test';
  stage='postgres-start';created=true;command('docker',['run','--detach','--name',name,'--pull','never','--label','hanq.purpose=pg17-app-compat','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB='+database,image],{env:{...process.env,POSTGRES_PASSWORD:password}});
  const inspection=JSON.parse(command('docker',['inspect',name]))[0];const binding=inspection.NetworkSettings.Ports['5432/tcp'];assert.equal(binding.length,1);assert.equal(binding[0].HostIp,'127.0.0.1');
  const url='postgresql://postgres:'+password+'@127.0.0.1:'+binding[0].HostPort+'/'+database;
  pool=new Pool({connectionString:url,ssl:false,connectionTimeoutMillis:3000});stage='postgres-version';let version;
  for(let i=0;i<30;i++){try{version=(await pool.query("SELECT current_setting('server_version_num') AS num,version() AS version")).rows[0];break;}catch{await new Promise(resolve=>setTimeout(resolve,1000));}}
  assert(version,'PostgreSQL readiness failed');assert(Number(version.num)>=170000&&Number(version.num)<180000,'PostgreSQL17 required');result.postgresVersion=version.version;result.serverVersionNum=Number(version.num);
  temp=fs.mkdtempSync(path.join(os.tmpdir(),'hanq-pg17-compat-'));fs.mkdirSync(path.join(temp,'media'));for(const [file,[global,data]] of Object.entries(fixture()))fs.writeFileSync(path.join(temp,'media',file),'window.'+global+'='+JSON.stringify(data)+';');
  stage='integration';for(const file of FILES){
   const child=cp.spawnSync(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap',path.join('dist/test/integration',file)],{env:{...process.env,HANQ_TEST_DATABASE_URL:url,HANQ_FRONT_DIR:temp},encoding:'utf8',timeout:180000,maxBuffer:32*1024*1024});
   result.files.push({file,...summarize(child)});
  }
  const rows=(await pool.query('SELECT version,checksum FROM hanq.schema_migrations ORDER BY version')).rows;M.validateManifest({migrations:rows,privilegesSha256:manifest.privilegesSha256},M.SCHEMA55_IMAGE_ONLY);result.appliedMigrationCount=rows.length;
  result.passed=result.files.length===FILES.length&&result.files.every(row=>row.tapValid&&passed(row));assert(result.passed,'Selected integration tests failed or skipped');
 }catch{result.passed=false;result.failureStage=stage;}
 finally{
  if(pool)await pool.end().catch(()=>{});
  let removed=!created;if(created){try{command('docker',['rm','--force','--volumes',name]);const absent=cp.spawnSync('docker',['inspect',name],{encoding:'utf8',timeout:10000});removed=absent.status===1;}catch{removed=false;}}
  if(temp){try{fs.rmSync(temp,{recursive:true,force:true});}catch{removed=false;}}
  result.cleanup=removed;result.passed=result.passed&&removed;
  fs.writeFileSync('pg17-app-compat-result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
 }
}
if(require.main===module)main().catch(()=>{console.error('PG17 compatibility failed; details withheld');process.exitCode=1;});
module.exports={BASE,FILES,PROTECTED,fixture,preflight,validateProtected,summarize};

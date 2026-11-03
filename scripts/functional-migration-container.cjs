'use strict';
require('reflect-metadata');
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {Pool}=require('pg'),{migrate}=require('/app/dist/src/db/migrator.js');
const P=require('./functional-schema-profile.cjs');
const expected=JSON.parse(fs.readFileSync('/run/manifest.json','utf8'));
const qualificationProfile=P.name(process.env.HANQ_QUAL_QUALIFICATION_PROFILE),schema55=qualificationProfile===P.SCHEMA55;
const plan=schema55?P.migrationPlan(expected,qualificationProfile):{baselineRows:expected.migrations,targetRows:expected.migrations,expectedNew:[],targetCount:54};
const url=new URL(process.env.HANQ_TEST_DATABASE_URL);
assert.equal(url.hostname,'127.0.0.1');assert(/_test$/.test(url.pathname));assert.equal(process.env.NODE_ENV,'test');
const pool=new Pool({connectionString:url.href,ssl:false,max:2});
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const preserved=s=>schema55?{users:s.users,ledger:s.ledger}:s;
async function snapshot(){return {migrations:(await pool.query('SELECT version,checksum FROM hanq.schema_migrations ORDER BY version')).rows,users:(await pool.query('SELECT id,email_normalized,display_name,created_at::text FROM hanq.users ORDER BY id')).rows,ledger:(await pool.query('SELECT user_id,event_key,kind,amount,created_at::text FROM hanq.growth_ledger ORDER BY user_id,event_key')).rows};}
async function main(){const mode=process.argv[2];
 if(mode==='baseline'){
  const r=await migrate(pool,'/app/migrations');assert.equal(r.applied.length,54);assert.equal(r.alreadyApplied,0);
  await pool.query("INSERT INTO hanq.users(id,email_normalized,email_display,password_hash,display_name,created_at,updated_at,password_changed_at) VALUES('11111111-1111-4111-8111-111111111111','restore@example.test','restore@example.test','$argon2id$synthetic-not-login','synthetic restore fixture','2026-10-01Z','2026-10-01Z','2026-10-01Z')");
  await pool.query("INSERT INTO hanq.growth_ledger(user_id,event_key,kind,amount,created_at) VALUES('11111111-1111-4111-8111-111111111111','signup','signup',1000,'2026-10-01Z')");
  const s=await snapshot();assert.deepEqual(s.migrations,plan.baselineRows);console.log(JSON.stringify({mode,applied:54,snapshotSha256:hash(preserved(s)),schemaSha256:hash(s.migrations),syntheticUsers:1,syntheticXp:1000}));
 }else if(mode==='candidate'){
  const before=await snapshot();assert.deepEqual(before.migrations,plan.baselineRows);
  const first=await migrate(pool,'/app/migrations'),second=await migrate(pool,'/app/migrations');assert.deepEqual(first,{applied:plan.expectedNew,alreadyApplied:54});assert.deepEqual(second,{applied:[],alreadyApplied:plan.targetCount});
  const after=await snapshot();assert.deepEqual(after.migrations,plan.targetRows);assert.deepEqual(preserved(after),preserved(before));assert.equal(after.users.length,1);assert.equal(after.ledger.reduce((n,r)=>n+r.amount,0),1000);
  console.log(JSON.stringify({mode,applied:first.applied.length,alreadyApplied:first.alreadyApplied,rerunApplied:second.applied.length,snapshotSha256:hash(preserved(after)),schemaSha256:hash(after.migrations),syntheticUsers:1,syntheticXp:1000}));
 }else if(mode==='rollback-probe'){
  const {loadConfig}=require('/app/dist/src/config/config.js'),{createApp}=require('/app/dist/src/bootstrap.js');
  const key=()=>crypto.randomBytes(32).toString('hex');const config=loadConfig({NODE_ENV:'test',HANQ_TEST_DATABASE_URL:url.href,HANQ_DB_SSL_MODE:'disable',HANQ_JWT_ISSUER:'isolated-restore-test',HANQ_JWT_ACCESS_SECRET:key(),HANQ_JWT_REFRESH_SECRET:key(),HANQ_CORS_ORIGINS:'http://localhost:5173',HANQ_COOKIE_SAMESITE:'lax',HANQ_COOKIE_SECURE:'false',HANQ_PAYMENT_PROVIDER:'none'});
  const before=await snapshot(),app=await createApp(config);try{await app.listen(0,'127.0.0.1');const address=app.getHttpServer().address();assert(address&&typeof address==='object');const response=await fetch('http://127.0.0.1:'+address.port+'/api/v1/health');assert.equal(response.status,200);assert.deepEqual(await snapshot(),before);console.log(JSON.stringify({mode,healthStatus:200,snapshotSha256:hash(preserved(before)),dataUnchanged:true}));}finally{await app.close();}
 }else throw Error('Unknown compatibility phase');
}
main().catch(e=>{console.error(JSON.stringify({status:'failed',code:/^[A-Z0-9_]{1,40}$/.test(e.code||'')?e.code:null,errorClass:e.constructor.name,privateErrorExported:false}));process.exitCode=1;}).finally(()=>pool.end());

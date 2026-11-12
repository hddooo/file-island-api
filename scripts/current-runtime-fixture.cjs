'use strict';
// Test-only exact61 materialization. Never loads production bootstrap or accepts production DB targets.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),A=require('node:assert/strict'),C=require('./current-runtime-contract.cjs'),F=require('./current-runtime-schema-fixture.cjs');
const PRIVILEGES='9fc57d632355720757da4ec9ba9a44fcb59bae296b295fb561e0a494039960c0';
function scope(config,env=process.env){
 A.equal(env.NODE_ENV,'test');A.equal(env.HANQ_QUAL_QUALIFICATION_PROFILE,C.PROFILE);
 const token=env.HANQ_QUAL_ISOLATION_TOKEN;A(/^[a-f0-9]{32}$/.test(token||''),'owned random isolation token required');
 A.equal(env.HANQ_QUAL_NETWORK_MODE,'container-owned-none');
 const d=config.database||config;A.equal(config.env??'test','test');A.equal(d.host,'127.0.0.1');A.equal(Number(d.port),5432);
 A.equal(d.database,'hanq_qual_'+token+'_test');A.equal(d.user,'fixture_'+token);return {database:d.database,user:d.user,host:d.host,port:5432,token};
}
function envConfig(env=process.env){const u=new URL(env.HANQ_TEST_DATABASE_URL);A.equal(u.protocol,'postgresql:');A.equal(u.search,'');A.equal(u.hash,'');return {env:'test',database:{host:u.hostname,port:Number(u.port||5432),database:decodeURIComponent(u.pathname.slice(1)),user:decodeURIComponent(u.username)}};}
async function verifyDatabase(pool,config,env=process.env){const s=scope(config,env),actual=(await pool.query("SELECT current_database() AS database, current_user AS username, host(inet_server_addr()) AS address, inet_server_port() AS port")).rows;A.deepEqual(actual,[{database:s.database,username:s.user,address:'127.0.0.1',port:5432}],'actual DB connection differs from owned fixture');return s;}
function regular(file){const st=fs.lstatSync(file);A(st.isFile()&&!st.isSymbolicLink(),'regular fixture required');return fs.readFileSync(file);}
function stage(manifest,directory,privilegesFile,{temporaryRoot=os.tmpdir(),env=process.env,config=envConfig(env)}={}){
 scope(config,env);const loaded=F.loadExactSql(manifest,directory),privileges=regular(privilegesFile);A.equal(C.hash(privileges),PRIVILEGES);
 const parent=fs.realpathSync(temporaryRoot);A(fs.statSync(parent).isDirectory());const root=fs.mkdtempSync(path.join(parent,'hanq-schema61-fixture-')),migrations=path.join(root,'migrations');
 fs.mkdirSync(path.join(migrations,'repeatable'),{recursive:true});fs.mkdirSync(path.join(root,'test','fixtures'),{recursive:true});
 for(const row of loaded.rows)fs.writeFileSync(path.join(migrations,row.version),row.bytes,{flag:'wx',mode:0o444});
 fs.writeFileSync(path.join(migrations,'repeatable','privileges.sql'),privileges,{flag:'wx',mode:0o444});
 const reviewed={migrations:loaded.contract.rows,privilegesSha256:PRIVILEGES};fs.writeFileSync(path.join(root,'test','fixtures','migration-manifest-20261030.json'),JSON.stringify(reviewed)+'\n',{flag:'wx',mode:0o444});
 return {root,migrations,manifest:reviewed,ledgerSha256:C.LEDGER,sqlExecuted:false,productionAccess:false};
}
let staged;
function stageFromEnvironment(env=process.env){scope(envConfig(env),env);if(staged)return staged;const base='/run/current-runtime-fixture';const manifest=JSON.parse(regular(path.join(base,'schema.json')));staged=stage(manifest,path.join(base,'sql'),path.join(base,'privileges.sql'),{env});return staged;}
async function initialize(pool,migrate,config,env=process.env){await verifyDatabase(pool,config,env);const selected=stageFromEnvironment(env),result=await migrate(pool,selected.migrations);const actual=(await pool.query('SELECT version,checksum FROM hanq.schema_migrations ORDER BY version')).rows;A.deepEqual(actual,selected.manifest.migrations);return result;}
module.exports={PRIVILEGES,scope,envConfig,verifyDatabase,stage,stageFromEnvironment,initialize};
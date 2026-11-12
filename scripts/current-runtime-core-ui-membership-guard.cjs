'use strict';
const A=require('node:assert/strict'),crypto=require('node:crypto');
const PROFILE='schema61-local-private-retained-base';
function authorize(profile,nonce,env=process.env){A.equal(profile,PROFILE);A.equal(env.NODE_ENV,'test');A.equal(env.HANQ_QUAL_QUALIFICATION_PROFILE,PROFILE);const expected=env.HANQ_QUAL_ISOLATION_TOKEN;A(/^[a-f0-9]{32}$/.test(expected||''));A(typeof nonce==='string'&&/^[a-f0-9]{32}$/.test(nonce));A(crypto.timingSafeEqual(Buffer.from(nonce),Buffer.from(expected)),'Execution control nonce mismatch');}
async function protect({profile,nonce,env=process.env,fixture,pool,config,migrations},operation){authorize(profile,nonce,env);fixture.scope(config,env);await fixture.verifyDatabase(pool,config,env);A.equal(migrations.length,61);A.deepEqual((await pool.query('SELECT version,checksum FROM hanq.schema_migrations ORDER BY version')).rows,migrations);return operation();}
async function assertAbsent(pool,email){A.equal((await pool.query('SELECT id FROM hanq.users WHERE email_normalized=$1',[email])).rowCount,0,'Existing accounts cannot be prepared');}
async function control({pathname,...input},operation){if(input.profile===PROFILE&&pathname.startsWith('/__qualification/')&&pathname!=='/__qualification/ready'){authorize(input.profile,input.nonce,input.env);if(pathname==='/__qualification/clock')return protect(input,operation);}return operation();}
module.exports={PROFILE,authorize,protect,assertAbsent,control};

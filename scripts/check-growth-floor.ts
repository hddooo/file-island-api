import { loadDatabaseConfig } from '../src/config/config';
import { createPool } from '../src/db/db.service';
/** Read-only preflight for015. Existing configuration/permissions only; aggregate output without account IDs or connection details. */
async function main(){
 const {env,database}=loadDatabaseConfig(process.env),pool=createPool({...database,poolMax:1});
 pool.on('error',()=>{process.exitCode=1;});
 try{const q=await pool.connect();try{
  await q.query('BEGIN TRANSACTION READ ONLY');await q.query('SET LOCAL statement_timeout=5000');
  const r=await q.query<{negative_balances:string}>(`SELECT count(*) FILTER(WHERE balance<0)::text negative_balances FROM(SELECT user_id,sum(amount) balance FROM hanq.growth_ledger GROUP BY user_id)s`);
  await q.query('ROLLBACK');const count=r.rows[0].negative_balances;
  console.log(JSON.stringify({check:'growth-floor015',environment:env,readOnly:true,negativeBalances:count,status:count==='0'?'pass':'reconciliation-required',checkedAt:new Date().toISOString()}));
  if(count!=='0')process.exitCode=2;
 }finally{await q.query('ROLLBACK').catch(()=>{});q.release();}}
 finally{await pool.end();}
}
main().catch(()=>{console.error(JSON.stringify({check:'growth-floor015',status:'unavailable',readOnly:true}));process.exitCode=1;});

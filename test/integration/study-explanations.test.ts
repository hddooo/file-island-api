import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after,before,describe,it } from 'node:test';
import type { Pool } from 'pg';
import request from 'supertest';
import { bearer,signin,signupResponse,startApp,type Session,type TestApp } from '../helpers/app';
import { freshDatabase } from '../helpers/db';
import { testConfig } from '../helpers/env';

describe('study-grounded CBT explanations: private, per round, isolated DB only',()=>{
 let pool:Pool,t:TestApp,A:Session;
 async function member(){const email='study.'+randomUUID()+'@example.test';const r=await signupResponse(t,email);assert.equal(r.status,201);await pool.query("UPDATE hanq.users SET approval_status='approved' WHERE email_normalized=$1",[email]);return signin(t,email);}
 before(async()=>{pool=await freshDatabase(testConfig());t=await startApp();A=await member();});
 after(async()=>{if(t)await t.close();if(pool)await pool.end();});
 it('returns only the requested round, in number order, to signed-in members',async()=>{
  const rows=[[79,2],[79,1],[78,1]];
  for(const [round,n] of rows){const id=`exam-${round}-${String(n).padStart(2,'0')}`;await pool.query(`INSERT INTO hanq.cbt_study_explanations(question_id,exam_round,exam_number,version,answer,payload,updated_at) VALUES($1,$2,$3,'v1',3,$4,now())`,[id,round,n,JSON.stringify({id,exam:round,number:n,answer:3,passage:['단서 → 답'],options:[1,2,3,4,5].map(k=>({number:k,correct:k===3,keyword:'보기 '+k,memo:null})),flow:'흐름'})]);}
  assert.equal((await request(t.server).get('/api/v1/cbt/study-explanations/79')).status,401);
  const r=await request(t.server).get('/api/v1/cbt/study-explanations/79').set(bearer(A.access));assert.equal(r.status,200);
  assert.deepEqual(r.body.items.map((i:{number:number})=>i.number),[1,2]);assert.equal(r.body.round,79);
  assert.equal((await request(t.server).get('/api/v1/cbt/study-explanations/99').set(bearer(A.access))).status,404);
  assert.equal((await request(t.server).get('/api/v1/cbt/study-explanations/7x').set(bearer(A.access))).status,404);
 });
});

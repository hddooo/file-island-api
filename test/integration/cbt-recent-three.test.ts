import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { CbtRepository } from '../../src/cbt/cbt.repository';

// Disposable synthetic database only: no application migration, user, or production data.
test('owned runs keeps latest three final scores per round despite 100 newer runs', async () => {
  const url = process.env.HANQ_TEST_DATABASE_URL;
  assert.ok(url?.endsWith('/recent_three_test'), 'requires dedicated disposable database');
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query(`CREATE SCHEMA hanq;
      CREATE TABLE hanq.cbt_runs(id uuid PRIMARY KEY,user_id uuid,exam_round int,status text,created_at timestamptz,final_at timestamptz);
      CREATE TABLE hanq.cbt_run_items(run_id uuid,answer_option_id text);`);
    const a=randomUUID(),b=randomUUID();
    const ids: string[]=[];
    for(let n=0;n<105;n++){
      const id=randomUUID();ids.push(id);
      await pool.query(`INSERT INTO hanq.cbt_runs VALUES($1,$2,81,'final',$3,$3)`,[id,a,new Date(200000+n*1000)]);
    }
    const old: string[]=[];
    for(let n=0;n<5;n++){
      const id=randomUUID();old.push(id);
      await pool.query(`INSERT INTO hanq.cbt_runs VALUES($1,$2,80,'final',$3,$3)`,[id,a,new Date(100000+n*1000)]);
    }
    const other=randomUUID();
    await pool.query(`INSERT INTO hanq.cbt_runs VALUES($1,$2,80,'final',now(),now())`,[other,b]);
    for(let n=0;n<101;n++)await pool.query(`INSERT INTO hanq.cbt_runs VALUES($1,$2,82,$3,$4,NULL)`,[randomUUID(),a,n%2?'ready':'active',new Date(300000+n*1000)]);
    await pool.query(`INSERT INTO hanq.cbt_run_items VALUES($1,'A'),($1,NULL),($1,'B')`,[ids[104]]);
    const repository=new CbtRepository();
    const rows=await repository.listOwned(pool,a);
    assert.equal(rows.length,106);
    assert.deepEqual(rows.filter(r=>r.exam_round===80).map(r=>r.id),old.slice(-3).reverse());
    assert.deepEqual(rows.filter(r=>r.exam_round===81).map(r=>r.id),ids.slice(-3).reverse());
    assert.equal(rows.filter(r=>r.status!=='final').length,100);
    assert.equal(rows.find(r=>r.id===ids[104])?.answered,2);
    assert.ok(rows.every(r=>r.user_id===a));
    assert.deepEqual((await repository.listOwned(pool,b)).map(r=>r.id),[other]);
    assert.deepEqual(await repository.listOwned(pool,randomUUID()),[]);
    // Completion time, not creation time, determines the three latest finished scores.
    await pool.query(`UPDATE hanq.cbt_runs SET final_at=$2 WHERE id=$1`,[old[0],new Date(999000)]);
    const completed=await repository.listOwned(pool,a);
    assert.deepEqual(completed.filter(r=>r.exam_round===80).map(r=>r.id),[old[4],old[3],old[0]]);
    assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.cbt_runs')).rows[0].n,212);
  } finally { await pool.end(); }
});

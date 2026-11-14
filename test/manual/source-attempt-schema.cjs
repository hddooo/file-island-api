/* Synthetic in-memory PostgreSQL engine check. No connection string, disk DB, credentials or production access.
 * PGLITE_MODULE=/absolute/sandbox/node_modules/@electric-sql/pglite node test/manual/source-attempt-schema.cjs
 * Install the optional test engine outside this repository. This is not a multi-client locking test. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modulePath = process.env.PGLITE_MODULE;
if (!modulePath || !path.isAbsolute(modulePath)) throw new Error('PGLITE_MODULE must name an external absolute module path');
const { PGlite } = require(modulePath);
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function main() {
  const db = new PGlite();
  let checks = 0;
  const ok = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const reject = async (sql, params, code) => { await assert.rejects(db.query(sql, params), e => e.code === code); checks++; };
  try {
    await db.exec(`CREATE SCHEMA hanq;
      CREATE TABLE hanq.users(id uuid PRIMARY KEY);
      CREATE TABLE hanq.attendance(user_id uuid,day date,PRIMARY KEY(user_id,day));
      CREATE FUNCTION hanq.forbid_growth_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append-only'; END; $$;
      CREATE TABLE hanq.growth_ledger(user_id uuid REFERENCES hanq.users(id),event_key text,kind text,amount integer,
        run_id uuid,attempt_id uuid,cbt_run_id uuid,created_at timestamptz DEFAULT now(),
        PRIMARY KEY(user_id,event_key),CONSTRAINT growth_ledger_kind_valid CHECK(true),CONSTRAINT growth_ledger_amount_valid CHECK(true));`);
    // These are the actual repository's legacy constraint definitions, not rewritten approximations.
    for (const name of ['042_battle_island.sql','046_admin_xp_adjustments.sql','048_attendance_growth.sql','049_attendance_streak_cycle.sql']) {
      await db.exec(read(`migrations/${name}`));
    }
    await db.query('INSERT INTO hanq.users(id) VALUES($1),($2)', [uid(1),uid(2)]);
    await db.query("INSERT INTO hanq.growth_ledger(user_id,event_key,kind,amount) VALUES($1,'signup','signup',1000)", [uid(1)]);
    const snapshot = (await db.query('SELECT to_jsonb(g) AS row FROM hanq.growth_ledger g')).rows;
    const cases = [];
    function sample(kind, good, bad, extra) { for (const amount of [good,bad]) cases.push({user_id:uid(1),kind,amount,...extra}); }
    sample('signup',1000,999,{event_key:'signup'});
    sample('practice-quiz',1,10,{event_key:`practice:${uid(10)}`,attempt_id:uid(10)});
    sample('practice-mock',5,6,{event_key:`practice:${uid(10)}`,attempt_id:uid(10)});
    sample('wrong-note-study',200,151,{event_key:'study:synthetic',run_id:uid(11)});
    sample('cbt-exam',200,201,{event_key:`cbt:${uid(12)}`,cbt_run_id:uid(12)});
    sample('toeic-answer',1,5,{event_key:`toeic-focus:${uid(13)}`});
    sample('battle',200,201,{event_key:`battle:${uid(14)}`,battle_match_id:uid(14)});
    sample('admin-adjustment',1000000,1000001,{event_key:`admin:${uid(15)}`,admin_adjustment_id:uid(15)});
    sample('attendance',50,15,{event_key:'attendance:2026-01-01',attendance_day:'2026-01-01'});
    async function legacyTruth() {
      const constraints = (await db.query("SELECT pg_get_expr(conbin,conrelid) expr FROM pg_constraint WHERE conrelid='hanq.growth_ledger'::regclass AND conname IN('growth_ledger_kind_valid','growth_ledger_amount_valid') ORDER BY conname")).rows;
      const expr = constraints.map(c=>`(${c.expr})`).join(' AND ');
      const out=[];
      for (const fixture of cases) out.push((await db.query(`SELECT (${expr}) AS valid FROM jsonb_populate_record(NULL::hanq.growth_ledger,$1::jsonb)`,[JSON.stringify(fixture)])).rows[0].valid);
      return out;
    }
    const before = await legacyTruth();
    ok(before, cases.map((_,i)=>i%2===0));
    // Apply the existing partner attribution/application trigger functions to synthetic partner storage.
    await db.exec(`CREATE TABLE hanq.owned_digimon(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,
      family text,stage integer,equipped boolean,first_partner boolean,xp bigint NOT NULL DEFAULT 0);
      ALTER TABLE hanq.growth_ledger ADD COLUMN digimon_id uuid;`);
    await db.query("INSERT INTO hanq.owned_digimon(user_id,family,stage,equipped,first_partner,xp) VALUES($1,'agumon',2,true,true,1000)",[uid(1)]);
    const partnerMigration=read('migrations/052_owned_digimon.sql');
    await db.exec(partnerMigration.slice(partnerMigration.indexOf('CREATE FUNCTION hanq.attribute_digimon_growth()'),partnerMigration.indexOf('CREATE FUNCTION hanq.require_equipped_digimon()')));
    await db.exec(read('proposals/source-full-attempts.sql'));
    ok(await legacyTruth(), before);
    ok((await db.query("SELECT to_jsonb(g)-'source_attempt_id'-'digimon_id' AS row FROM hanq.growth_ledger g")).rows, snapshot);
    const receiptSql=`INSERT INTO hanq.source_full_attempts(user_id,id,quiz_id,source_version,source_revision,grading_version,payload_hash,correct,total,completed_at)
      VALUES($1,$2,'synthetic',$3,'synthetic-r1',2,$4,$5,$6,clock_timestamp()) RETURNING xp_award`;
    const receiptArgs=(id,correct,total,owner=uid(1))=>[owner,id,'a'.repeat(64),Buffer.alloc(32,1),correct,total];
    const awardSql="INSERT INTO hanq.growth_ledger(user_id,event_key,kind,amount,source_attempt_id) VALUES($1,'source-full:'||$2::uuid::text,'source-full-quiz',$3,$2)";
    for (const [i,correct,total,expected] of [[20,8,10,10],[21,7,10,5],[22,6,10,1],[23,5,10,0],[24,19,24,5],[25,69,100,1],[26,59,100,0]]) {
      ok((await db.query(receiptSql,receiptArgs(uid(i),correct,total))).rows[0].xp_award,expected);
      await db.query(awardSql,[uid(1),uid(i),expected]); checks++;
    }
    // The latest score can be lower than an older score; this is never MAX(score).
    ok((await db.query('SELECT id,correct,total,xp_award FROM hanq.source_full_attempts WHERE user_id=$1 ORDER BY seq DESC LIMIT 1',[uid(1)])).rows,
      [{id:uid(26),correct:59,total:100,xp_award:0}]);
    await reject(awardSql,[uid(1),uid(20),10],'23505');
    await reject(receiptSql,receiptArgs(uid(20),8,10),'23505');
    await db.query(receiptSql,receiptArgs(uid(27),8,10));
    await reject(awardSql,[uid(2),uid(27),10],'23503');
    await reject(awardSql,[uid(1),uid(27),5],'23503');
    await reject("INSERT INTO hanq.growth_ledger(user_id,event_key,kind,amount,source_attempt_id) VALUES($1,'synthetic','practice-quiz',1,$2)",[uid(1),uid(22)],'23514');
    await reject("INSERT INTO hanq.growth_ledger(user_id,event_key,kind,amount) VALUES($1,'source-full:missing','source-full-quiz',10)",[uid(1)],'23514');
    await reject('UPDATE hanq.source_full_attempts SET correct=0 WHERE id=$1',[uid(20)],'P0001');
    await reject('DELETE FROM hanq.source_full_attempts WHERE id=$1',[uid(20)],'P0001');
    await reject(receiptSql,receiptArgs(uid(28),0,0),'23514');
    await reject(receiptSql,receiptArgs(uid(28),11,10),'23514');
    ok(Number((await db.query('SELECT xp FROM hanq.owned_digimon WHERE user_id=$1 AND equipped',[uid(1)])).rows[0].xp),1022);
    // The production adapter wraps both inserts in one transaction; an award failure leaves neither receipt nor credit.
    await db.exec('BEGIN');
    await db.query(receiptSql,receiptArgs(uid(29),8,10));
    await reject(awardSql,[uid(1),uid(29),5],'23503');
    await db.exec('ROLLBACK');
    ok(Number((await db.query('SELECT count(*) n FROM hanq.source_full_attempts WHERE id=$1',[uid(29)])).rows[0].n),0);
    ok(Number((await db.query('SELECT xp FROM hanq.owned_digimon WHERE user_id=$1 AND equipped',[uid(1)])).rows[0].xp),1022);
    const latest=(await db.query("SELECT id FROM hanq.source_full_attempts WHERE user_id=$1 AND quiz_id='synthetic' AND source_version=$2 AND grading_version=2 AND source_revision='synthetic-r1' ORDER BY seq DESC LIMIT 5",[uid(1),'a'.repeat(64)])).rows.map(x=>x.id);
    ok(latest,[27,26,25,24,23].map(uid));
    ok(Number((await db.query('SELECT count(*) n FROM hanq.source_full_attempts')).rows[0].n),8);
    // Exercise the actual repository after older receipts have left the five-entry projection.
    // PGlite has one backend; these transaction checks cannot prove multiple-client lock scheduling.
    const { SourceAttemptRepository } = require('../../dist/src/textbook/source-attempt-repository');
    const adapt = connection => ({ query: async (sql,params) => {
      const result=await connection.query(sql,params);
      return {...result,rows:result.rows.map(row=>row.payload_hash?{...row,payload_hash:Buffer.from(row.payload_hash)}:row)};
    }});
    const repository=new SourceAttemptRepository({pool:adapt(db),tx:fn=>db.transaction(connection=>fn(adapt(connection)))});
    const replay=await repository.replay(uid(1),uid(20),Buffer.alloc(32,1));
    ok([replay.replayed,replay.attempt.id,replay.attempt.xpAward],[true,uid(20),10]);
    ok(Number((await db.query('SELECT xp FROM hanq.owned_digimon WHERE user_id=$1 AND equipped',[uid(1)])).rows[0].xp),1022);
    const completion={attemptId:uid(30),payloadHash:Buffer.alloc(32,2),scope:{quizId:'synthetic',sourceVersion:'a'.repeat(64),sourceRevision:'synthetic-r1',gradingVersion:2},correct:8,total:10};
    ok((await repository.complete(uid(1),completion)).replayed,false);
    ok((await repository.complete(uid(1),completion)).replayed,true);
    ok(Number((await db.query('SELECT xp FROM hanq.owned_digimon WHERE user_id=$1 AND equipped',[uid(1)])).rows[0].xp),1032);
    ok((await repository.list(uid(1),completion.scope)).items.map(row=>row.id),[30,27,26,25,24].map(uid));
    console.log(JSON.stringify({passed:true,checks,engine:'PGlite PostgreSQL WASM',scope:'synthetic schema/constraints; no multi-client lock validation'}));
  } finally { await db.close(); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});

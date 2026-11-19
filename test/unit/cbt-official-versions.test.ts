import test from 'node:test';
import assert from 'node:assert/strict';
import {formalCatalogSql,officialPinnedSql} from '../../src/cbt/cbt-official-versions';
import {CbtRepository} from '../../src/cbt/cbt.repository';
test('formal picker pins exactly three official hashes and excludes legacy fallback',()=>{
 const sql=formalCatalogSql('q');
 for(const id of ['exam-69-02','exam-69-04','exam-69-13'])assert.equal(sql.split(id).length-1,2);
 assert.equal((officialPinnedSql('q').match(/content_hash=/g)||[]).length,3);
 assert.ok(sql.includes('q.is_current AND q.question_id NOT IN'));
 assert.ok(!sql.includes('exam-67-04'));
});
test('single/all formal queries share exact pinned selector without changing generic repository',async()=>{
 const calls:{sql:string,args:unknown[]}[]=[];const q={query:async(sql:string,args:unknown[])=>{calls.push({sql,args});return {rows:[]};}};
 const repo=new CbtRepository();await repo.roundQuestions(q as any,69);await repo.allRoundQuestions(q as any,[67,68,69]);
 assert.equal(calls.length,2);for(const c of calls)assert.ok(c.sql.includes(formalCatalogSql('q')));
 assert.deepEqual(calls.map(c=>c.args),[[69],[[67,68,69]]]);
});

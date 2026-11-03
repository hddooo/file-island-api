import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MyRecordsService} from '../../src/attempts/my-records';
import type {DbService} from '../../src/db/db.service';

test('activity pagination counts activities, clamps to ten per page, and redacts nested evidence without changing stored answers',async()=>{
 const calls:{sql:string;args:unknown[]}[]=[];
 const stored={key:'battle:synthetic',source:'battle',detail:{battle:{opponent:'private@example.test'},evidenceRef:'private-evidence'},children:[{detail:{selected:'A',correct:true,evidenceRef:'private-child-evidence',battle:{opponent:'private@example.test'}}}]};
 const q={query:async(sql:string,args:unknown[]=[])=>{calls.push({sql,args});return sql.startsWith('SET ')?{rows:[]}:sql.includes('count(*)::text total')?{rows:[{total:'25'}]}:{rows:[structuredClone(stored)]};}};
 const db={tx:async<T>(fn:(client:unknown)=>Promise<T>)=>fn(q)} as unknown as DbService;
 const snapshot='2026-10-31T01:43:00.000Z';const page=await new MyRecordsService(db).list('synthetic-owner',{page:99,snapshot});
 assert.equal(page.total,25);assert.equal(page.pages,3);assert.equal(page.page,3);assert.equal(page.pageSize,10);assert.equal(page.timeZone,'Asia/Seoul');
 assert.match(calls[1].sql,/FROM activities WHERE/);assert.match(calls[2].sql,/LIMIT 10 OFFSET \$5/);assert.deepEqual(calls[2].args,['synthetic-owner','all','all',snapshot,20]);
 assert.equal(page.items[0].children[0].detail.selected,'A');assert.equal(page.items[0].children[0].detail.correct,true);assert.equal(page.items[0].detail.battle.opponent,'상대 미확인');assert.equal(page.items[0].children[0].detail.battle.opponent,'상대 미확인');
 assert(!JSON.stringify(page).includes('private-'));assert.equal(stored.detail.evidenceRef,'private-evidence');assert.equal(stored.children[0].detail.evidenceRef,'private-child-evidence');
});

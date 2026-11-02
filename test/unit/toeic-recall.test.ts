import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from 'class-validator';
import type { DbService } from '../../src/db/db.service';
import { RecallDto, RecallViewDto, ToeicRecallService } from '../../src/toeic-notes/toeic-recall';
const payload={noteRevision:1,revision:0,answer:'여러 의미도 허용',revealed:false,evaluation:''};
test('recall DTO validates bounded Korean input, source revision, boolean reveal and self evaluation enum',async()=>{
 assert.equal((await validate(Object.assign(new RecallDto(),payload))).length,0);
 for(const bad of [{answer:'x'.repeat(6001)},{revealed:'yes'},{revision:-1},{noteRevision:0},{evaluation:'correct'}])assert.ok((await validate(Object.assign(new RecallDto(),payload,bad))).length);
 assert.equal((await validate(Object.assign(new RecallViewDto(),{part:'3-4',batch:2}))).length,0);
 assert.ok((await validate(Object.assign(new RecallViewDto(),{part:'3',batch:-1}))).length);
});
test('no empty reveal or hidden self assessment can be stored; no equality grading is applied',async()=>{
 const db={} as DbService,service=new ToeicRecallService(db);
 await assert.rejects(()=>service.save('owner','note',{...payload,answer:' ',revealed:true}),{code:'invalid_recall'});
 await assert.rejects(()=>service.save('owner','note',{...payload,evaluation:'known'}),{code:'invalid_recall'});
});

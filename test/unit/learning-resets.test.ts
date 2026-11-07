import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validate} from 'class-validator';
import {LearningResetDto} from '../../src/profile/profile.controller';
import {requestLearningReset,assertWrongResetGeneration} from '../../src/profile/learning-resets';
import {AppError} from '../../src/common/app-error';
import type {Queryable} from '../../src/db/db.service';
test('confirmation for one island cannot reset another; no query',async()=>{
 let calls=0;const q={query:async()=>{calls++;return{rows:[]};}} as unknown as Queryable;
 await assert.rejects(requestLearningReset(q,'owner','history','RESET_TOEIC','id',()=>new Date()),(e:unknown)=>e instanceof AppError&&e.getStatus()===400);
 assert.equal(calls,0);
});
test('old queue epoch is rejected, matching reset epoch accepted',async()=>{
 const at=new Date('2026-11-07T12:00:00.000Z');
 const q={query:async()=>({rows:[{reset_at:at}]})} as unknown as Queryable;
 await assert.rejects(assertWrongResetGeneration(q,'owner','toeic',null),(e:unknown)=>e instanceof AppError&&e.code==='learning_reset_changed');
 await assertWrongResetGeneration(q,'owner','toeic',at.toISOString());
});
test('request cannot select another user',async()=>{
 const dto=Object.assign(new LearningResetDto(),{island:'history',confirmation:'RESET_HISTORY',requestId:'bf950ed7-e0ba-4c40-b154-a47ea4615e40',userId:'another-user'});
 assert.ok((await validate(dto,{whitelist:true,forbidNonWhitelisted:true})).some(e=>e.property==='userId'));
});

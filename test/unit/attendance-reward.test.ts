import assert from 'node:assert/strict';
import {test} from 'node:test';
import {attendanceStep,attendanceDay} from '../../src/portal/attendance-reward';
test('actual streak stays separate from the repeating five reward positions through days1–11',()=>{assert.deepEqual(Array.from({length:11},(_,i)=>attendanceStep(i+1).xp),[10,20,30,40,50,10,20,30,40,50,10]);assert.equal(attendanceStep(6).position,1);assert.equal(attendanceStep(10).position,5);assert.equal(attendanceStep(11).position,1);assert.throws(()=>attendanceStep(0));assert.throws(()=>attendanceStep(1.5));});
test('KST calendar strings shift across year/month boundaries without local timezone inference',()=>{assert.equal(attendanceDay('2027-01-01',-1),'2026-12-31');assert.equal(attendanceDay('2026-03-01',-1),'2026-02-28');});

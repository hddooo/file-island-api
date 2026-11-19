import 'reflect-metadata';
import test from 'node:test';
import { validateSync } from 'class-validator';
import { CreateCbtReviewDto } from '../../src/cbt/cbt-review.dto';
import { CreateCbtRunDto } from '../../src/cbt/cbt.dto';
import { CbtReviewController } from '../../src/cbt/cbt-review.controller';
import assert from 'node:assert/strict';
import { CBT_ROUNDS, CBT_ASSET_NAME, checkRound } from '../../src/cbt/cbt-policy';
import type { QuestionRow } from '../../src/questions/questions.repository';
test('rounds 67–80 support canonical question and shared image names only',()=>{
 assert.deepEqual([...CBT_ROUNDS],Array.from({length:14},(_,i)=>80-i));
 for(const round of CBT_ROUNDS)for(const name of [`${round}-01.webp`,`${round}-50.webp`,`${round}-common47-48.webp`])assert(CBT_ASSET_NAME.test(name));
 for(const name of ['66-01.webp','66-common47-48.webp','81-01.webp','80-00.webp','80-51.webp','../80-01.webp','80-01.png','67-01.webp\n'])assert(!CBT_ASSET_NAME.test(name));
});
test('round 80 still requires exactly fifty numbered questions and one hundred points',()=>{
 const rows=Array.from({length:50},(_,i)=>{const id='exam-80-'+String(i+1).padStart(2,'0');const options=Array.from({length:5},(_,k)=>id+'-option-'+(k+1));return {question_id:id,kind:'mock',exam_round:80,exam_number:i+1,points:2,option_ids:options,correct_option_id:options[0]} as QuestionRow;});
 assert(checkRound(80,rows).ok);assert(!checkRound(80,rows.slice(1)).ok);
 rows[0].points=1;assert(!checkRound(80,rows).ok);
});


import { CbtController } from '../../src/cbt/cbt.controller';
test('single-round readiness includes80 and rejects81',async()=>{ const controller=new CbtController({rounds:async(round:number)=>({round})} as never); assert.deepEqual(await controller.retryRound('80'),{round:80}); assert.throws(()=>controller.retryRound('81')); });

test('round bounds apply consistently to both routes and both body DTOs',()=>{
 const cbt=new CbtController({rounds:(round:number)=>round} as never);
 const review=new CbtReviewController({reviewMaterials:(_user:string,round:number)=>round} as never);
 const user={userId:'fixture'} as never;
 for(const round of CBT_ROUNDS){
  assert.equal(cbt.retryRound(String(round)),round);
  assert.equal(review.materials(user,String(round)),round);
  for(const Dto of [CreateCbtRunDto,CreateCbtReviewDto])assert.deepEqual(validateSync(Object.assign(new Dto(),{round,idempotencyKey:'round-test'})),[]);
 }
 for(const bad of ['66','81','067',' 67','67.0','67\n','0x43']){
  assert.throws(()=>cbt.retryRound(bad));assert.throws(()=>review.materials(user,bad));
 }
 for(const round of [66,81,67.5,'67'])for(const Dto of [CreateCbtRunDto,CreateCbtReviewDto])assert(validateSync(Object.assign(new Dto(),{round,idempotencyKey:'round-test'})).some(error=>error.property==='round'));
});

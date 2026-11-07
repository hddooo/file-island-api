import test from 'node:test';
import assert from 'node:assert/strict';
import { CBT_ROUNDS, CBT_ASSET_NAME, checkRound } from '../../src/cbt/cbt-policy';
import type { QuestionRow } from '../../src/questions/questions.repository';
test('round 80 extends existing rounds without allowing later or malformed assets',()=>{
 assert.deepEqual([...CBT_ROUNDS],[80,79,78,77,76,75,74,73,72,71,70]);
 for(const name of ['70-01.webp','79-50.webp','80-01.webp','80-50.webp'])assert(CBT_ASSET_NAME.test(name));
 for(const name of ['81-01.webp','80-00.webp','80-51.webp','../80-01.webp','80-01.png'])assert(!CBT_ASSET_NAME.test(name));
});
test('round 80 still requires exactly fifty numbered questions and one hundred points',()=>{
 const rows=Array.from({length:50},(_,i)=>{const id='exam-80-'+String(i+1).padStart(2,'0');const options=Array.from({length:5},(_,k)=>id+'-option-'+(k+1));return {question_id:id,kind:'mock',exam_round:80,exam_number:i+1,points:2,option_ids:options,correct_option_id:options[0]} as QuestionRow;});
 assert(checkRound(80,rows).ok);assert(!checkRound(80,rows.slice(1)).ok);
 rows[0].points=1;assert(!checkRound(80,rows).ok);
});


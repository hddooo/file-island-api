import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256hex } from '../../src/common/util';
import { parseCbt67To69Append } from '../../src/questions/cbt-67-69-appender';

function source() {
  return { questions: Object.fromEntries([67,68,69].flatMap(exam => Array.from({length:50},(_,i)=>{
    const number=i+1,id=`exam-${exam}-${String(number).padStart(2,'0')}`;
    const options=Array.from({length:5},(_,k)=>({id:`${id}-option-${k+1}`,text:String(k+1),correct:k===2,review:['fixture explanation']}));
    return [id,{id,exam,number,v:'0011223344556677',points:2,negative:false,answer:3,options}] as const;
  }))) };
}

test('targeted appendix uses exact identities, official ordering, and the existing private/public hash contract',()=>{
  const input=source(), output=parseCbt67To69Append(input);
  assert.equal(output.length,150);
  for(const [n,row] of output.entries()){
    assert.equal(row.examRound,67+Math.floor(n/50));assert.equal(row.examNumber,n%50+1);
    assert.equal(row.contentHash,sha256hex(JSON.stringify(input.questions[row.questionId])));
    assert.equal(row.correctOptionId,row.questionId+'-option-3');assert.equal(row.publicPayload.answer,undefined);
    assert.deepEqual((row.publicPayload.options as object[]).map(Object.keys),Array.from({length:5},()=>['id','text']));
  }
});

test('targeted appendix refuses other rounds, inconsistent grading, and incomplete imports',()=>{
  const missing=source();delete missing.questions['exam-67-01'];
  assert.throws(()=>parseCbt67To69Append(missing),{message:'source_scope'});
  missing.questions['exam-70-01']=structuredClone(missing.questions['exam-67-02']!);
  assert.throws(()=>parseCbt67To69Append(missing),{message:'source_scope'});
  const wrongAnswer=source();wrongAnswer.questions['exam-68-01']!.answer=2;
  assert.throws(()=>parseCbt67To69Append(wrongAnswer),{message:'source_item'});
  const wrongPoints=source();wrongPoints.questions['exam-69-01']!.points=1;
  assert.throws(()=>parseCbt67To69Append(wrongPoints),{message:'source_round'});
});

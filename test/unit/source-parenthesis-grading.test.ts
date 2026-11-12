import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {sourceParenthesisVectors} from '../fixtures/source-parenthesis-vectors';
import {sourceGrade, applySourceBatch, applySourceMutation, initialSourceProgress, workspaceFromLegacy, type SourceItem} from '../../src/textbook/source-blank-progress';

for(const [expected,value,correct,context] of sourceParenthesisVectors) {
 test(`parenthesis notation ${JSON.stringify([expected,value])}`,()=>{
  for(const shape of ['single','classification','parts'] as const) {
   const slot={id:context?.slotId??'slot',answerIds:[context?.answerId??'answer']};
   const item:SourceItem={id:context?.itemId??'synthetic',kind:shape==='classification'?'classification':'fill-in',verification:{status:'source-verified'},answers:[{id:slot.answerIds[0],text:expected}],answer:{text:expected,orderMatters:context?.ordered??false},blanks:shape==='parts'?[{id:'outer',answerIds:[],parts:[slot]}]:[slot],...(shape==='classification'?{responseSlots:[slot]}:{})};
   const before=JSON.stringify(item), values=[value];
   assert.equal(sourceGrade(item,values,2,context?.sourceVersion),correct);
   const initial=workspaceFromLegacy(initialSourceProgress(),1);
   const next=applySourceBatch([item],initial,{version:'fixture',revision:0,mutationId:randomUUID(),cursor:0,status:'active',updates:[{itemId:item.id,values,submitted:true}]},2,context?.sourceVersion);
   assert.deepEqual(next.responses[item.id].values,values);
   assert.equal(next.responses[item.id].correct,value.trim()?correct:null);
   if(value.trim()) {
    const legacy=applySourceMutation([item],initialSourceProgress(),{version:'fixture',revision:0,mutationId:randomUUID(),position:0,action:'answer',values},2,context?.sourceVersion);
    assert.equal(legacy.responses[0].correct,correct);assert.deepEqual(legacy.responses[0].values,values);
   }
   assert.equal(JSON.stringify(item),before);assert.deepEqual(initial.responses,{});
  }
 });
}

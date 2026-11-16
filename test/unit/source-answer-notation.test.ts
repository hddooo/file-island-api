import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {sourceGrade,sourceAnswerPolicies,applySourceBatch,applySourceMutation,initialSourceProgress,workspaceFromLegacy,type SourceItem} from '../../src/textbook/source-blank-progress';
// Synthetic fixtures: no private source files or database access.
function item(parts:string[],separate=true,kind='fill-in',orderMatters=true):SourceItem {
 const answers=parts.map((text,i)=>({id:'a'+i,text}));
 return {id:'synthetic',kind,verification:{status:'source-verified'},answers,answer:{text:parts.join(', '),orderMatters},blanks:separate?answers.map(a=>({id:'b'+a.id,answerIds:[a.id]})):[{id:'b',answerIds:answers.map(a=>a.id)}]};
}
const compound=item(['동의보감 (광해군)']),alias=item(['백운동서원 (=소수서원)']);
const cases:[SourceItem,string[],boolean][]=[];
for(const v of ['동의보감 (광해군)','동의보감/광해군','동의보감 , 광해군',' 동의보감\n/ 광해군 ','동의보감 / 광해군'.normalize('NFD')])cases.push([compound,[v],true]);
for(const v of ['동의보감','광해군','광해군/동의보감','동의보감 / 광해','동의보감,광해군,기타','동의보감,,광해군','동의보감/,광해군','동의보감 광해군','동의보감(=광해군)'])cases.push([compound,[v],false]);
for(const v of ['백운동서원 (=소수서원)','백운동서원','소수서원',' 소수 서원 ','소수서원'.normalize('NFD')])cases.push([alias,[v],true]);
for(const v of ['백운동','소수','백운동서원/소수서원','백운동서원,소수서원','백운동서원(소수서원)','소수서원,기타'])cases.push([alias,[v],false]);
cases.push([item(['동의보감 (광해군)','백운동서원 (=소수서원)']),['동의보감, 광해군','소수서원'],true]);
cases.push([item(['동의보감 (광해군)','백운동서원 (=소수서원)']),['동의보감','소수서원'],false]);
for(const [canonical,response] of [['3·1 운동','31운동'],['가/나','가,나'],['가,나','가/나'],['가(나/다)','가/나/다'],['가(=나/다)','나'],['가(나)','나']])cases.push([item([canonical]),[response],false]);
cases.push([item(['가','나'],false,'fill-in',false),['나, 가'],true],[item(['가','나'],false),['나, 가'],false],[item(['동의보감 (광해군)','기타'],false),['동의보감,광해군,기타'],false]);
cases.push([item(['①','②','③'],false,'sequence'),['1,2,3'],true],[item(['①','②','③'],false,'sequence'),['1/2/3'],false],[item(['①','②','③'],false,'sequence'),['2,1,3'],false]);
test('source notation grading and both mutation paths agree, preserving exact values and canonical source',()=>{
 for(const [q,values,correct] of cases){
  const before=JSON.stringify(q),initial=workspaceFromLegacy(initialSourceProgress(),1),initialBefore=JSON.stringify(initial);
  assert.equal(sourceGrade(q,values),correct,JSON.stringify(values));
  const batch=applySourceBatch([q],initial,{version:'fixture',revision:0,mutationId:randomUUID(),cursor:0,status:'active',updates:[{itemId:q.id,values,submitted:true,checkedSlots:values.map(()=>true)}]});
  assert.equal(batch.responses[q.id].correct,correct);assert.deepEqual(batch.responses[q.id].values,values);
  const legacy=applySourceMutation([q],initialSourceProgress(),{version:'fixture',revision:0,mutationId:randomUUID(),position:0,action:'answer',values});
  assert.equal(legacy.responses[0].correct,correct);assert.deepEqual(legacy.responses[0].values,values);
  assert.equal(JSON.stringify(q),before);assert.equal(JSON.stringify(initial),initialBefore);
 }
});
test('unsubmitted edits stay ungraded and unrelated saved records are not regraded',()=>{
 const initial=workspaceFromLegacy(initialSourceProgress(),1);initial.responses.old={values:['소수서원'],submitted:true,correct:false,checkedSlots:[true]};
 const next=applySourceBatch([alias],initial,{version:'fixture',revision:0,mutationId:randomUUID(),cursor:0,status:'active',updates:[{itemId:alias.id,values:['소수서원'],submitted:false,checkedSlots:[false]}]});
 assert.equal(next.responses[alias.id].correct,null);assert.deepEqual(next.responses.old,initial.responses.old);assert.equal(initial.responses[alias.id],undefined);
});
test('v2 single ordinary blank accepts only the exact canonical decade with optional year notation',()=>{
 for(const digits of ['660','1920','1930','1940','2000']){
  const q=item([digits+'년대']),before=JSON.stringify(q);
  for(const value of [digits,digits+'년',digits+'년도',digits+'년대',' '+digits+' 년 대 ',(digits+'년대').normalize('NFD')]){
   assert.equal(sourceGrade(q,[value],2),true,JSON.stringify({digits,value}));
   assert.equal(sourceGrade(q,[value],1),value.normalize('NFC').replace(/\s+/g,'')===digits+'년대');
  }
  for(const value of [String(Number(digits)+1),String(Number(digits)+10),digits+'년대 초',digits+'년경',digits+'년대/기타','일제 말','1930년대(일제 말)','0'+digits,'기원전'+digits,'BC'+digits])assert.equal(sourceGrade(q,[value],2),false,JSON.stringify({digits,value}));
  assert.equal(JSON.stringify(q),before);
 }
});
test('decade tolerance is directional and never converts exact years, era labels or composite canonical answers',()=>{
 for(const [canonical,value] of [
  ['1930','1930년대'],['1930년','1930년대'],['1930년도','1930년대'],['1921년','1921'],['1921년대','1921'],
  ['일제 말','1930'],['일제 말','1930년대'],['1930년대','일제 말'],['90년대','90'],['01930년대','01930'],
  ['기원전 660년대','660'],['BC 660년대','660'],['1930년대(일제 말)','1930'],['1930년대/1940년대','1930'],['1930년대 초','1930']
 ])assert.equal(sourceGrade(item([canonical]),[value],2),false,JSON.stringify({canonical,value}));
});
test('decade tolerance does not alter sequences, classifications, partitioned blanks or multiple answers and blanks',()=>{
 const classification=item(['1930년대'],true,'classification');classification.responseSlots=classification.blanks;
 const partitioned=item(['1930년대']);partitioned.blanks=[{id:'parent',answerIds:[],parts:partitioned.blanks}];
 const sequenceMetadata=item(['1930년대']);sequenceMetadata.answer.sequenceTokens=['1930년대'];
 const extraAnswer=item(['1930년대']);extraAnswer.answers.push({id:'unused',text:'기타'});
 for(const [q,values] of [
  [item(['1930년대'],true,'sequence'),['1930']],
  [classification,['1930']], [partitioned,['1930']], [sequenceMetadata,['1930']], [extraAnswer,['1930']],
  [item(['1930년대','기타'],false),['1930,기타']], [item(['1930년대','기타'],false,'fill-in',false),['기타/1930']],
  [item(['1930년대','기타']),['1930','기타']]
 ] as [SourceItem,string[]][])assert.equal(sourceGrade(q,values,2),false,JSON.stringify({q,values}));
});
test('an explicit bound answer policy takes precedence over decade tolerance',()=>{
 const q=item(['1930년대']),sourceVersion='d'.repeat(64);
 sourceAnswerPolicies.push({sourceVersion,itemId:q.id,answerId:q.answers[0].id,slotIds:[q.blanks[0].id],expectedNormalizedSHA:createHash('sha256').update('1930년대').digest('hex'),mode:'all-components',allowedTokenIndexGroups:[],ordered:true,rationale:'SYNTHETIC'});
 try {
  assert.equal(sourceGrade(q,['1930'],2,sourceVersion),false);
  assert.equal(sourceGrade(q,['1930년대'],2,sourceVersion),true);
  assert.equal(sourceGrade(q,['1930'],2,'e'.repeat(64)),true);
 } finally {sourceAnswerPolicies.pop();}
});
test('new decade submissions preserve raw values, source and unrelated saved grades in both mutation paths',()=>{
 const q=item(['1920년대']),values=['1920년도'],before=JSON.stringify(q),initial=workspaceFromLegacy(initialSourceProgress(),1);
 initial.responses.old={values:['1930'],submitted:true,correct:false,checkedSlots:[true]};
 const initialBefore=JSON.stringify(initial);
 const batch=applySourceBatch([q],initial,{version:'fixture',revision:0,mutationId:randomUUID(),cursor:0,status:'active',updates:[{itemId:q.id,values,submitted:true}]},2);
 assert.equal(batch.responses[q.id].correct,true);assert.deepEqual(batch.responses[q.id].values,values);assert.deepEqual(batch.responses.old,initial.responses.old);
 const legacy=applySourceMutation([q],initialSourceProgress(),{version:'fixture',revision:0,mutationId:randomUUID(),position:0,action:'answer',values},2);
 assert.equal(legacy.responses[0].correct,true);assert.deepEqual(legacy.responses[0].values,values);
 assert.equal(JSON.stringify(q),before);assert.equal(JSON.stringify(initial),initialBefore);
});

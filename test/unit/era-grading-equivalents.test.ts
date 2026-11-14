import 'reflect-metadata';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {test} from 'node:test';
import {sourceGrade, type SourceItem} from '../../src/textbook/source-blank-progress';

type Vector={label:string;expected:string[];value:string;correct:boolean;ordered:boolean};
const {vectors}:{vectors:Vector[]}=JSON.parse(readFileSync(resolve('test/fixtures/era-grading-equivalents.json'),'utf8'));
for(const [index,v] of vectors.entries())test(`era equivalents ${index}: ${v.label}`,()=>{
 for(const shape of ['blank','parts','classification']){
  const answers=v.expected.map((text,i)=>({id:`answer-${i}`,text}));
  const slot={id:'slot',answerIds:answers.map(a=>a.id)};
  const item:SourceItem={id:'synthetic',kind:shape==='classification'?shape:'blank',verification:{status:'source-verified'},answers,answer:{text:v.expected.join(','),orderMatters:v.ordered},blanks:shape==='parts'?[{id:'outer',answerIds:[],parts:[slot]}]:[slot],...(shape==='classification'?{responseSlots:[slot]}:{})};
  const before=JSON.stringify(item);
  assert.equal(sourceGrade(item,[v.value],2),v.correct,shape);
  assert.equal(JSON.stringify(item),before);
  // New whole-term equivalence stays out of the legacy v1 namespace.
  if(v.expected.length===1){
   const norm=(s:string)=>s.normalize('NFC').replace(/\s+/g,'');
   assert.equal(sourceGrade(item,[v.value],1),norm(v.value)===norm(v.expected[0]));
  }
 }
});

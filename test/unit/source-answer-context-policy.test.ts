import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {sourceAnswerPolicies,sourcePolicyMatches,sourceGrade,applySourceBatch,type SourceAnswerPolicy,type SourceItem} from '../../src/textbook/source-blank-progress';
const norm=(s:string)=>s.normalize('NFC').replace(/\s+/g,'');
const sha=(s:string)=>createHash('sha256').update(norm(s)).digest('hex');
const policy=(expected:string,mode:string,groups:number[][],ordered=true):SourceAnswerPolicy=>({sourceVersion:'a'.repeat(64),itemId:'synthetic',answerId:'a',slotIds:['b'],expectedNormalizedSHA:sha(expected),mode,allowedTokenIndexGroups:groups,ordered,rationale:'SYNTHETIC'});
test('inline audited profile exactly matches shared final live46 metadata',()=>{
 const bytes=readFileSync('test/fixtures/source-answer-context-policy-live81.json');
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'b58a72982f99ec2d6ffe23a0492d43f94f638abf59e21c7158ebc8c65f9f29fb');
 assert.deepEqual(sourceAnswerPolicies,JSON.parse(bytes.toString()).records);assert.equal(sourceAnswerPolicies.length,46);
});
test('policy modes retain all required tokens and reject invented omissions, duplicates and concatenations',()=>{
 for(const [expected,p,yes,no] of [
  ['Alpha(Beta)',policy('Alpha(Beta)','all-components',[[0,1]]),['Alpha/Beta','Alpha,Beta'],['Alpha','Beta','Beta/Alpha','Alpha/Beta/Extra','Alpha//Beta','Alpha/Beta/Beta','AlphaBeta']],
  ['Era(Late)(Before)',policy('Era(Late)(Before)','head',[[0],[0,1],[0,2],[0,1,2]],false),['Era','Era/Late','Era/Before','Era/Late/Before','Before,Era,Late'],['Late','Before','EraBefore','Era/Extra']],
  ['Group(A,B)',policy('Group(A,B)','collective',[[0],[1,2],[0,1,2]],false),['Group','A/B','B,A','Group/A/B'],['A','B','Group/A','GroupGroup','A/A']],
  ['(NorthSouth)Office',policy('(NorthSouth)Office','optional-prefix',[[1],[0,1]]),['Office','NorthSouth/Office','NorthSouthOffice'],['NorthSouth','OfficeNorthSouth','Office/NorthSouth','NorthSouthOffice/Extra']],
 ] as [string,SourceAnswerPolicy,string[],string[]][]){for(const value of yes)assert.equal(sourcePolicyMatches(value,expected,p),true);for(const value of no)assert.equal(sourcePolicyMatches(value,expected,p),false,JSON.stringify({expected,value}));assert.equal(sourcePolicyMatches(yes[0],expected+'Changed',p),false);}
});
test('context omissions require source, item, answer, slot, exact expected hash and order binding',()=>{
 for(const [expected,value] of [['고려(말)(조선건국직전)','고려'],['왜(일본)','일본']]){
  const p=sourceAnswerPolicies.find(p=>p.expectedNormalizedSHA===sha(expected))!;assert(p);
  const q:SourceItem={id:p.itemId,kind:'fill-in',verification:{status:'source-verified'},answers:[{id:p.answerId,text:expected}],answer:{text:expected,orderMatters:p.ordered},blanks:[{id:p.slotIds[0],answerIds:[p.answerId]}]};
  assert.equal(sourceGrade(q,[value],2,p.sourceVersion),true);assert.equal(sourceGrade(q,[value],1,p.sourceVersion),false);
  assert.equal(sourceGrade(q,[value],2),false);assert.equal(sourceGrade(q,[value],2,'f'.repeat(64)),false);
  for(const mutate of [(x:SourceItem)=>{x.id+='-other'},(x:SourceItem)=>{x.blanks[0].id+='-other'},(x:SourceItem)=>{x.answers[0].id+='-other';x.blanks[0].answerIds=[x.answers[0].id]},(x:SourceItem)=>{x.answers[0].text+='Extra'},(x:SourceItem)=>{x.answer.orderMatters=!x.answer.orderMatters}]){const altered=structuredClone(q);mutate(altered);assert.equal(sourceGrade(altered,[value],2,p.sourceVersion),false);assert.equal(sourceGrade(altered,[altered.answers[0].text],2,p.sourceVersion),true);}
 }
});
test('v2 multi-answer separators preserve v1 and sequence behavior, exact cardinality and raw storage',()=>{
 const make=(parts:string[],ordered:boolean,kind='fill-in'):SourceItem=>({id:'synthetic',kind,verification:{status:'source-verified'},answers:parts.map((text,n)=>({id:String(n),text})),answer:{text:parts.join(', '),orderMatters:ordered},blanks:[{id:'b',answerIds:parts.map((_,n)=>String(n))}]});
 const ordered=make(['Alpha','Beta'],true),unordered=make(['Alpha','Beta'],false);
 for(const [q,input,correct] of [[ordered,'Alpha/Beta',true],[ordered,'Beta/Alpha',false],[unordered,'Beta/Alpha',true],[unordered,'Beta, Alpha',true],[unordered,'Alpha',false],[unordered,'Alpha/Beta/Extra',false],[unordered,'Alpha/Alpha',false],[unordered,'Alpha//Beta',false],[unordered,'Alpha/Beta/',false],[unordered,'Alpha/Wrong',false],[make(['Alpha','1/2'],false),'Alpha/1/2',false],[make(['Alpha','1/2'],false),'Alpha,1/2',true],[make(['Alpha','Beta,Gamma'],true),'Alpha/Beta/Gamma',false],[make(['①','②'],true,'sequence'),'1/2',false],[make(['①','②'],true,'sequence'),'1,2',true]] as [SourceItem,string,boolean][]){
  assert.equal(sourceGrade(q,[input],2),correct,input);const before=JSON.stringify(q);
  const saved=applySourceBatch([q],{cursor:0,status:'active',responses:{}},{version:'fixture',gradingVersion:2,revision:0,mutationId:randomUUID(),cursor:0,status:'completed',updates:[{itemId:q.id,values:[input],submitted:true}]},2);
  assert.deepEqual(saved.responses[q.id].values,[input]);assert.equal(saved.responses[q.id].correct,correct);assert.equal(JSON.stringify(q),before);
 }
 assert.equal(sourceGrade(ordered,['Alpha/Beta'],1),false);assert.equal(sourceGrade(unordered,['Beta/Alpha'],1),false);
 assert.equal(sourceGrade(ordered,['Alpha,Beta'],1),true);assert.equal(sourceGrade(unordered,['Beta,Alpha'],1),true);
});

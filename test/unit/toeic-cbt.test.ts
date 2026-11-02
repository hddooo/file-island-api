import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from 'class-validator';
import { inspectCatalog,httpsAsset,selectParts,replaySelection } from '../../src/toeic-cbt/catalog';
import { prepareToeicCollection,type PendingManifest } from '../../src/toeic-cbt/import';
import { ToeicCheckpointDto,ToeicAnswerDto } from '../../src/toeic-cbt/dto';
import { toeicFixture } from '../helpers/toeic-fixture';
test('CBT readiness fails closed for missing key/choices/photo/audio and malformed or duplicate target lists',()=>{
 const good=toeicFixture();assert.equal(inspectCatalog(good).ready,true);
 for(const mutate of [(d:typeof good)=>{d.questions[0].photoUrl=null;},(d:typeof good)=>{d.questions[1].answerVerified=false;},(d:typeof good)=>{d.questions[2].choices=[];},(d:typeof good)=>{d.groups[0].audioVerified=false;},(d:typeof good)=>{d.questions.push(d.questions[0]);},(d:typeof good)=>{d.wrongNumbers.push(35);},(d:typeof good)=>{d.questions[3].groupId='p35-37';}]){const d=structuredClone(good);mutate(d);assert.equal(inspectCatalog(d).ready,false);}
 for(const value of [null,{},[],{questions:[]}])assert.equal(inspectCatalog(value).ready,false);
 assert.equal(httpsAsset('javascript:alert(1)'),false);assert.equal(httpsAsset('https://user:password@example.test/audio'),false);assert.equal(httpsAsset('https://s3.example.test/NFD%20path.mp3'),true);
});
test('preparation never promotes ASR, removed warning markers, existing choices or HEAD success to official verification',()=>{
 const source:PendingManifest={scope:'requesting-user-only',accountId:null,round:{id:'round-1',title:'private round'},wrongQuestionNumbers:[37],audioGroups:[{id:'35-37',questionNumbers:[35,36,37],s3Url:'https://example.test/1%E1%84%92%E1%85%AC/a.mp3',transcript:'ASR text with no warning markers'}],questions:[{number:37,part:3,groupId:'35-37',stem:'observed question',choices:[],correctOptionId:null,answerVerification:'unverified',image:null}]};
 const d=prepareToeicCollection(source);assert.equal(d.accountId,null);assert.equal(d.readiness.ready,false);assert.equal(d.content.questions[0].correctOptionId,null);assert.equal(d.content.groups[0].audioUrl,source.audioGroups[0].s3Url);assert.deepEqual(d.content.wrongNumbers,[37]);assert.deepEqual(d.content.groups[0].questionNumbers,[35,36,37]);assert.equal(d.content.groups[0].scriptStatus,'automatic-unverified');
});
test('checkpoint DTO bounds all answers and rejects injected owner fields and bad option labels',async()=>{
 const d:ToeicCheckpointDto=Object.assign(new ToeicCheckpointDto(),{revision:0,cursor:0,paused:false,answers:[Object.assign(new ToeicAnswerDto(),{position:0,optionId:null})]});assert.equal((await validate(d)).length,0);
 d.answers[0].optionId='E';assert.ok((await validate(d)).length);d.answers[0].optionId='A';Object.assign(d,{userId:'spoofed'});assert.ok((await validate(d,{whitelist:true,forbidNonWhitelisted:true})).length);
});

test('group replay expands actual printed siblings, deduplicates shared wrongs, preserves original wrong provenance, and blocks absent materials',()=>{
 const d=toeicFixture();d.wrongNumbers=[37,35,38];d.replayNumbers=[35,36,37,38,39,40];
 assert.equal(inspectCatalog(d).ready,false);
 const q=d.questions.find(q=>q.number===37)!;d.questions=d.replayNumbers.map(number=>({...structuredClone(q),number,groupId:number<=37?'p35-37':'p38-40'}));
 assert.equal(inspectCatalog(d).ready,true);assert.deepEqual(d.wrongNumbers,[37,35,38]);
 d.replayNumbers.push(40);assert.equal(inspectCatalog(d).ready,false);
});

test('RC passage siblings expand separately and verified RC can run despite pending LC',()=>{
 const d=toeicFixture();const template=structuredClone(d.questions[2]);
 d.wrongNumbers=[1,132,148];
 d.groups.push({id:'p6',questionNumbers:[131,132,133,134],audioUrl:null,audioVerified:false,script:'',scriptStatus:'verified',passage:'Verified synthetic passage',passageVerified:true},{id:'p7',questionNumbers:[147,148],audioUrl:null,audioVerified:false,script:'',scriptStatus:'verified',passage:'Synthetic double document\nSecond document',passageVerified:true});
 d.questions=[d.questions[0],...[131,132,133,134,147,148].map(number=>({...structuredClone(template),number,part:number<147?6:7,groupId:number<147?'p6':'p7',photoUrl:null,photoVerified:false}))];
 d.replayNumbers=replaySelection(d).numbers;d.groups[0].audioVerified=false;
 assert.equal(inspectCatalog(d).ready,false);
 const p6=selectParts(d,[6]);assert.equal(inspectCatalog(p6).ready,true);assert.deepEqual(p6.replayNumbers,[131,132,133,134]);assert.deepEqual(p6.wrongNumbers,[132]);
 const p7=selectParts(d,[7]);assert.equal(inspectCatalog(p7).ready,true);assert.deepEqual(p7.replayNumbers,[147,148]);
 p7.questions[0].answerVerified=false;assert.equal(inspectCatalog(p7).ready,false);
});

test('folder title, cumulative round and book TEST are independent metadata; no future records inferred',()=>{
 const d=toeicFixture();d.title='1회_지면모의고사';d.metadata={folderLabel:d.title,roundIndex:1,bookTitle:'Synthetic paper source',bookVolume:'Vol.1',testNumber:null};assert.equal(inspectCatalog(d).ready,true);assert.equal(d.metadata.testNumber,null);
 d.title='2회_흰둥이1';d.metadata={folderLabel:d.title,roundIndex:2,bookTitle:'흰둥이 3',bookVolume:null,testNumber:1};assert.equal(inspectCatalog(d).ready,true);assert.equal(d.metadata.roundIndex,2);assert.equal(d.metadata.testNumber,1);
 d.metadata.testNumber=0;assert.equal(inspectCatalog(d).ready,false);
});

test('optional tutor explanation requires summary, reading, steps, every option, traps and transfer checklist',()=>{
 const d=toeicFixture(),q=d.questions[0] as import('../../src/toeic-cbt/catalog').ToeicQuestion;q.tutorExplanation={answerReason:'Synthetic answer reason',reading:[{chunk:'Synthetic chunk',translation:'합성 해석'}],steps:['Synthetic step'],options:q.choices.map(o=>({id:o.id,explanation:'Synthetic option reason'})),traps:['Synthetic trap'],checklist:['Synthetic next check']};assert.equal(inspectCatalog(d).ready,true);
 q.tutorExplanation.options.pop();assert.equal(inspectCatalog(d).ready,false);
});

test('page identities allow repeated printed numbers while inferred keys never become official by a flag',()=>{
 const d=toeicFixture();d.questions[0].sourceIdentity={key:'unit:unknown|page:A|question:6',unit:null,page:'IMG_A.jpeg',questionNumber:6};d.questions[1].sourceIdentity={key:'unit:unknown|page:B|question:6',unit:null,page:'IMG_B.jpeg',questionNumber:6};assert.equal(inspectCatalog(d).ready,true);
 d.questions[1].sourceIdentity.key=d.questions[0].sourceIdentity.key;assert.equal(inspectCatalog(d).ready,false);d.questions[1].sourceIdentity.key='unit:unknown|page:B|question:6';
 d.questions[0].answerStatus='assistant_inferred_not_officially_verified';d.questions[0].answerVerified=true;assert.equal(inspectCatalog(d).ready,false);
});

test('unverified practice cannot bypass official answer gate with a mode flag',()=>{const d=Object.assign(toeicFixture(),{practiceMode:'provisional-self-study'});d.questions[0].answerVerified=false;d.questions[0].answerStatus='assistant_inferred_not_officially_verified';assert.equal(inspectCatalog(d).ready,false);});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {projectOpeningHistory81} from '../../src/textbook/opening-history81-quiz';
import {OPENING_HISTORY81_MAPPING} from '../../src/textbook/opening-history81.mapping';
import {sourceSlots,sourceGrade} from '../../src/textbook/source-blank-progress';

// Private immutable input stays outside Git. Opt-in actual-source regression, never a public fixture.
test('opening actual pinned source: 118 grades, exact source segments, ordered pair and annotated sequences',{
 skip:!process.env.HANQ_OPENING_TEST_BUNDLE,
},()=>{
 const bundle=JSON.parse(readFileSync(process.env.HANQ_OPENING_TEST_BUNDLE!,'utf8')),quiz=projectOpeningHistory81(bundle);
 const clean=(s:string)=>s.replace(/<br\s*\/?>/gi,' ').replace(/<\/?(?:u|strong|em|span)(?:\s+[^>]*)?>/gi,'').replace(/\*\*/g,'').replace(/\u3000/g,' ');
 const source=Buffer.from(bundle.markdown);
 assert.equal(quiz.items.length,118);assert.equal(quiz.items.reduce((n,i)=>n+sourceSlots(i).length,0),119);
 for(const [index,item] of quiz.items.entries()){
  const values=sourceSlots(item).map(slot=>slot.answerIds.map(id=>item.answers.find(a=>a.id===id)!.text).join(item.kind==='sequence'?'→':', '));
  assert(sourceGrade(item,values),item.id);assert(!sourceGrade(item,values.map(()=> 'incorrect')),item.id);
  const view=item as typeof item & {text:string;originalNumberLabel:string;segments:{type:string;text:string;placeholder:string}[]};
  assert(!/<[^>]+>/.test(view.text+item.answer.text),item.id);
  const r=OPENING_HISTORY81_MAPPING[index],end=Math.max(r.prompt.end,...r.fields.map(f=>f.blank.end),'combinedBlank' in r?r.combinedBlank.end:0);
  assert.equal(view.originalNumberLabel+view.segments.map(s=>s.type==='blank'?clean(s.placeholder):s.text).join(''),clean(source.subarray(r.prompt.start,end).toString('utf8')),item.id);
  if(item.kind==='sequence'){assert(!sourceGrade(item,[item.answers.map(a=>a.text).reverse().join('→')]));if(item.answer.sequenceTokens)assert(sourceGrade(item,[item.answer.text]));}
 }
 const pair=quiz.items.find(i=>i.id.endsWith('opening-heungseon-11'))!;
 assert.equal(sourceSlots(pair).length,2);assert(!sourceGrade(pair,['한성근','양헌수']));
 assert(sourceGrade(quiz.items.find(i=>i.id.endsWith('opening-policy-17'))!,['장어영, 무위영']));
 assert.throws(()=>projectOpeningHistory81({...bundle,markdown:bundle.markdown+' '}),{code:'source_quiz_unavailable'});
 const rows=OPENING_HISTORY81_MAPPING;
 assert.throws(()=>projectOpeningHistory81(bundle,[{...rows[0],answer:{...rows[0].answer,sha256:'0'.repeat(64)}},...rows.slice(1)]),{code:'source_quiz_unavailable'});
});

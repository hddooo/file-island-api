import {createHash,randomInt} from 'node:crypto';
import type {Queryable} from '../db/db.service';
import {AppError} from '../common/app-error';
import type {BattleQuestion,Choice} from './rules';
function shuffle<T>(a:T[]){for(let i=a.length-1;i>0;i--){const j=randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
function pack(key:string,version:string,prompt:string,choices:Choice[],answer:string,explanation:string):BattleQuestion|null {
 if(!prompt||prompt.length>1000||choices.length<2||choices.length>6||choices.some(c=>!c.text||c.text.length>220)||!choices.some(c=>c.id===answer))return null;
 const mixed=shuffle(choices.map(c=>({...c}))),correct=String.fromCharCode(65+mixed.findIndex(c=>c.id===answer));return{key,version,prompt,choices:mixed.map((c,i)=>({id:String.fromCharCode(65+i),text:c.text})),answer:correct,explanation};
}
const vocabulary=[['tow','견인하다','예약하다','상승하다','축하하다'],['lamppost','가로등 기둥','지하철 노선','건물 설계도','교통 정체'],['cupboard','찬장·수납장','주차장','급수대','계산서'],['durable','내구성이 좋은','복잡한','일시적인','공석인'],['blueprint','설계도','송장','급여','전단'],['sufficient','충분한','모호한','고장 난','불필요한'],['reluctantly','마지못해','즉시','분명히','정기적으로'],['mitigate','완화하다','연기하다','운송하다','등록하다'],['vulnerable','취약한','설득력 있는','엄격한','널리 알려진'],['adjacent','인접한','연례의','유효한','의도적인'],['postpone','연기하다','기부하다','견인하다','조립하다'],['reimburse','상환·변제하다','모집하다','작동하다','개조하다']];
export async function questions(q:Queryable,subject:string):Promise<BattleQuestion[]> {
 const bank:BattleQuestion[]=[];
 if(subject==='history'){
  const rows=(await q.query<{question_id:string;version:string;public_payload:{prompt?:string;ask?:string;q?:string;options?:Choice[]};correct_option_id:string;review_payload:{why?:string;cue?:string;options?:{text?:string;review?:string[]}[]}}>('SELECT question_id,version,public_payload,correct_option_id,review_payload FROM hanq.question_versions WHERE is_current AND kind=$1 ORDER BY question_id',['quiz'])).rows;
  for(const r of rows){const p=r.public_payload,prompt=[p.prompt,p.ask,p.q].filter(x=>typeof x==='string'&&x.trim()).filter((x,i,a)=>a.indexOf(x)===i).join('\n');const item=pack(r.question_id,r.version,prompt,p.options||[],r.correct_option_id,[r.review_payload?.why,r.review_payload?.cue,...(r.review_payload?.options||[]).map(o=>o.text&&o.review?.length?o.text+' — '+o.review.join(' / '):'')].filter(Boolean).join('\n'));if(item)bank.push(item);}
 }else{
  for(const [word,meaning,...wrong]of vocabulary){const item=pack('battle-vocab-'+word,'authored-v1','“'+word+'”의 뜻으로 알맞은 것은?', [meaning,...wrong].map((text,i)=>({id:String(i),text})),'0',word+' → '+meaning+' · 전투용 학습 어휘');if(item)bank.push(item);}
  const rows=(await q.query<{id:string;version:string;content:{questions:{part:number;number:number;stem:string;answerVerified:boolean;correctOptionId:string;choices:Choice[];explanation?:string;answerStatus?:string}[]}}>('SELECT DISTINCT ON(source_key) id,version,content FROM hanq.toeic_cbt_collections WHERE user_id=(SELECT owner_id FROM hanq.toeic_member_notebook WHERE singleton=true) ORDER BY source_key,created_at DESC,id DESC')).rows;
  for(const r of rows)for(const x of r.content.questions){if(x.part!==5||!x.answerVerified||x.answerStatus||!x.stem||x.stem.length>280)continue;const item=pack(r.id+':'+x.number,r.version,x.stem,x.choices,x.correctOptionId,x.explanation||'서버에 저장된 해당 버전의 정답으로 판정했습니다.');if(item)bank.push(item);}
 }
 if(bank.length<2)throw new AppError(503,'battle_questions_unavailable','대결에 사용할 짧은 문제를 아직 준비하지 못했어요.');
 return shuffle(bank).map(x=>({...x,version:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
}

import type {Bundle,BattleItem} from './rules';
import {audioInfo} from './audio';
export async function bundles(q:Queryable,subject:string,limit=Number.MAX_SAFE_INTEGER):Promise<Bundle[]> {
 if(subject==='history'){
  const short:Bundle[]=(await questions(q,subject)).map(x=>({key:x.key,version:x.version,part:0,prompt:x.prompt,passage:null,items:[{id:'1',number:1,prompt:x.prompt,choices:x.choices,answer:x.answer,explanation:x.explanation}],durationMs:30_000,audio:null,images:[]}));
  const rows=(await q.query<{question_id:string;version:string;public_payload:{image?:string;commonImage?:string;exam?:number;number?:number;options?:Choice[]};correct_option_id:string;review_payload:{overview?:{reason?:string[];clue?:string[]};legacy?:{why?:string;remember?:string}}}>("SELECT question_id,version,public_payload,correct_option_id,review_payload FROM hanq.question_versions WHERE is_current AND kind=$1 ORDER BY question_id",['mock'])).rows;
  const exams:Bundle[]=[];
  for(const r of rows){const p=r.public_payload,choices=p.options||[],images=[p.commonImage,p.image].filter((x):x is string=>!!x);if(!p.image||!images.every(x=>/^media\/exam(?:-expanded)?\/\d{2}-(?:\d{2}|common\d{2}-\d{2})\.webp$/.test(x))||choices.length!==5||!choices.some(c=>c.id===r.correct_option_id))continue;
   const prompt='실전 모의고사 · 제'+p.exam+'회 '+p.number+'번',explanation=[...(r.review_payload.overview?.reason||[]),...(r.review_payload.overview?.clue||[]),r.review_payload.legacy?.why,r.review_payload.legacy?.remember].filter(Boolean).join('\n');
   exams.push({key:r.question_id,version:r.version,part:0,prompt,passage:null,items:[{id:'1',number:p.number||1,prompt,choices:choices.map(c=>({...c})),answer:r.correct_option_id,explanation:explanation||'저장된 해당 버전의 공식 정답 기준입니다.'}],durationMs:30_000,audio:null,images});
  }
  // Alternate shuffled families so the large short-question bank cannot bury the mock exams.
  shuffle(exams);const first=randomInt(2)===0?[short,exams]:[exams,short],mixed:Bundle[]=[];for(let i=0;i<Math.max(short.length,exams.length);i++)for(const group of first)if(group[i])mixed.push(group[i]);return mixed.slice(0,limit);
 }
 const bank:Bundle[]=[];
 const rows=(await q.query<{id:string;version:string;content:{groups:{id:string;script?:string;scriptStatus?:string;questionNumbers:number[];audioUrl?:string;passage?:string}[];questions:{part:number;number:number;groupId:string;stem?:string;answerVerified:boolean;correctOptionId:string;choices:Choice[];explanation?:string;answerStatus?:string;photoUrl?:string}[]}}>('SELECT DISTINCT ON(source_key) id,version,content FROM hanq.toeic_cbt_collections WHERE user_id=(SELECT owner_id FROM hanq.toeic_member_notebook WHERE singleton=true) ORDER BY source_key,created_at DESC,id DESC')).rows;
 for(const c of rows)for(const g of c.content.groups){const members=c.content.questions.filter(x=>x.groupId===g.id).sort((a,b)=>a.number-b.number);if(!members.length)continue;const batches=members[0].part===5?members.map(x=>[x]):[members];for(const qs of batches){const part=qs[0].part;if(qs.some(x=>!x.answerVerified||x.answerStatus||x.part!==part)||part!==5&&g.questionNumbers.some(n=>!qs.some(x=>x.number===n)))continue;const info=part<=4&&g.audioUrl?audioInfo(g.audioUrl):null;if(part<=4&&!info||part>=6&&!g.passage)continue;const items:BattleItem[]=qs.map(x=>({id:String(x.number),number:x.number,prompt:part<=2?'원문 '+x.number+'번':x.stem||'원문 '+x.number+'번',choices:x.choices.map(o=>({id:o.id,text:part<=2?o.id:o.text})),answer:x.correctOptionId,explanation:x.explanation||'저장된 해당 버전의 정답 기준입니다.'}));if(items.some(x=>!x.choices.some(o=>o.id===x.answer)))continue;const images=[...new Set(qs.filter(x=>x.photoUrl?.startsWith('private-image:')).map(x=>'/collections/'+c.id+'/images/'+x.photoUrl!.slice(14)))];bank.push({script:g.script,scriptStatus:g.scriptStatus,key:c.id+':'+g.id+':'+items[0].id,version:c.version,part,prompt:'TOEIC Part '+part+' · 원문 '+items.map(x=>x.number).join('·')+'번',passage:part>=6?g.passage!:null,items,durationMs:part<=4?Math.ceil(info!.seconds*1000)+5000:items.length*(part===7?50000:30000),audio:info?{url:g.audioUrl!,...info}:null,images});}}
 // Include vocabulary, while retaining complete shared passages/audio groups for every TOEIC part.
 for(const [word,meaning,...wrong]of vocabulary){const p=pack('battle-vocab-'+word,'authored-v1','“'+word+'”의 뜻으로 알맞은 것은?',[meaning,...wrong].map((text,i)=>({id:String(i),text})),'0',word+' → '+meaning+' · 전투용 학습 어휘')!;bank.push({key:p.key,version:p.version,part:5,prompt:'어휘 · '+word,passage:null,items:[{id:'vocab',number:1,prompt:p.prompt,choices:p.choices,answer:p.answer,explanation:p.explanation}],durationMs:30000,audio:null,images:[]});}
 if(bank.length<2)throw new AppError(503,'battle_questions_unavailable','대결 자료를 준비하지 못했어요.');
 return shuffle(bank).slice(0,limit);
}

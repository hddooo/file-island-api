import { createHash } from 'node:crypto';
import { AppError } from '../common/app-error';
import { HISTORY81_PDF, quizDigest, type Quiz81 } from './history81-quiz';
import { OPENING_SCRIPT_PIN } from './opening-script.pin';
import { OPENING_HISTORY81_MAPPING } from './opening-history81.mapping';
import { sourceSlots, type SourceItem } from './source-blank-progress';

type Range = {start:number;end:number;sha256:string};
type Recipe = {id:string;group:string;topic:string;number:number;page:number;title:Range;prompt:Range;answer:Range;fields:readonly {id:string;blank:Range}[];options:readonly Range[];combinedBlank?:Range};
type Bundle = {source:{sha256:string};markdown:string};
type Obj = Record<string,unknown>;
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const ensure:(condition:unknown)=>asserts condition=condition=>{if(!condition)throw Error('invalid_projection');};
const inline=(text:string)=>text.replace(/<br\s*\/?>/gi,' ').replace(/<\/?(?:u|strong|em|span)(?:\s+[^>]*)?>/gi,'').replace(/\*\*/g,'').replace(/\u3000/g,' ');
const plain=(text:string)=>inline(text).trim();

/** Separate projection leaves all previously deployed era bytes and versions untouched. */
export function projectOpeningHistory81(bundle:Bundle,recipes:readonly Recipe[]=OPENING_HISTORY81_MAPPING):Quiz81 {
 try {
  const bytes=Buffer.from(bundle.markdown);
  ensure(bundle.source.sha256===OPENING_SCRIPT_PIN.sourceSha256&&bytes.length===OPENING_SCRIPT_PIN.sourceBytes&&hash(bytes)===bundle.source.sha256);
  function read(r:Range){ensure(Number.isInteger(r.start)&&Number.isInteger(r.end)&&r.start>=0&&r.end>r.start&&r.end<=bytes.length);const b=bytes.subarray(r.start,r.end);ensure(hash(b)===r.sha256);return new TextDecoder('utf-8',{fatal:true}).decode(b);}
  const groups:{fieldId:string;itemId:string;slotIds:string[]}[]=[];
  const items=recipes.map((r,index)=>{
   const id='81-2026:opening:'+r.id,sourceMarkdown=read(r.prompt),answerMarkdown=read(r.answer),answerText=plain(answerMarkdown),options=r.options.map(read);
   ensure(answerText.length>0&&r.fields.length>=1&&r.fields.length<=2);
   read(r.title);if(r.combinedBlank)read(r.combinedBlank);
   const events=options.map(s=>/^\s*(?:-\s*)?([①-⑳])\s+(.+?)\s*$/.exec(s)).map(m=>{ensure(m);return {label:m[1],text:plain(m[2]),sourceText:m[1]+' '+plain(m[2])};});
   const sequence=events.length>0,tokens=sequence?[...answerText.matchAll(/([①-⑳])(\([^()]*\))?/g)].map((t,i)=>({order:i+1,label:t[1],annotation:t[2]||'',text:t[0]})):[];
   if(sequence){ensure(r.fields.length===1&&tokens.length===events.length);ensure(new Set(tokens.map(t=>t.label)).size===events.length&&tokens.every(t=>events.some(e=>e.label===t.label)));ensure(answerText.replace(/\s/g,'')===tokens.map(t=>t.text).join('→').replace(/\s/g,''));}
   const values=sequence?tokens.map(t=>t.label):answerText.split(',').map(s=>s.trim());
   ensure(values.every(Boolean));if(r.fields.length===2)ensure(values.length===2);
   const answers=values.map((text,i)=>({id:id+':a'+(i+1),text}));
   const blanks:Obj[]=[],segments:Obj[]=[],end=Math.max(r.prompt.end,r.combinedBlank?.end||0,...r.fields.map(f=>f.blank.end));
   const features:string[]=[],labelMatch=/^\((\d+)\)/.exec(sourceMarkdown),label=labelMatch?labelMatch[0]:'';
   if(!label)features.push('unnumbered-source-item');
   if(sequence&&tokens.some(t=>t.annotation))features.push('annotated-source-sequence');
   const originalBlank=r.combinedBlank||r.fields[0].blank,raw=read(originalBlank);
   r.fields.forEach(field=>read(field.blank));
   let blankStart=originalBlank.start,blankEnd=originalBlank.end;
   if(/^\s+$/.test(raw)){ensure(bytes[blankStart-1]===40&&bytes[blankEnd]===41);blankStart--;blankEnd++;}
   else {ensure(raw.trim().startsWith('(')&&raw.trim().endsWith(')'));blankEnd-=Buffer.byteLength(raw.slice(raw.trimEnd().length));}
   const placeholder=inline(bytes.subarray(blankStart,blankEnd).toString('utf8')),blankId=id+':blank',answerIds=answers.map(a=>a.id),blank:Obj={id:blankId,placeholder,answerIds};
   ensure(blankStart>=r.prompt.start&&blankEnd<=end);
   if(r.fields.length===2){
    ensure(r.combinedBlank);const spaces=placeholder.slice(1,-1).split(',');ensure(spaces.length===2&&spaces.every(s=>/^ +$/.test(s)));
    features.push('partitioned-source-blank');blank.partSeparator=',';
    blank.parts=r.fields.map((field,i)=>{const slotId=blankId+':part'+(i+1);groups.push({fieldId:field.id,itemId:id,slotIds:[slotId]});return {id:slotId,order:i+1,placeholder:spaces[i],answerIds:[answers[i].id]};});
   }else {ensure(/^\( +\)$/.test(placeholder));groups.push({fieldId:r.fields[0].id,itemId:id,slotIds:[blankId]});}
   blanks.push(blank);
   segments.push({type:'text',text:inline(bytes.subarray(r.prompt.start,blankStart).toString('utf8')).replace(/^\(\d+\)/,'')},{type:'blank',id:blankId,placeholder,answerIds},{type:'text',text:inline(bytes.subarray(blankEnd,end).toString('utf8'))});
   const answer:Obj={text:answerText,sourceText:label+answerText,sourceMarkdown:answerMarkdown,parts:values,orderMatters:sequence||r.fields.length===2||values.length===1};
   if(sequence){answer.sequenceSeparator='→';if(tokens.some(t=>t.annotation)){answer.sequenceTokens=tokens;answer.responseText=values.join('→');}}
   const printed=plain(bytes.subarray(r.prompt.start,end).toString('utf8'));
   const item:Obj={id,order:index+1,originalNumber:label?r.number:null,originalNumberLabel:label,...(!label?{originalNumberPresent:false,sourceOrdinal:index+1}:{}),pdfPage:r.page,printedPage:r.page-7,subtopicId:r.topic,reviewGroupId:r.group,text:printed.replace(/^\(\d+\)\s*/,''),sourceText:printed+events.map(e=>e.sourceText).join(''),sourceMarkdown,optionsMarkdown:options.join('\n'),verification:{status:'source-verified',textVerified:true,answerPairVerified:true},kind:sequence?'sequence':'fill-in',answer,answers,blanks,segments,requiredRendererFeatures:features};
   if(sequence)item.events=events;
   return item as SourceItem & Obj;
  });
  ensure(items.length===118&&groups.length===119&&new Set(items.map(i=>i.id)).size===118&&new Set(groups.map(g=>g.fieldId)).size===119);
  ensure(items.filter(i=>i.kind==='sequence').length===4&&items.reduce((n,i)=>n+sourceSlots(i).length,0)===119);
  ensure(groups.every(g=>g.slotIds.every(id=>sourceSlots(items.find(i=>i.id===g.itemId)!).some(s=>s.id===id))));
  const pages=[...new Set(recipes.map(r=>r.page))],source={edition:'81-2026',sha256:HISTORY81_PDF,pdfSha256:HISTORY81_PDF,scriptSha256:bundle.source.sha256,pdfPages:pages,printedPages:pages.map(p=>p-7)};
  const titles:Record<string,string>={heungseon:'흥선 대원군','opening-policy':'개항과 개화 정책',sovereignty:'일본의 침략과 국권 수호 운동',culture:'개화기 문화'};
  return {schemaVersion:'hanq-source-quiz/1',id:'opening',title:'개화기 81회 빈칸 퀴즈',source,subtopics:[...new Set(recipes.map(r=>r.topic))].map(id=>({id,title:titles[id]})),requiredRendererFeatures:[...new Set(items.flatMap(i=>i.requiredRendererFeatures as string[]))],items,scriptResponseGroups:groups,version:quizDigest({schema:'hanq-source-quiz/1',source,items})};
 }catch{throw new AppError(503,'source_quiz_unavailable','Private source quiz is unavailable');}
}

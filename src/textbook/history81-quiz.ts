import { createHash } from 'node:crypto';
import { AppError } from '../common/app-error';
import { HISTORY81_MAPPING } from './history81.mapping';
import { sourceSlots, type SourceItem } from './source-blank-progress';

export const HISTORY81_PDF = 'd54c1aa5d5816eeb73a2e82da0ec699555c2cbf1e7cb717a3b84420ed18296de';
export type Era81 = 'joseon' | 'goryeo';
type Range = { segment?: string; start: number; end: number; sha256: string };
type Recipe = { id: string; group: string; number: number; page: number; prompt: Range; answer: Range; fields: readonly {id: string; prompt?: Range}[]; options: readonly Range[] };
type Bundle = {source: {sha256: string}; segments: {id: string; markdown: string}[]};
type Obj = Record<string, unknown>;
export type Quiz81 = {schemaVersion: string; source: Obj; items: SourceItem[]; version: string; [key: string]: unknown};
export const quizDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const ensure: (condition: unknown) => asserts condition = condition => {if (!condition) throw new Error('invalid_projection');};
const plain = (s: string) => s.replace(/<\/?u>/g, '').replace(/\*\*/g, '').replace(/\u3000/g, ' ').trim();
// Commas inside printed explanatory parentheses are not extra answers.
function parts(s: string): string[] {let depth=0,start=0;const result:string[]=[];for(let i=0;i<s.length;i++){if(s[i]==='(')depth++;if(s[i]===')')depth--;if(s[i]===','&&depth===0){result.push(s.slice(start,i).trim());start=i+1;}}result.push(s.slice(start).trim());return result;}

/** Pure projection. All text comes from the already verified immutable private bundle. */
export function projectHistory81(era: Era81, bundle: Bundle, recipes: readonly Recipe[] = HISTORY81_MAPPING[era]): Quiz81 {
 try {
  const whole=Buffer.from(bundle.segments.map(s=>s.markdown).join('\n'));
  function read(r: Range) {const b=r.segment?Buffer.from(bundle.segments.find(s=>s.id===r.segment)!.markdown):whole;ensure(Number.isInteger(r.start)&&Number.isInteger(r.end)&&r.start>=0&&r.end>r.start&&r.end<=b.length);const value=b.subarray(r.start,r.end);ensure(hash(value)===r.sha256);return new TextDecoder('utf-8',{fatal:true}).decode(value);}
  const groups: {fieldId:string;itemId:string;slotIds:string[]}[]=[], topics=[...new Set(recipes.map(r=>r.group))];
  const items=recipes.map((r,index)=>{
   const id=`81-2026:${era}:${r.id}`,label=`(${r.number})`,sourceMarkdown=read(r.prompt),printed=plain(sourceMarkdown),answerText=plain(read(r.answer));
   ensure(printed.startsWith(label+' ')&&answerText.length>0);
   const text=printed.slice(label.length).trimStart(),options=r.options.map(read),events=options.map(s=>/^\s*-\s*([①-⑳]) (.+?)\s*$/.exec(s)).filter(m=>m!==null).map(m=>({label:m[1],text:plain(m[2]),sourceText:m[1]+' '+plain(m[2])}));
   const features:string[]=[],answers:{id:string;text:string}[]=[],blanks:Obj[]=[],segments:Obj[]=[];
   const answer:Obj={text:answerText,orderMatters:true,sourceText:label+' '+answerText};
   const item:Obj={id,order:index+1,originalNumber:r.number,originalNumberLabel:label,pdfPage:r.page,printedPage:r.page-7,subtopicId:r.group,text,sourceText:printed,sourceMarkdown,optionsMarkdown:options.join('\n'),verification:{status:'source-verified',textVerified:true,answerPairVerified:true},answer,answers,blanks,segments,requiredRendererFeatures:features};
   function refs(values:string[]){return values.map(value=>{ensure(value.length>0);const a={id:id+':a'+(answers.length+1),text:value};answers.push(a);return a.id;});}
   if(r.fields.length>1){
    ensure(r.fields.length===4&&events.length===5);features.push('classification-response-groups');item.kind='classification';segments.push({type:'text',text});
    const answerGroups=answerText.split('/').map(s=>parts(s.trim()));ensure(answerGroups.length===r.fields.length);
    const subitems:Obj[]=[],slots:Obj[]=[],ags:Obj[]=[];
    r.fields.forEach((field,i)=>{ensure(field.prompt);const sourceText=plain(read(field.prompt)),m=/^(\(\d+\)-\d+)\s+(.+?:)\s*$/.exec(sourceText);ensure(m);const values=answerGroups[i],ids=refs(values),slotId=id+':slot'+(i+1),subId=id+':sub'+(i+1),groupText=values.join(', ');
     subitems.push({id:subId,order:i+1,originalNumberLabel:m[1],text:m[2],sourceText,responseSlotId:slotId});slots.push({id:slotId,order:i+1,kind:'colon-response',sourcePrintedBlank:false,sourceAnchor:':',answerIds:ids,answer:{text:groupText,parts:values,orderMatters:false}});ags.push({order:i+1,subitemId:subId,responseSlotId:slotId,text:groupText,parts:values,answerIds:ids});groups.push({fieldId:field.id,itemId:id,slotIds:[slotId]});
    });
    item.subitems=subitems;item.responseSlots=slots;item.choices=events;item.choicesLabel=plain(options[0]);item.choicesLabelSourceText=plain(options[0]);item.sourceText=printed+subitems.map(s=>s.sourceText).join('')+item.choicesLabelSourceText+events.map(e=>e.sourceText).join('');answer.groups=ags;answer.groupSeparator='/';
   }else{
    ensure(r.fields.length===1);const matches=[...text.matchAll(/\( +(?:, +)*\)/g)];ensure(matches.length===1);const m=matches[0],placeholder=m[0],blankId=id+':blank',splitCount=placeholder.slice(1,-1).split(',').length;
    item.kind=events.length?'sequence':'fill-in';let values:string[],tokens:{order:number;label:string;annotation:string;text:string}[]=[];
    if(events.length){tokens=[...answerText.matchAll(/([①-⑳])(\([^()]*\))?/g)].map((t,i)=>({order:i+1,label:t[1],annotation:t[2]||'',text:t[0]}));ensure(tokens.length===events.length);values=tokens.map(t=>t.label);const separator=answerText.includes('→')?'→':'';answer.sequenceSeparator=separator;item.events=events;item.sourceText=printed+events.map(e=>e.sourceText).join('');
     if(tokens.some(t=>t.annotation)){features.push('annotated-source-sequence');answer.sequenceTokens=tokens;answer.responseText=values.join(separator);}
     ensure(answerText.replace(/\s/g,'')===tokens.map(t=>t.text).join(separator));
    }else if(splitCount>1){values=answerText.split('/').map(s=>s.trim());ensure(values.length===splitCount);features.push('partitioned-source-blank');answer.sourceSeparator='/';}
    else {values=parts(answerText);answer.orderMatters=values.length===1;}
    const ids=refs(values),blank:Obj={id:blankId,placeholder,answerIds:ids};blanks.push(blank);
    if(splitCount>1){const ws=placeholder.slice(1,-1).split(',');blank.partSeparator=',';blank.parts=ids.map((aid,i)=>({id:blankId+':part'+(i+1),order:i+1,placeholder:ws[i],answerIds:[aid]}));groups.push({fieldId:r.fields[0].id,itemId:id,slotIds:ids.map((_,i)=>blankId+':part'+(i+1))});}
    else groups.push({fieldId:r.fields[0].id,itemId:id,slotIds:[blankId]});
    segments.push({type:'text',text:text.slice(0,m.index)},{type:'blank',id:blankId,placeholder,answerIds:ids},{type:'text',text:text.slice(m.index!+placeholder.length)});
   }
   answer.parts=answers.map(a=>a.text);return item as SourceItem & Obj;
  });
  ensure(new Set(items.map(i=>i.id)).size===items.length&&new Set(groups.map(g=>g.fieldId)).size===groups.length);
  ensure(groups.every(g=>g.slotIds.every(id=>sourceSlots(items.find(i=>i.id===g.itemId)!).some(s=>s.id===id))));
  const pages=[...new Set(recipes.map(r=>r.page))],source={edition:'81-2026',sha256:HISTORY81_PDF,pdfSha256:HISTORY81_PDF,scriptSha256:bundle.source.sha256,pdfPages:pages,printedPages:pages.map(p=>p-7)};
  const titles:Record<string,string>=era==='joseon'?{'group-0':'조선 전기','group-1':'조선 후기','group-2':'정치 기구','group-3':'사회·외교','group-4':'사회 비교','group-5':'경제 비교','group-6':'문화'}:{early:'고려 전기',aristocratic:'문벌 귀족',military:'무신 정권',yuan:'원 간섭기',late:'고려 말',invasions:'대외 관계','society-economy':'사회·경제',culture:'문화'};
  return {schemaVersion:'hanq-source-quiz/1',id:era,title:era==='joseon'?'조선 81회 빈칸 퀴즈':'고려 81회 빈칸 퀴즈',source,subtopics:topics.map(id=>({id,title:titles[id]||id})),requiredRendererFeatures:[...new Set(items.flatMap(i=>(i.requiredRendererFeatures as string[])||[]))],items,scriptResponseGroups:groups,version:quizDigest({schema:'hanq-source-quiz/1',source,items})};
 }catch{throw new AppError(503,'source_quiz_unavailable','Private source quiz is unavailable');}
}

/** Actual source versions are private imports, never shipped as common seed or inferred from vocabulary. */
export interface ToeicWordTime {text:string;start:number;end:number;}
export interface ToeicTiming {sourceText:string;words:ToeicWordTime[];sourceHash?:string;}
export interface ToeicGroup {id:string;questionNumbers:number[];audioUrl:string|null;audioVerified:boolean;script:string;scriptStatus:'automatic-unverified'|'verified'|'publisher-extracted';timing?:ToeicTiming;passage?:string;passageVerified?:boolean;}
export interface ToeicCheckQuestion {id:string;prompt:string;options:{id:string;text:string}[];correctOptionId:string;explanation:string;}
export interface ToeicTutorExplanation {translation?:string;checkQuestions?:ToeicCheckQuestion[];answerReason:string;reading:{chunk:string;translation:string}[];steps:string[];options:{id:string;explanation:string}[];traps:string[];checklist:string[];}
export interface ToeicSourceIdentity {key:string;unit:string|null;page:string;questionNumber:number;}
export interface ToeicQuestion {audioOnly?:boolean;answerProvenance?:'user-entered-admin-reviewed';sourceIdentity?:ToeicSourceIdentity;answerStatus?:'assistant_inferred_not_officially_verified';tutorExplanation?:ToeicTutorExplanation;number:number;part:number;groupId:string;stem:string|null;questionVerified:boolean;choices:{id:string;text:string}[];choicesVerified:boolean;correctOptionId:string|null;answerVerified:boolean;photoUrl:string|null;photoVerified:boolean;explanation:string|null;}
export interface ToeicSourceMetadata {folderLabel:string;roundIndex:number;bookTitle:string;bookVolume:string|null;testNumber:number|null;}
export interface ToeicCollection {coverage?:{excludedQuestionNumbers:number[];exclusionReason:'user-excluded-correct-range';explanationsPending:number};metadata?:ToeicSourceMetadata;roundKey:string;title:string;wrongNumbers:number[];replayNumbers?:number[];groups:ToeicGroup[];questions:ToeicQuestion[];}
export const privateImage=(v:unknown):v is string=>typeof v==='string'&&/^private-image:[a-f0-9]{64}$/.test(v);
export const privateAudio=(v:unknown):v is string=>typeof v==='string'&&/^private-audio:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export const imageAsset=(v:unknown)=>httpsAsset(v)||privateImage(v);
export const httpsAsset=(v:unknown):v is string=>{if(typeof v!=='string'||v.length>4096)return false;try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash;}catch{return false;}};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function inspectCatalog(value:unknown){
 const invalid={ready:false,total:0,missing:[{number:null as number|null,reasons:['invalid_catalog']}]};
 if(!obj(value)||typeof value.roundKey!=='string'||typeof value.title!=='string'||!Array.isArray(value.questions)||!Array.isArray(value.groups)||!Array.isArray(value.wrongNumbers))return invalid;
 const d=value as unknown as ToeicCollection;
 if(d.metadata&&(!obj(d.metadata)||typeof d.metadata.folderLabel!=='string'||!d.metadata.folderLabel.trim()||!Number.isInteger(d.metadata.roundIndex)||d.metadata.roundIndex<1||typeof d.metadata.bookTitle!=='string'||!(d.metadata.bookVolume===null||typeof d.metadata.bookVolume==='string')||!(d.metadata.testNumber===null||Number.isInteger(d.metadata.testNumber)&&d.metadata.testNumber>=1)))return invalid;
 if(!d.roundKey.trim()||!d.title.trim()||(d.replayNumbers!==undefined&&(!Array.isArray(d.replayNumbers)||!d.replayNumbers.every(n=>Number.isInteger(n)&&n>=1&&n<=200))))return invalid;
 if(!d.questions.length||d.questions.length>200||!d.wrongNumbers.length||!d.wrongNumbers.every(n=>Number.isInteger(n)&&n>=1&&n<=200)||new Set(d.wrongNumbers).size!==d.wrongNumbers.length||(!d.replayNumbers&&d.questions.length!==d.wrongNumbers.length))return invalid;
 if(!d.groups.every(g=>obj(g)&&typeof g.id==='string'&&g.id.length>0&&Array.isArray(g.questionNumbers)&&g.questionNumbers.length>0&&g.questionNumbers.every(n=>Number.isInteger(n)&&n>=1&&n<=200)&&new Set(g.questionNumbers).size===g.questionNumbers.length)||new Set(d.groups.map(g=>g.id)).size!==d.groups.length)return invalid;
 if(!d.questions.every(q=>obj(q)&&Number.isInteger(q.number)&&(d.replayNumbers||d.wrongNumbers).includes(q.number))||new Set(d.questions.map(q=>q.number)).size!==d.questions.length)return invalid;
 const sourceKeys=d.questions.filter(q=>q.sourceIdentity).map(q=>q.sourceIdentity!.key);if(new Set(sourceKeys).size!==sourceKeys.length)return invalid;
 const missing:{number:number|null;reasons:string[]}[]=[];
 if(d.wrongNumbers.some(n=>!d.questions.some(q=>q.number===n)))return invalid;
 if(d.replayNumbers){const expected=replaySelection(d).numbers;if(JSON.stringify(d.replayNumbers)!==JSON.stringify(expected))return invalid;for(const number of expected)if(!d.questions.some(q=>q.number===number))missing.push({number,reasons:['verified_question','verified_choices','official_answer_key']});}

 for(const q of d.questions){
  const reasons:string[]=[],g=d.groups.find(g=>g.id===q.groupId);
  if(!Number.isInteger(q.part)||q.part<1||q.part>7)reasons.push('invalid_part');
  if(!g||!g.questionNumbers.includes(q.number)||(q.part===3||q.part===4)&&(g.questionNumbers.length!==3||new Set(g.questionNumbers).size!==3))reasons.push('question_group');
  if(q.part<=4&&(!g||!(httpsAsset(g.audioUrl)||privateAudio(g.audioUrl))||g.audioVerified!==true))reasons.push('verified_audio');
  if(q.photoUrl!==null&&(!imageAsset(q.photoUrl)||q.photoVerified!==true))reasons.push('question_photo');
  if(q.part===1&&(!imageAsset(q.photoUrl)||q.photoVerified!==true))reasons.push('question_photo');
  if(q.questionVerified!==true||q.part!==1&&!(q.part===2&&q.audioOnly===true&&q.answerProvenance==='user-entered-admin-reviewed')&&!(typeof q.stem==='string'&&q.stem.trim()))reasons.push('verified_question');
  const expected=q.part===2?['A','B','C']:['A','B','C','D'];
  if(!Array.isArray(q.choices)||q.choices.length!==expected.length||!q.choices.every((o,i)=>obj(o)&&o.id===expected[i]&&typeof o.text==='string'&&!!o.text.trim())||q.choicesVerified!==true)reasons.push('verified_choices');
  if(q.sourceIdentity){const identity=q.sourceIdentity;if(!obj(identity)||typeof identity.key!=='string'||!identity.key||typeof identity.page!=='string'||!identity.page||!(identity.unit===null||typeof identity.unit==='string')||!Number.isInteger(identity.questionNumber)||identity.questionNumber<1)reasons.push('source_identity');}
  if(q.tutorExplanation){const t=q.tutorExplanation,nonempty=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=12000,list=(v:unknown)=>Array.isArray(v)&&v.length>0&&v.length<=100&&v.every(nonempty);if(!obj(t)||(t.translation!==undefined&&!nonempty(t.translation))||!nonempty(t.answerReason)||!Array.isArray(t.reading)||!t.reading.length||t.reading.length>100||!t.reading.every(r=>obj(r)&&nonempty(r.chunk)&&nonempty(r.translation))||!list(t.steps)||!list(t.traps)||!list(t.checklist)||!Array.isArray(t.options)||t.options.length!==expected.length||new Set(t.options.map(o=>o.id)).size!==expected.length||!t.options.every(o=>obj(o)&&expected.includes(o.id)&&nonempty(o.explanation)))reasons.push('detailed_explanation');}
  if(q.tutorExplanation?.checkQuestions){const checks=q.tutorExplanation.checkQuestions;if(!Array.isArray(checks)||checks.length>10||!checks.every(c=>obj(c)&&typeof c.id==='string'&&typeof c.prompt==='string'&&c.prompt.trim()&&typeof c.explanation==='string'&&c.explanation.trim()&&Array.isArray(c.options)&&c.options.length>=2&&c.options.length<=4&&new Set(c.options.map(o=>o.id)).size===c.options.length&&c.options.every(o=>obj(o)&&typeof o.id==='string'&&typeof o.text==='string'&&o.text.trim())&&c.options.some(o=>o.id===c.correctOptionId)))reasons.push('check_question');}
  if(q.answerStatus==='assistant_inferred_not_officially_verified'||q.answerVerified!==true||!q.correctOptionId||!expected.includes(q.correctOptionId))reasons.push('official_answer_key');
  if(q.part>=6&&(!g||typeof g.passage!=='string'||!g.passage.trim()||g.passageVerified!==true))reasons.push('verified_passage');
  if(reasons.length)missing.push({number:q.number,reasons});
 }
 return{ready:missing.length===0,total:d.questions.length,missing};
}

/** Group IDs and printed member numbers are authoritative; never infer a triplet from question arithmetic. */
export function replaySelection(d:Pick<ToeicCollection,'wrongNumbers'|'groups'|'questions'>){
 const numbers=new Set(d.wrongNumbers),groupIds=new Set<string>();
 for(const number of d.wrongNumbers){const q=d.questions.find(q=>q.number===number),g=d.groups.find(g=>g.id===q?.groupId);if(q&&(q.part===3||q.part===4||q.part===6||q.part===7)&&g){groupIds.add(g.id);for(const n of g.questionNumbers)numbers.add(n);}}
 return{numbers:[...numbers].sort((a,b)=>a-b),groupIds:[...groupIds]};
}

/** Keep whole verified passage groups while selecting the requested practice parts. */
export function selectParts(data:ToeicCollection,parts?:number[]):ToeicCollection {
 if(!parts?.length)return data;
 const questions=data.questions.filter(q=>parts.includes(q.part));
 const numbers=new Set(questions.map(q=>q.number));
 return {...data,questions,wrongNumbers:data.wrongNumbers.filter(n=>numbers.has(n)),...(data.replayNumbers?{replayNumbers:data.replayNumbers.filter(n=>numbers.has(n))}:{})};
}

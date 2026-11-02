import {createHash} from 'node:crypto';
import type {ToeicQuestion} from './catalog';
import {PART5_OPTIONS} from './part5-option-data';
export interface Part5Option {id:string;text:string;form:string;meaning:string;reason:string;example:string;translation:string;}
export interface Part5OptionRow {answer:string;structure:string;options:Part5Option[];}
export function part5Fingerprint(q:Pick<ToeicQuestion,'stem'|'choices'|'correctOptionId'>){return createHash('sha256').update(JSON.stringify([q.stem,q.choices.map(o=>[o.id,o.text]),q.correctOptionId])).digest('hex');}
/** Only a verified, unchanged source can receive these authored notes. No persistence or owner lookup. */
export function part5OptionStudy(q:ToeicQuestion,rows:Record<string,Part5OptionRow>=PART5_OPTIONS){
 const missing={available:false as const};if(q.part!==5||!q.questionVerified||!q.choicesVerified||!q.answerVerified||q.answerStatus==='assistant_inferred_not_officially_verified'||!q.stem||!q.correctOptionId)return missing;
 const sourceHash=part5Fingerprint(q),r=Object.hasOwn(rows,sourceHash)?rows[sourceHash]:null;
 if(!r||r.answer!==q.correctOptionId||!r.structure||r.options.length!==q.choices.length||!r.options.every((o,i)=>o.id===q.choices[i].id&&o.text===q.choices[i].text&&[o.form,o.meaning,o.reason,o.example,o.translation].every(v=>typeof v==='string'&&v.trim())))return missing;
 return {available:true as const,sourceHash,answer:r.answer,structure:r.structure,exampleKind:'authored' as const,options:r.options.map(o=>({...o}))};
}

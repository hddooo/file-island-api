import {createHash} from 'node:crypto';
import {PART7_EVIDENCE,type Part7EvidenceKind} from './part7-evidence-data';
export interface Part7EvidenceRange {start:number;end:number;translation:string;}
export type Part7Evidence={available:true;sourceHash:string;passageLength:number;ranges:Part7EvidenceRange[];kind:Part7EvidenceKind;explanation:string}|{available:false};
const KINDS=new Set<string>(['direct','inference','absence','contrast','insertion','vocabulary']),own=(o:object,k:string)=>Object.prototype.hasOwnProperty.call(o,k);
// Reviewed evidence only when passage hash, length, question number and expected answer all match. Anything else is unavailable — never a guess.
export function part7Evidence(passage:unknown,number:unknown,answer:unknown):Part7Evidence{
 if(typeof passage!=='string'||!passage||typeof number!=='number'||!Number.isInteger(number)||typeof answer!=='string')return{available:false};
 const sourceHash=createHash('sha256').update(passage,'utf8').digest('hex'),source=own(PART7_EVIDENCE,sourceHash)?PART7_EVIDENCE[sourceHash]:undefined;
 if(!source||source.length!==passage.length)return{available:false};
 const q=own(source.questions,String(number))?source.questions[number]:undefined;
 if(!q||q.answer!==answer||!KINDS.has(q.kind)||typeof q.explanation!=='string'||!q.ranges.length||!q.ranges.every(x=>Number.isInteger(x.start)&&Number.isInteger(x.end)&&x.start>=0&&x.start<x.end&&x.end<=passage.length&&typeof x.translation==='string'&&x.translation.trim()!==''))return{available:false};
 return{available:true,sourceHash,passageLength:passage.length,ranges:q.ranges.map(({start,end,translation})=>({start,end,translation})),kind:q.kind,explanation:q.explanation};
}

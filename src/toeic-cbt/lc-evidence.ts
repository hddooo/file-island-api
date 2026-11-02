import {createHash} from 'node:crypto';
import {LC_EVIDENCE} from './lc-evidence-data';
// Curated, exact script + question + answer binding. Never approximate an unknown source.
export function lcEvidence(script:unknown,status:unknown,number:unknown,answer:unknown){
 if(typeof script!=='string'||!script||status!=='verified'||typeof number!=='number'||!Number.isInteger(number)||typeof answer!=='string')return{available:false};
 const sourceHash=createHash('sha256').update(script).digest('hex'),own=(x:object,k:string)=>Object.prototype.hasOwnProperty.call(x,k),source=own(LC_EVIDENCE,sourceHash)?LC_EVIDENCE[sourceHash]:null,q=source&&own(source.questions,String(number))?source.questions[String(number)]:null;
 if(!source||source.length!==script.length||!q||q.answer!==answer||!q.ranges.length||!q.ranges.every(r=>Number.isInteger(r.start)&&Number.isInteger(r.end)&&r.start>=0&&r.end>r.start&&r.end<=script.length&&r.translation.trim()))return{available:false};
 return{available:true,sourceHash,passageLength:script.length,kind:q.kind,explanation:q.explanation,ranges:q.ranges.map(r=>({...r}))};
}

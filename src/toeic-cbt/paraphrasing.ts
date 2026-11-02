import {createHash} from 'node:crypto';
import type {ToeicQuestion} from './catalog';
import {PARAPHRASES} from './paraphrase-data';
export function paraphrasing(text:unknown,q:ToeicQuestion){
 const unavailable={available:false as const};if(typeof text!=='string'||!text||!q.answerVerified||q.answerStatus==='assistant_inferred_not_officially_verified')return unavailable;
 const row=Object.hasOwn(PARAPHRASES,String(q.number))?PARAPHRASES[String(q.number)]:null;
 const hash=createHash('sha256').update(text).digest('hex');
 if(!row||row.sourceHash!==hash||row.part!==q.part||row.stem!==q.stem||row.answer!==q.correctOptionId||q.choices.find(c=>c.id===q.correctOptionId)?.text!==row.answerText)return unavailable;
 if(!row.pairs.every(p=>p.sourceQuotes.length&&p.sourceQuotes.every(t=>text.includes(t))&&p.targetText&&p.meaning&&p.reason&&(p.kind==='book_example'||q.choices.some(c=>c.id===p.targetOption&&c.text===p.targetText)&&(p.kind==='mentioned_option'?p.targetOption!==q.correctOptionId&&/\bNOT\b/.test(q.stem||''):p.targetOption===q.correctOptionId))))return unavailable;
 return{available:true as const,sourceHash:hash,answer:row.answer,basis:row.basis,bookPages:row.bookPages,pairs:row.pairs.map(p=>({...p,sourceQuotes:[...p.sourceQuotes]}))};
}

import {createHash} from 'node:crypto';
import {PART7_TRANSLATIONS,type Part7TranslationUnit} from './part7-translations-data';
export type Part7PassageStudy={available:true;sourceHash:string;passageLength:number;units:Part7TranslationUnit[]}|{available:false};
const unavailable=():Part7PassageStudy=>({available:false});
// 번역은 passage 원문의 sha256·길이가 정확히 일치하고 구간이 0..length를 빈틈없이 덮을 때만 노출한다(실패 시 fail-closed).
export function part7PassageStudy(passage:unknown):Part7PassageStudy{
 try{
  if(typeof passage!=='string'||!passage.length)return unavailable();
  const sourceHash=createHash('sha256').update(passage,'utf8').digest('hex');
  if(!Object.prototype.hasOwnProperty.call(PART7_TRANSLATIONS,sourceHash))return unavailable();
  const entry=PART7_TRANSLATIONS[sourceHash];
  if(!entry||entry.sourceHash!==sourceHash||entry.passageLength!==passage.length||!Array.isArray(entry.units)||!entry.units.length)return unavailable();
  const units:Part7TranslationUnit[]=[];let cursor=0;
  for(const u of entry.units){
   if(!u||typeof u!=='object'||!Number.isInteger(u.start)||!Number.isInteger(u.end)||u.start!==cursor||u.end<=u.start||u.end>passage.length||typeof u.translation!=='string'||!u.translation.trim())return unavailable();
   units.push({start:u.start,end:u.end,translation:u.translation});cursor=u.end;
  }
  if(cursor!==passage.length)return unavailable();
  return{available:true,sourceHash,passageLength:passage.length,units};
 }catch{return unavailable();}
}

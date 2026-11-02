import {scriptStudy} from '../toeic-cbt/lc-script';
import type {Bundle,BundleSubmission,Side} from './rules';
export interface ReviewRow {round_no:number;started_at:Date;content:Bundle;submissions:Record<Side,BundleSubmission|null>;}
export function personalReview(rows:ReviewRow[],side:Side){
 let total=0,answered=0,correct=0;
 const rounds=rows.map(r=>({round:r.round_no,startedAt:r.started_at,part:r.content.part,prompt:r.content.prompt,passage:r.content.passage,images:r.content.images,audio:r.content.audio?{seconds:r.content.audio.seconds}:null,script:r.content.script||null,scriptStatus:r.content.scriptStatus||null,scriptStudy:scriptStudy(r.content.script||'',r.content.scriptStatus||''),items:r.content.items.map(item=>{const mine=r.submissions[side]?.answers.find(x=>x.id===item.id);total++;if(mine)answered++;const ok=!!mine&&mine.optionId===item.answer;if(ok)correct++;return {...item,myAnswer:mine?.optionId||null,correct:mine?ok:null};})}));
 return{rounds,stats:{issued:total,answered,correct,wrong:answered-correct,unanswered:total-answered,accuracy:total?Math.round(correct/total*1000)/10:null,denominator:'issued'},partial:rows.some((r,i)=>r.round_no!==i+1)};
}

import type {Queryable} from '../db/db.service';
import {boundedGrowth} from './growth-floor';
/** Only called for a newly persisted, server-graded answer inside its owner-locked transaction. */
export async function toeicGrowth(q:Queryable,owner:string,event:string,correct:boolean,now:Date){
 const delta=(await boundedGrowth(q,owner,correct?1:-1))||0;
 await q.query("INSERT INTO hanq.growth_ledger(user_id,event_key,kind,amount,created_at) VALUES($1,$2,'toeic-answer',$3,$4) ON CONFLICT(user_id,event_key) DO NOTHING",[owner,event,delta,now]);
 return{delta};
}

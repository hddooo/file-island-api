import type {Queryable} from '../db/db.service';
import {lockOwner} from '../common/owner-lock';
import {boundedGrowth} from '../common/growth-floor';
import type {Fighter,Side} from './rules';
export function battleDelta(self:number,opponent:number,won:boolean):number {
 const gap=opponent-self;
 return won?(gap>=2?200:gap===1?150:gap===0?100:gap===-1?50:25):(gap>=2?-25:gap===1?-50:gap===0?-100:gap===-1?-150:-200);
}
export async function settleBattle(q:Queryable,match:string,left:string,right:string,fighters:Record<Side,Fighter>,winner:Side|null,reason:string,at:Date){
 // Game row is already locked. Owner locks are acquired in stable order; grading never locks a battle row.
 for(const id of [left,right].sort())await lockOwner(q,id);
 const result={} as Record<Side,{requested:number;delta:number;totalAfter:number}>;
 for(const side of ['left','right'] as const){const user=side==='left'?left:right,target=side==='left'?'right':'left';
  const prior=(await q.query<{requested_delta:number;applied_delta:number;balance_after:string}>('SELECT requested_delta,applied_delta,balance_after FROM hanq.battle_xp_ledger WHERE match_id=$1 AND user_id=$2',[match,user])).rows[0];
  if(prior){result[side]={requested:prior.requested_delta,delta:prior.applied_delta,totalAfter:Number(prior.balance_after)};continue;}
  const requested=winner?battleDelta(fighters[side].stageIndex,fighters[target].stageIndex,winner===side):0;
  const delta=await boundedGrowth(q,user,requested);
  const balance=Number((await q.query<{points:string}>('SELECT coalesce(sum(amount),0)::text points FROM hanq.growth_ledger WHERE user_id=$1',[user])).rows[0].points);
  if(!Number.isSafeInteger(balance)||balance<0)throw new Error('growth balance requires reconciliation');
  if(winner)await q.query("INSERT INTO hanq.growth_ledger(user_id,event_key,kind,amount,battle_match_id,created_at) VALUES($1,$2,'battle',$3,$4,$5)",[user,'battle:'+match,delta,match,at]);
  await q.query('INSERT INTO hanq.battle_xp_ledger(match_id,user_id,outcome,reason,self_stage,opponent_stage,requested_delta,applied_delta,balance_after,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[match,user,winner?(winner===side?'win':'loss'):reason==='double_ko'?'draw':'void',reason,fighters[side].stageIndex,fighters[target].stageIndex,requested,delta,balance+delta,at]);
  result[side]={requested,delta,totalAfter:balance+delta};
 }return result;
}

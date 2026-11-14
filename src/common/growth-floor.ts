import type { Queryable } from '../db/db.service';
import { AppError } from './app-error';
/** Call only inside the existing owner-locked grading transaction. Never rewrite ledger history. */
export async function boundedGrowth(q:Queryable,userId:string,requested:number):Promise<number>{
  if(requested>=0)return requested;
  const r=await q.query<{points:string}>('SELECT xp::text points FROM hanq.owned_digimon WHERE user_id=$1 AND equipped',[userId]);
  const points=Number(r.rows[0]?.points);
  if(!Number.isSafeInteger(points)||points<0)throw new Error('growth balance requires reconciliation');
  return Math.max(requested,-points)||0;
}
/** XP of the equipped partner; 0 when none exists yet (the ledger trigger would create one with 0 XP). */
export async function equippedPartnerXp(q:Queryable,userId:string):Promise<number>{
  const r=await q.query<{points:string}>('SELECT xp::text points FROM hanq.owned_digimon WHERE user_id=$1 AND equipped',[userId]);
  if(!r.rowCount)return 0;
  const points=Number(r.rows[0].points);
  if(!Number.isSafeInteger(points)||points<0)throw new AppError(503,'growth_unavailable','Growth unavailable');
  return points;
}

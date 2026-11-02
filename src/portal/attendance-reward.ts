import type {Queryable} from '../db/db.service';
export const ATTENDANCE_STEPS=[10,20,30,40,50] as const;
export function attendanceStep(consecutive:number){if(!Number.isSafeInteger(consecutive)||consecutive<1)throw new Error('invalid attendance streak');const position=(consecutive-1)%5+1;return{position,xp:ATTENDANCE_STEPS[position-1]};}
export function attendanceDay(day:string,offset:number){return new Date(Date.parse(day+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);}
/** A missing date permanently shifts every older row away from its expected consecutive position. */
export async function attendanceStreak(q:Queryable,user:string,anchor:string){const r=await q.query<{consecutive:number}>(`SELECT count(*)::int consecutive FROM (SELECT day,row_number() OVER(ORDER BY day DESC) n FROM hanq.attendance WHERE user_id=$1 AND day<=$2::date) d WHERE day=$2::date-(n-1)::int`,[user,anchor]);return r.rows[0].consecutive;}
export async function attendanceReward(q:Queryable,user:string,day:string,today:boolean,awarded:number){
 const consecutive=await attendanceStreak(q,user,today?day:attendanceDay(day,-1)),claimConsecutive=today?consecutive:consecutive+1,current=attendanceStep(claimConsecutive),next=today?attendanceStep(consecutive+1):current,base=attendanceDay(day,1-current.position);
 const rows=(await q.query<{attendance_day:string;earned:number}>("SELECT a.day::text attendance_day,coalesce(g.amount,0)::int earned FROM hanq.attendance a LEFT JOIN hanq.growth_ledger g ON g.user_id=a.user_id AND g.attendance_day=a.day AND g.kind='attendance' WHERE a.user_id=$1 AND a.day BETWEEN $2::date AND $3::date ORDER BY a.day",[user,base,day])).rows;
 const tiles=ATTENDANCE_STEPS.map((xp,i)=>{const date=attendanceDay(base,i),saved=rows.find(r=>r.attendance_day===date);return{position:i+1,xp,date,status:saved?'claimed':date===day?'current':'upcoming',today:date===day,earnedXp:saved?saved.earned:null};});
 return{policy:'streak-5-cycle-v1',steps:ATTENDANCE_STEPS,daily:current.xp,awarded,earnedToday:rows.find(r=>r.attendance_day===day)?.earned||0,consecutive,claimConsecutive,cycleDay:current.position,nextXp:next.xp,nextCycleDay:next.position,tiles};
}

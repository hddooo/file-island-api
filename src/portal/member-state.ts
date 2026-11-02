import {attendanceStreak,attendanceStep,attendanceReward} from './attendance-reward';
import {lockOwner} from '../common/owner-lock';
import{developmentPremiumOpen}from'../premium/development-policy';
import {AppError} from '../common/app-error';import type {Queryable} from '../db/db.service';import {kstDate} from '../wrong-notes/study-policy';
export const CHAPTER_ORDER=['prehistory','gojoseon','samguk','nambuk','goryeo','joseon','islands','opening','colonial','modern'];
/** Called inside the caller's transaction for writes; owner lock precedes the confirmation clock and ledger. */
export async function attendance(q:Queryable,userId:string,clock:Date|(()=>Date),write=false){
 if(write)await lockOwner(q,userId);
 const now=typeof clock==='function'?clock():clock,day=kstDate(now);let awarded=0;
 if(write){const added=await q.query('INSERT INTO hanq.attendance(user_id,day,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING day',[userId,day,now]);
  if(added.rows.length){const step=attendanceStep(await attendanceStreak(q,userId,day));const reward=await q.query<{amount:number}>("INSERT INTO hanq.growth_ledger(user_id,event_key,kind,amount,attendance_day,created_at) VALUES($1,'attendance:'||$2::text,'attendance',$4,$2::date,$3) ON CONFLICT(user_id,event_key) DO NOTHING RETURNING amount",[userId,day,now,step.xp]);if(reward.rows.length)awarded=reward.rows[0].amount;}
 }
 const r=await q.query<{total:number;today:boolean}>('SELECT count(*)::int total,coalesce(bool_or(day=$2::date),false) today FROM hanq.attendance WHERE user_id=$1',[userId,day]);
 const reward=await attendanceReward(q,userId,day,r.rows[0].today,awarded);
 const balance=await q.query<{points:string}>('SELECT coalesce(sum(amount),0)::text points FROM hanq.growth_ledger WHERE user_id=$1',[userId]);
 const slots=await q.query<{chapter:string;kind:string;question_id:string}>('SELECT chapter,kind,question_id FROM hanq.free_question_slots ORDER BY chapter,kind,position');
 return{date:day,today:r.rows[0].today,total:r.rows[0].total,openedChapters:CHAPTER_ORDER.slice(0,r.rows[0].total),quizLimit:5,mockLimit:5,freeSlots:slots.rows,reward,growth:{points:Number(balance.rows[0].points)}};
}
export async function claimNickname(q:Queryable,userId:string,name:string){const key=name.trim().toLowerCase();const r=await q.query<{user_id:string|null}>('SELECT user_id FROM hanq.nickname_claims WHERE nickname_key=$1',[key]);if(r.rows.length&&r.rows[0].user_id!==userId)throw new AppError(409,'nickname_taken','This nickname is already used');await q.query('DELETE FROM hanq.nickname_claims WHERE user_id=$1 AND nickname_key<>$2',[userId,key]);const c=await q.query('INSERT INTO hanq.nickname_claims(nickname_key,user_id) VALUES($1,$2) ON CONFLICT(nickname_key) DO UPDATE SET user_id=EXCLUDED.user_id WHERE hanq.nickname_claims.user_id=EXCLUDED.user_id RETURNING nickname_key',[key,userId]);if(!c.rowCount)throw new AppError(409,'nickname_taken','This nickname is already used');}
export async function assertQuestionAccess(q:Queryable,userId:string,question:{question_id:string;chapter:string|null;era:string|null;kind:string},now:Date){if(developmentPremiumOpen())return;const premium=await q.query('SELECT 1 FROM hanq.premium_state WHERE user_id=$1 AND expires_at>$2',[userId,now]);if(premium.rowCount)return;const slot=await q.query('SELECT 1 FROM hanq.free_question_slots WHERE kind=$1 AND question_id=$2',[question.kind,question.question_id]);if(!slot.rowCount)throw new AppError(403,'premium_required','This question is outside the fixed free selection');}

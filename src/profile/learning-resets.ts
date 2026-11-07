import { AppError } from '../common/app-error';
import type { Queryable } from '../db/db.service';
import { lockOwner } from '../common/owner-lock';
export type ResetIsland = 'history' | 'toeic';
export async function learningResetStatus(q: Queryable, owner: string) {
 const rows=(await q.query<{island:ResetIsland;reset_at:Date}>('SELECT island,reset_at FROM hanq.wrong_history_resets WHERE user_id=$1',[owner])).rows;
 const time=(s:ResetIsland)=>rows.find(r=>r.island===s)?.reset_at;
 return {available:true,scope:'wrong_answers_only',history:{resetAt:time('history')?.toISOString()||null},toeic:{resetAt:time('toeic')?.toISOString()||null},preserves:['source','xp','vocabulary','correct_answers','other_island']};
}
export async function requestLearningReset(q:Queryable,owner:string,island:ResetIsland,confirmation:string,requestId:string,clock:()=>Date) {
 if(confirmation!==(island==='history'?'RESET_HISTORY':'RESET_TOEIC'))throw new AppError(400,'learning_reset_confirmation_required','초기화할 섬을 확인해 주세요.');
 await lockOwner(q,owner);
 const old=(await q.query<{island:ResetIsland;reset_at:Date}>('SELECT island,reset_at FROM hanq.wrong_history_reset_requests WHERE user_id=$1 AND request_id=$2',[owner,requestId])).rows[0];
 if(old&&old.island!==island)throw new AppError(409,'learning_reset_request_conflict','다른 섬에 사용한 요청 번호입니다.');
 if(!old){
  const now=clock();
  await q.query('INSERT INTO hanq.wrong_history_reset_requests(user_id,request_id,island,reset_at) VALUES($1,$2,$3,$4)',[owner,requestId,island,now]);
  await q.query('INSERT INTO hanq.wrong_history_resets(user_id,island,reset_at) VALUES($1,$2,$3) ON CONFLICT(user_id,island) DO UPDATE SET reset_at=GREATEST(hanq.wrong_history_resets.reset_at,EXCLUDED.reset_at)',[owner,island,now]);
 }
 return {...await learningResetStatus(q,owner),replayed:!!old};
}

/** Captured when the answer is created, never upgraded while retrying an old queue entry. */
export async function assertWrongResetGeneration(q:Queryable,owner:string,island:ResetIsland,resetAt?:string|null){
 const row=(await q.query<{reset_at:Date}>('SELECT reset_at FROM hanq.wrong_history_resets WHERE user_id=$1 AND island=$2',[owner,island])).rows[0];
 if(row&&(!resetAt||Date.parse(resetAt)!==row.reset_at.getTime()))throw new AppError(409,'learning_reset_changed','오답 기록이 초기화되었습니다. 화면을 새로 열어 다시 풀어 주세요.');
}

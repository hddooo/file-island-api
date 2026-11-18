import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error';
import { lockOwner } from '../common/owner-lock';
import { CLOCK, type Clock } from '../common/tokens';
import { DbService } from '../db/db.service';
import { learningResetStatus } from '../profile/learning-resets';
import { RehearsalResultDto } from './cbt-rehearsal.dto';

export function normalizeRehearsal(round:string,d:RehearsalResultDto,now:Date):RehearsalResultDto {
 const fail=()=>{throw new AppError(400,'invalid_rehearsal_result','복습 결과를 확인해 주세요.');};
 if(!/^(7[0-9]|80)$/.test(round)||Number(round)!==d.round||!Array.isArray(d.rows)||!d.rows.length||d.rows.length>50)fail();
 const at=Date.parse(d.at),reset=d.resetAt==null?null:Date.parse(d.resetAt);
 // Small clock skew is allowed; a future-dated device cannot pin latest forever.
 if(!Number.isFinite(at)||at>now.getTime()+60000||at<0||(reset!==null&&(!Number.isFinite(reset)||at<=reset)))fail();
 const ids=new Set<string>(),numbers=new Set<number>();
 for(const r of d.rows){
  if(r.exam!==d.round||!Number.isInteger(r.number)||r.number<1||r.number>50||!r.questionId||r.questionId.length>120||!r.version||r.version.length>80||!['empty','correct','wrong'].includes(r.status)||ids.has(r.questionId)||numbers.has(r.number))fail();
  ids.add(r.questionId);numbers.add(r.number);
 }
 if(d.total!==d.rows.length||d.right!==d.rows.filter(r=>r.status==='correct').length||typeof d.marked!=='boolean')fail();
 return {round:d.round,right:d.right,total:d.total,marked:d.marked,at:new Date(at).toISOString(),resetAt:reset===null?null:new Date(reset).toISOString(),rows:d.rows.map(r=>({questionId:r.questionId,version:r.version,exam:r.exam,number:r.number,status:r.status}))};
}

@Injectable()
export class CbtRehearsalService {
 constructor(private readonly db:DbService,@Inject(CLOCK) private readonly clock:Clock){}
 async list(owner:string){
  return this.db.tx(async q=>{
   await lockOwner(q,owner);
   const resetAt=(await learningResetStatus(q,owner)).history.resetAt;
   const rows=await q.query<{result:RehearsalResultDto}>(`SELECT result FROM hanq.cbt_rehearsal_results WHERE user_id=$1 AND hanq.wrong_history_visible(user_id,'history',submitted_at) AND reset_at IS NOT DISTINCT FROM $2::timestamptz ORDER BY exam_round`,[owner,resetAt]);
   return {results:rows.rows.map(r=>r.result),resetAt};
  });
 }
 async save(owner:string,round:string,input:RehearsalResultDto){
  const result=normalizeRehearsal(round,input,this.clock.now());
  return this.db.tx(async q=>{
   await lockOwner(q,owner);
   const reset=(await learningResetStatus(q,owner)).history.resetAt;
   if(reset!==result.resetAt)throw new AppError(409,'learning_reset_changed','오답 기록이 초기화되었습니다. 화면을 새로 열어 다시 풀어 주세요.');
   // A snapshot cannot introduce another account's/unseen/unfinalized questions.
   const allowed=(await q.query<{question_id:string;version:string;exam_number:number}>(`SELECT DISTINCT i.question_id,i.version,i.exam_number FROM hanq.cbt_run_items i JOIN hanq.cbt_runs r ON r.id=i.run_id AND r.user_id=i.user_id WHERE i.user_id=$1 AND r.exam_round=$2 AND r.status='final' AND (hanq.wrong_history_visible(r.user_id,'history',r.created_at) OR EXISTS(SELECT 1 FROM hanq.cbt_question_stars s WHERE s.user_id=i.user_id AND s.question_id=i.question_id AND s.version=i.version AND s.starred AND hanq.wrong_history_visible(s.user_id,'history',s.updated_at)))`,[owner,result.round])).rows;
   if(result.rows.some(r=>!allowed.some(a=>a.question_id===r.questionId&&a.version===r.version&&a.exam_number===r.number)))throw new AppError(403,'rehearsal_question_scope','복습 가능한 문항만 저장할 수 있습니다.');
   const old=(await q.query<{result:RehearsalResultDto;reset_at:Date|null}>(`SELECT result,reset_at FROM hanq.cbt_rehearsal_results WHERE user_id=$1 AND exam_round=$2`,[owner,result.round])).rows[0];
   // Same timestamp replay or stale device must not replace the saved latest snapshot.
   if(old&&(old.reset_at?.toISOString()??null)===reset&&Date.parse(old.result.at)>=Date.parse(result.at))return {result:old.result};
   await q.query(`INSERT INTO hanq.cbt_rehearsal_results(user_id,exam_round,result,submitted_at,reset_at) VALUES($1,$2,$3::jsonb,$4,$5) ON CONFLICT(user_id,exam_round) DO UPDATE SET result=EXCLUDED.result,submitted_at=EXCLUDED.submitted_at,reset_at=EXCLUDED.reset_at`,[owner,result.round,JSON.stringify(result),result.at,reset]);
   return {result};
  });
 }
}

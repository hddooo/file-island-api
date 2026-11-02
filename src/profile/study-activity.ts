import type { Queryable } from '../db/db.service';
import { kstDate } from '../wrong-notes/study-policy';
export function activityWindow(now:Date,month?:string){if(month){if(!/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(month))throw new Error('invalid month');const [year,m]=month.split('-').map(Number);return{start:month+'-01',end:new Date(Date.UTC(year,m,0)).toISOString().slice(0,10)};}const end=kstDate(now),start=new Date(Date.parse(end+'T00:00:00Z')-83*86400000).toISOString().slice(0,10);return{start,end};}
/** Recorded submissions only. Read retries are not events; idempotent writes already have unique keys.
 * Imports are excluded because uploading an old answer is not studying on the upload date. */
export async function studyActivity(q:Queryable,owner:string,now:Date,month?:string){const {start,end}=activityWindow(now,month),from=start+'T00:00:00+09:00',until=new Date(Date.parse(end+'T00:00:00+09:00')+86400000).toISOString();
 const result=await q.query<{date:string;history:number;toeic:number;signins:number}>(`WITH activity AS (
 SELECT created_at AS happened_at,'history' AS kind FROM hanq.attempts WHERE user_id=$1 AND source<>'import' AND option_id IS NOT NULL AND created_at >= $2 AND created_at < $3
 UNION ALL SELECT created_at,'toeic' FROM hanq.toeic_cbt_practice_answers WHERE user_id=$1 AND selected_option IS NOT NULL AND created_at >= $2 AND created_at < $3
 UNION ALL SELECT r.final_at,'toeic' FROM hanq.toeic_cbt_runs r JOIN hanq.toeic_cbt_items i ON i.run_id=r.id AND i.user_id=r.user_id WHERE r.user_id=$1 AND r.status='final' AND i.selected_option IS NOT NULL AND i.correct IS NOT NULL AND r.final_at >= $2 AND r.final_at < $3 AND NOT EXISTS(SELECT 1 FROM hanq.toeic_cbt_verification_runs v WHERE v.user_id=r.user_id AND v.run_id=r.id)
 UNION ALL SELECT attempted_at,'toeic' FROM hanq.weakness_practice_attempts WHERE user_id=$1 AND attempted_at >= $2 AND attempted_at < $3
 UNION ALL SELECT created_at,'signin' FROM hanq.member_access_logs WHERE user_id=$1 AND event='signin' AND created_at >= $2 AND created_at < $3
 ) SELECT to_char(happened_at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD') date,count(*) FILTER(WHERE kind='history')::int history,count(*) FILTER(WHERE kind='toeic')::int toeic,count(*) FILTER(WHERE kind='signin')::int signins FROM activity GROUP BY date ORDER BY date`,[owner,from,until]);
 return{start,end,timeZone:'Asia/Seoul',days:result.rows,coverage:'server-recorded-submissions',signins:'explicit-signin-only'};
}

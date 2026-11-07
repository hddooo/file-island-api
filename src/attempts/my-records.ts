import {Injectable} from '@nestjs/common';
import {DbService} from '../db/db.service';
import {AppError} from '../common/app-error';

/** Each row is one persisted answer. Imports and old general attempts do not prove a UI entry route. */
function battleFields(alias:string,side:string){return `,'battle',jsonb_build_object('opponent',${alias}.state#>>ARRAY['fighters',CASE WHEN ${side}='left' THEN 'right' ELSE 'left' END,'name'],'outcome',CASE WHEN ${alias}.status='finished' AND ${alias}.state->>'finishReason'='double_ko' AND ${alias}.state->>'winner' IS NULL THEN 'draw' WHEN ${alias}.status='void' THEN 'void' WHEN ${alias}.status='finished' AND ${alias}.state->>'winner' IN('left','right') THEN CASE WHEN ${alias}.state->>'winner'=${side} THEN 'win' ELSE 'loss' END ELSE 'unknown' END)`;}
/** Archived fighter names are public nicknames; never expose the rest of the match state. */
export function recordNickname(value:unknown){if(typeof value!=='string'||value.includes('@'))return '상대 미확인';const name=Array.from(value).filter(c=>c.charCodeAt(0)>31&&c.charCodeAt(0)!==127&&c!=='<'&&c!=='>').join('').trim();return name?Array.from(name).slice(0,24).join(''):'상대 미확인';}
export const RECORD_EVENTS=`
 SELECT 'history:'||a.id::text key,'history' subject,'unknown' source,coalesce(a.reported_at,a.created_at) at,a.created_at recorded_at,
 jsonb_build_object('questionId',a.question_id,'question',v.review_payload,'public',v.public_payload,'answer',v.correct_option_id,'selected',a.option_id,'correct',a.correct,'origin',a.source,'runId',a.run_id,'timeUnknown',a.source='import' AND a.reported_at IS NULL,'timeBasis',CASE WHEN a.source='import' THEN 'import' ELSE 'saved' END) detail
 FROM hanq.visible_wrong_attempts a LEFT JOIN hanq.question_versions v ON v.question_id=a.question_id AND v.version=a.version WHERE a.user_id=$1

 UNION ALL
 SELECT 'focus:'||a.event_id::text,'toeic','unknown',a.attempted_at,a.received_at,
 jsonb_build_object('questionId',a.question_id,'bankId',a.bank_id,'version',a.question_version,'selected',a.selected_option,'answer',a.correct_option,'correct',a.selected_option=a.correct_option,'origin','focus','timeBasis','device')
 FROM hanq.visible_wrong_focus_attempts a WHERE a.user_id=$1
 UNION ALL
 SELECT 'toeic:'||a.id::text,'toeic','unknown',a.created_at,a.created_at,
 jsonb_build_object('questionId',a.collection_id::text||':'||a.question_number,'question',i.item,'selected',a.selected_option,'correct',CASE WHEN a.answer_verified THEN a.correct ELSE NULL END,'reference',NOT a.answer_verified,'origin','practice','title',c.title,'collectionId',c.id,'passage',(SELECT g->>'passage' FROM jsonb_array_elements(c.content->'groups') g WHERE g->>'id'=i.item->>'groupId' LIMIT 1),'script',(SELECT g->>'script' FROM jsonb_array_elements(c.content->'groups') g WHERE g->>'id'=i.item->>'groupId' LIMIT 1))
 FROM hanq.visible_wrong_toeic_answers a LEFT JOIN hanq.toeic_cbt_collections c ON c.id=a.collection_id
 LEFT JOIN LATERAL (SELECT value item FROM jsonb_array_elements(c.content->'questions') WHERE (value->>'number')::int=a.question_number LIMIT 1) i ON true WHERE a.user_id=$1
 UNION ALL
 SELECT 'toeic-run:'||r.id::text||':'||i.position,'toeic','unknown',r.final_at,r.final_at,
 jsonb_build_object('questionId',r.collection_id::text||':'||i.question_number,'question',x.item,'selected',i.selected_option,'correct',i.correct,'origin','run','title',c.title,'collectionId',c.id,'passage',(SELECT g->>'passage' FROM jsonb_array_elements(c.content->'groups') g WHERE g->>'id'=x.item->>'groupId' LIMIT 1),'script',(SELECT g->>'script' FROM jsonb_array_elements(c.content->'groups') g WHERE g->>'id'=x.item->>'groupId' LIMIT 1))
 FROM hanq.toeic_cbt_runs r JOIN hanq.toeic_cbt_items i ON i.run_id=r.id AND i.user_id=r.user_id LEFT JOIN hanq.toeic_cbt_collections c ON c.id=r.collection_id
 LEFT JOIN LATERAL (SELECT value item FROM jsonb_array_elements(c.content->'questions') WHERE (value->>'number')::int=i.question_number LIMIT 1) x ON true
 WHERE r.user_id=$1 AND r.status='final' AND (i.correct IS DISTINCT FROM false OR hanq.wrong_history_visible(r.user_id,'toeic',r.created_at)) AND i.selected_option IS NOT NULL AND i.correct IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hanq.toeic_cbt_verification_runs v WHERE v.user_id=r.user_id AND v.run_id=r.id)
 UNION ALL
 SELECT 'battle:'||m.id::text||':'||r.round_no||':'||(i.item->>'id'),m.subject,'battle',
 CASE WHEN ans.answer->>'at' ~ '^\\d{10,16}$' THEN to_timestamp((ans.answer->>'at')::double precision/1000) ELSE r.started_at END,CASE WHEN m.state->>'endedAt' ~ '^\\d{10,16}$' THEN to_timestamp((m.state->>'endedAt')::double precision/1000) ELSE m.created_at END,
 jsonb_build_object('questionId',r.content->>'key','question',i.item,'selected',ans.answer->>'optionId','correct',(ans.answer->>'optionId')=(i.item->>'answer'),'answer',i.item->>'answer','origin','battle'${battleFields('m',"(CASE WHEN m.challenger=$1 THEN 'left' ELSE 'right' END)")},'matchId',m.id,'round',r.round_no,'images',r.content->'images','passage',r.content->>'passage','timeUnknown',NOT (ans.answer ? 'at'))
 FROM (SELECT id,challenger,opponent,subject,status,state,created_at FROM hanq.battle_matches WHERE challenger=$1 OR opponent=$1) m
 JOIN hanq.battle_rounds r ON r.match_id=m.id
 CROSS JOIN LATERAL jsonb_array_elements(r.content->'items') i(item)
 CROSS JOIN LATERAL (SELECT value answer FROM jsonb_array_elements(coalesce(r.submissions->(CASE WHEN m.challenger=$1 THEN 'left' ELSE 'right' END)->'answers','[]'::jsonb)) WHERE value->>'id'=i.item->>'id') ans
 WHERE m.status IN('finished','void')
 UNION ALL
 SELECT 'practice-battle:'||m.id::text||':'||r.round_no||':'||(i.item->>'id'),m.subject,'battle',
 CASE WHEN ans.answer->>'at' ~ '^\\d{10,16}$' THEN to_timestamp((ans.answer->>'at')::double precision/1000) ELSE r.started_at END,CASE WHEN m.state->>'endedAt' ~ '^\\d{10,16}$' THEN to_timestamp((m.state->>'endedAt')::double precision/1000) ELSE m.created_at END,
 jsonb_build_object('questionId',r.content->>'key','question',i.item,'selected',ans.answer->>'optionId','correct',(ans.answer->>'optionId')=(i.item->>'answer'),'answer',i.item->>'answer','origin','battle-practice'${battleFields('m',"'left'")},'matchId',m.id,'round',r.round_no,'images',r.content->'images','passage',r.content->>'passage','timeUnknown',NOT (ans.answer ? 'at'))
 FROM hanq.battle_practice_matches m JOIN hanq.battle_practice_rounds r ON r.match_id=m.id
 CROSS JOIN LATERAL jsonb_array_elements(r.content->'items') i(item)
 CROSS JOIN LATERAL (SELECT value answer FROM jsonb_array_elements(coalesce(r.submissions->'left'->'answers','[]'::jsonb)) WHERE value->>'id'=i.item->>'id') ans
 WHERE m.owner_id=$1 AND m.status IN('finished','void')
 UNION ALL
 SELECT 'battle-review:'||a.request_key::text,archive.subject,'review',a.created_at,a.created_at,
 jsonb_build_object('questionId',r.content->>'key','question',i.item,'selected',a.option_id,'answer',i.item->>'answer','correct',a.correct,'origin','battle-review'${battleFields('archive',"(CASE WHEN archive.challenger=$1 THEN 'left' ELSE 'right' END)")},'matchId',a.match_id,'round',a.round_no,'images',r.content->'images','passage',r.content->>'passage')
 FROM hanq.battle_wrong_attempts a
 JOIN (SELECT id,subject,challenger,opponent,status,state FROM hanq.battle_matches WHERE status IN('finished','void') UNION ALL SELECT id,subject,owner_id,NULL::uuid,status,state FROM hanq.battle_practice_matches WHERE status IN('finished','void')) archive ON archive.id=a.match_id AND (archive.challenger=$1 OR archive.opponent=$1)
 JOIN (SELECT match_id,round_no,content FROM hanq.battle_rounds UNION ALL SELECT match_id,round_no,content FROM hanq.battle_practice_rounds) r ON r.match_id=a.match_id AND r.round_no=a.round_no
 CROSS JOIN LATERAL (SELECT value item FROM jsonb_array_elements(r.content->'items') WHERE value->>'id'=a.item_id) i
 WHERE a.user_id=$1
`;
export function recordQuery(query:{subject?:unknown;source?:unknown;page?:unknown;snapshot?:unknown}){
 if(Object.values(query).some(v=>v!==undefined&&typeof v!=='string'&&typeof v!=='number'))throw new AppError(400,'invalid_records_query','기록 필터를 확인해 주세요.');const subject=query.subject??'all',source=query.source??'all',page=Number(query.page??1);
 if(!['all','history','toeic'].includes(String(subject))||!['all','battle','review','unknown'].includes(String(source))||!Number.isSafeInteger(page)||page<1||page>1000000)throw new AppError(400,'invalid_records_query','기록 필터와 페이지를 확인해 주세요.');
 const snapshot=query.snapshot===undefined?new Date().toISOString():String(query.snapshot);if(snapshot.length>40||!/^\d{4}-\d{2}-\d{2}T/.test(snapshot)||!Number.isFinite(Date.parse(snapshot))||Date.parse(snapshot)>Date.now()+300000)throw new AppError(400,'invalid_records_query','기록 조회 시각을 확인해 주세요.');return{subject:String(subject),source:String(source),page,snapshot:new Date(snapshot).toISOString()};
}
@Injectable()
export class MyRecordsService{
 constructor(private readonly db:DbService){}
 async list(owner:string,query:{subject?:unknown;source?:unknown;page?:unknown;snapshot?:unknown}){const filter=recordQuery(query);return this.db.tx(async q=>{
  await q.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const base=`WITH events AS (${RECORD_EVENTS}), filtered AS (SELECT * FROM events WHERE ($2='all' OR subject=$2) AND ($3='all' OR source=$3) AND recorded_at<=$4::timestamptz AND (source<>'unknown' OR detail->>'correct' IS DISTINCT FROM 'false' OR hanq.wrong_history_visible($1,subject,recorded_at)))`;
  const params=[owner,filter.subject,filter.source,filter.snapshot];
  const total=Number((await q.query<{total:string}>(base+' SELECT count(*)::text total FROM filtered',params)).rows[0].total),pages=Math.max(1,Math.ceil(total/20)),page=Math.min(filter.page,pages);
  const rows=(await q.query(base+' SELECT * FROM filtered ORDER BY at DESC,key DESC LIMIT 20 OFFSET $5',[...params,(page-1)*20])).rows;
  for(const row of rows){if(row.detail?.battle)row.detail.battle.opponent=recordNickname(row.detail.battle.opponent);}
  return{items:rows,total,page,pages,snapshot:filter.snapshot,timeZone:'Asia/Seoul'};
 });}
}

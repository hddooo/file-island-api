import type {Queryable} from '../db/db.service';
const sets:Record<string,string>={'vocab-mini-001-v1':'Chapter 1 단어 미니모의 50문항','vocab-mini-002-v1':'Chapter 2 단어 미니모의 50문항','vocab-mini-003-v1':'Chapter 3 단어 미니모의 50문항','focus-connectors-v4-100':'연결어 혼합 구별 집중 100제','focus-connectors-v3-100':'전접부 개정 100제','focus-ly-v3-50':'-ly 의미 대비 개정 50제','focus-connectors-v2-100':'전접부 개선 100제','focus-ly-v2-50':'-ly 의미 대비 개선 50제','focus-adj-adv-100':'형용사·부사 기존 100제','focus-adj-adv-v2-100':'형용사·부사 개선 100제','focus-connectors-100':'전치사·접속사·접속부사 100제','focus-ly-50':'-ly 의미 대비 50제','focus-comparison-100':'이전 more/most 100제','focus-forms-100':'이전 어형·뜻 100제','focus-pronouns-100':'이전 대명사·관계사 100제'};
/** Only the authenticated owner is accepted. No public profile or arbitrary member selector. */
export async function recentOwnLearning(q:Queryable,owner:string){const r=await q.query<{at:Date|string;subject:string;set_name:string}>(`SELECT * FROM (
 (SELECT attempted_at at,'토익해변' subject,bank_id set_name FROM hanq.weakness_practice_attempts WHERE user_id=$1 ORDER BY attempted_at DESC LIMIT 20)
 UNION ALL (SELECT created_at,'토익해변','토익 오답 문제풀이' FROM hanq.toeic_cbt_practice_answers WHERE user_id=$1 AND selected_option IS NOT NULL ORDER BY created_at DESC LIMIT 20)
 UNION ALL (SELECT created_at,'역사숲','한국사 문제풀이' FROM hanq.attempts WHERE user_id=$1 AND source<>'import' AND option_id IS NOT NULL ORDER BY created_at DESC LIMIT 20)
 UNION ALL (SELECT final_at,'토익해변','토익 모의고사' FROM hanq.toeic_cbt_runs WHERE user_id=$1 AND status='final' ORDER BY final_at DESC LIMIT 20)
 ) activity ORDER BY at DESC LIMIT 20`,[owner]);return{items:r.rows.map(x=>({at:new Date(x.at).toISOString(),subject:x.subject,setName:sets[x.set_name]||x.set_name})),coverage:'서버에 저장된 최근 문제풀이 · 문항별 제출 포함'};}

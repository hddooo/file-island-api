import type { Queryable } from '../db/db.service';
import { lockOwner } from '../common/owner-lock';
import { QuestionsRepository } from '../questions/questions.repository';
import { examQuestions, type SeedQuestion } from '../questions/catalog-loader';

export interface ManualEntry {
 questionId:string; version?:string; exam:number; number:number; answer:number;
 sourceKey:string; personalReview:Record<string,unknown>; newQuestion?:Record<string,unknown>;
}

/** Caller owns the transaction and the verified source/asset checks. No attempt, score, run or growth writes. */
export async function importBookWrongNotes(q:Queryable,userId:string,entries:ManualEntry[],now:Date) {
 if(!entries.length||entries.length>100)throw new Error('manual_import_size');
 const repo=new QuestionsRepository();
 await lockOwner(q,userId);
 let added=0,alreadyLinked=0,reusedQuestions=0,createdQuestions=0;
 const seen=new Set<string>();
 for(const e of entries){
  if(!/^exam-\d{2}-\d{2}$/.test(e.questionId)||e.questionId!==`exam-${e.exam}-${String(e.number).padStart(2,'0')}`||!Number.isInteger(e.answer)||e.answer<1||e.answer>5||!e.sourceKey||e.sourceKey.length>160||!e.personalReview||typeof e.personalReview!=='object')throw new Error('manual_entry_invalid');
  if(seen.has(e.questionId)){alreadyLinked++;continue;}seen.add(e.questionId);
  let row=(await q.query<SeedQuestion & {version:string;exam_round:number;exam_number:number;option_ids:string[];correct_option_id:string;public_payload:Record<string,unknown>}>('SELECT * FROM hanq.question_versions WHERE question_id=$1 AND is_current',[e.questionId])).rows[0];
  if(row){
   if((e.version&&row.version!==e.version)||row.exam_round!==e.exam||row.exam_number!==e.number||row.correct_option_id!==row.option_ids[e.answer-1])throw new Error('manual_existing_question_mismatch');
   reusedQuestions++;
  }else{
   if(!e.newQuestion)throw new Error('manual_question_missing');
   const items=examQuestions({questions:{[e.questionId]:e.newQuestion}}),item=items[0];
   if(item.examRound!==e.exam||item.examNumber!==e.number||item.correctOptionId!==item.optionIds[e.answer-1])throw new Error('manual_new_question_mismatch');
   if((await q.query('SELECT 1 FROM hanq.question_versions WHERE question_id=$1',[e.questionId])).rowCount)throw new Error('manual_noncurrent_question_requires_review');
   createdQuestions+=await repo.insertMissing(q,items,now);
   await q.query('UPDATE hanq.question_versions SET is_current=true WHERE question_id=$1 AND version=$2',[item.questionId,item.version]);
   row=(await q.query('SELECT * FROM hanq.question_versions WHERE question_id=$1 AND is_current',[e.questionId])).rows[0];
  }
  const image=row.public_payload.image;
  if(typeof image!=='string'||!/^media\/exam(?:-expanded|-book)?\/[A-Za-z0-9_-]+\.webp$/.test(image))throw new Error('manual_asset_path_invalid');
  const result=await q.query('INSERT INTO hanq.manual_wrong_notes(user_id,question_id,version,source_key,review_payload,added_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,question_id) DO NOTHING',[userId,e.questionId,row.version,e.sourceKey,e.personalReview,now]);
  if(result.rowCount)added++;else alreadyLinked++;
 }
 const visible=(await q.query('SELECT question_id FROM hanq.manual_wrong_notes WHERE user_id=$1 AND question_id=ANY($2::text[])',[userId,[...seen]])).rows;
 if(visible.length!==seen.size)throw new Error('manual_import_readback_failed');
 return {added,alreadyLinked,reusedQuestions,createdQuestions,unique:seen.size,attemptsCreated:0};
}

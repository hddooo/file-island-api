import { Injectable } from '@nestjs/common';
import { DbService,type Queryable } from '../db/db.service';
import { AppError } from '../common/app-error';
import { lockOwner } from '../common/owner-lock';
import { NoteDto, MergeDto } from './toeic-notes.dto';
import { teachingExample } from './teaching-examples';
export interface NoteRow {
 id: string; part: string; expression: string; expression_key: string;
 meaning: string; structure: string; example: string; confusion: string;
 translation?:string;part_of_speech?:string;synonyms?:string[];
 source_text: string; source_reference: string; revision: number;
 created_at: Date; updated_at: Date; archived_at?:Date|null;
}
export function expressionKey(s: string): string { return s.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase(); }
export function combine(a: string,b: string): string { return !a ? b : !b || a===b ? a : a+'\n\n'+b; }
export function publicNote(n: NoteRow) { return {id:n.id,part:n.part,expression:n.expression,partOfSpeech:n.part_of_speech||'',synonyms:n.synonyms||[],meaning:n.meaning,sourceText:n.source_text,sourceReference:n.source_reference,revision:n.revision,createdAt:n.created_at,updatedAt:n.updated_at,...teachingExample(n)}; }
const missing=()=>new AppError(404,'note_not_found','Note not found');
const conflict=()=>new AppError(409,'note_conflict','Reload the latest note before editing');
@Injectable()
export class ToeicNotesService {
 constructor(private readonly db: DbService) {}
 private async sharedOwner(q:Queryable){return (await q.query<{owner_id:string}>('SELECT owner_id FROM hanq.toeic_member_notebook WHERE singleton=true')).rows[0]?.owner_id||null;}
 private async requireManager(q:Queryable,userId:string){const owner=await this.sharedOwner(q);if(owner&&owner!==userId)throw new AppError(403,'notebook_read_only','This member notebook is read-only');}
 async list(userId:string){const publishedOwner=await this.sharedOwner(this.db.pool),owner=publishedOwner||userId,canManage=owner===userId;const r=await this.db.pool.query<NoteRow>('SELECT * FROM hanq.toeic_notes WHERE user_id=$1 ORDER BY updated_at DESC,id',[owner]);return{notes:r.rows.filter(n=>!n.archived_at).map(publicNote),archived:canManage?r.rows.filter(n=>!!n.archived_at).map(publicNote):[],visibility:publishedOwner?'members':'private',canManage};}
 async archive(userId:string,id:string,archived:boolean) {return this.db.tx(async q=>{await this.requireManager(q,userId);await lockOwner(q,userId);const r=await q.query<NoteRow>('UPDATE hanq.toeic_notes SET archived_at=CASE WHEN $3 THEN coalesce(archived_at,now()) ELSE NULL END WHERE user_id=$1 AND id=$2 RETURNING *',[userId,id,archived]);if(!r.rows[0])throw missing();return{note:publicNote(r.rows[0]),archived};});}
 async save(userId: string,id: string,d: NoteDto) {
  const key=expressionKey(d.expression);if(!key)throw new AppError(400,'invalid_expression','Expression is required');
  return this.db.tx(async q=>{
   await this.requireManager(q,userId);await lockOwner(q,userId);
   const old=(await q.query<NoteRow>('SELECT * FROM hanq.toeic_notes WHERE user_id=$1 AND id=$2',[userId,id])).rows[0];
   if(old ? old.revision!==d.revision : d.revision!==0)throw conflict();
   const duplicate=await q.query('SELECT id FROM hanq.toeic_notes WHERE user_id=$1 AND part=$2 AND expression_key=$3 AND id<>$4',[userId,d.part,key,id]);
   if(duplicate.rowCount)throw new AppError(409,'duplicate_expression','This expression already exists in this part');
   const r=await q.query<NoteRow>(`INSERT INTO hanq.toeic_notes(user_id,id,part,expression,expression_key,meaning,structure,example,confusion,source_text,source_reference,translation,part_of_speech,synonyms)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,coalesce($12,''),coalesce($13,''),coalesce($14::jsonb,'[]'::jsonb))
    ON CONFLICT(user_id,id) DO UPDATE SET part=EXCLUDED.part,expression=EXCLUDED.expression,expression_key=EXCLUDED.expression_key,meaning=EXCLUDED.meaning,structure=EXCLUDED.structure,example=EXCLUDED.example,confusion=EXCLUDED.confusion,source_text=EXCLUDED.source_text,source_reference=EXCLUDED.source_reference,translation=coalesce($12,toeic_notes.translation),part_of_speech=coalesce($13,toeic_notes.part_of_speech),synonyms=coalesce($14::jsonb,toeic_notes.synonyms),revision=toeic_notes.revision+1,updated_at=now() RETURNING *`,[userId,id,d.part,d.expression.trim(),key,d.meaning,d.structure,d.example,d.confusion,d.sourceText,d.sourceReference,d.translation??null,d.partOfSpeech??null,d.synonyms===undefined?null:JSON.stringify(d.synonyms)]);
   return {note:publicNote(r.rows[0])};
  });
 }
 async merge(userId: string,targetId: string,d: MergeDto) {
  if(targetId===d.sourceId)throw new AppError(400,'same_note','Choose different notes');
  return this.db.tx(async q=>{
   await this.requireManager(q,userId);await lockOwner(q,userId);
   const rows=(await q.query<NoteRow>('SELECT * FROM hanq.toeic_notes WHERE user_id=$1 AND id=ANY($2::uuid[])',[userId,[targetId,d.sourceId]])).rows;
   const target=rows.find(n=>n.id===targetId),source=rows.find(n=>n.id===d.sourceId);
   if(!target||!source)throw missing();
   if(target.revision!==d.targetRevision||source.revision!==d.sourceRevision)throw conflict();
   const fields=['meaning','structure','example','confusion','source_text','source_reference'] as const;
   const merged=fields.map(k=>combine(target[k],source[k]));
   if(merged.some(v=>v.length>6000))throw new AppError(400,'merge_too_long','Shorten notes before merging');
   // Preserve the source expression and part as provenance, including across-part merges.
   const provenance=`${source.expression} (${source.part==='unclassified'?'분류 미지정':'Part '+source.part})${source.part_of_speech&&source.part_of_speech!==target.part_of_speech?' · 형태: '+source.part_of_speech:''}`;
   const translation=combine(target.translation||'',source.translation||'');
   const synonyms=[...new Set([...(target.synonyms||[]),...(source.synonyms||[])])];
   if(synonyms.length>3)throw new AppError(400,'merge_too_many_synonyms','Keep up to three related expressions before merging');
   if(translation.length>6000)throw new AppError(400,'merge_too_long','Shorten translations before merging');
   const ref=combine(merged[5],provenance);if(ref.length>6000)throw new AppError(400,'merge_too_long','Shorten source references before merging');merged[5]=ref;
   const r=await q.query<NoteRow>(`UPDATE hanq.toeic_notes SET meaning=$3,structure=$4,example=$5,confusion=$6,source_text=$7,source_reference=$8,translation=$9,part_of_speech=$10,synonyms=$11::jsonb,revision=revision+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *`,[userId,targetId,...merged,translation,target.part_of_speech||source.part_of_speech||'',JSON.stringify(synonyms)]);
   await q.query('UPDATE hanq.toeic_notes SET archived_at=coalesce(archived_at,now()) WHERE user_id=$1 AND id=$2',[userId,d.sourceId]);
   return {note:publicNote(r.rows[0])};
  });
 }
}

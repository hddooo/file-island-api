import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppError } from '../common/app-error';
import { DbService } from '../db/db.service';
import { TextbookService } from './textbook.service';
import { sequenceNumbersMatch } from './sequence-grading';
import { multipleAnswerDetails } from './multiple-answer-grading';

type Answer = { id: string; text: string };
type Slot = { id: string; answerIds: string[]; answer?: { orderMatters: boolean } };
export type SourceItem = { id: string; kind: string; verification: { status: string }; blanks: (Slot & { parts?: Slot[] })[]; responseSlots?: Slot[]; answers: Answer[]; answer: { text: string; orderMatters: boolean; sequenceTokens?: unknown; sequenceSeparator?: string } };
export type SourceProgress = { position: number; status: 'active' | 'paused' | 'completed'; responses: { itemId: string; values: string[]; correct: boolean }[]; draft: string[] };
export type ProgressMutation = { version: string; revision: number; mutationId: string; action: 'draft' | 'answer' | 'pause'; position: number; values: string[] };
const invalid = () => new AppError(400, 'invalid_source_progress', 'Invalid source progress');
const conflict = () => new AppError(409, 'source_progress_conflict', 'Reload the saved progress before continuing');
const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const normalized = (x: string) => x.normalize('NFC').replace(/\s+/g, '');
export function sourceSlots(item: SourceItem): Slot[] { return item.kind === 'classification' ? item.responseSlots! : item.blanks.flatMap(b => b.parts || [b]); }
export function sourceGrade(item: SourceItem, values: string[]): boolean {
 return sourceSlots(item).every((slot, i) => {
  const value = values[i], expected = slot.answerIds.map(id => item.answers.find(a => a.id === id)!.text);
  if (item.answer.sequenceTokens && normalized(value) === normalized(item.answer.text)) return true;
  if (item.kind === 'sequence') return sequenceNumbersMatch(value,expected);
  if (expected.length>1 && !(slot.answer?.orderMatters ?? item.answer.orderMatters)) return multipleAnswerDetails(value,expected).correct;
  if (expected.length === 1) return normalized(value) === normalized(expected[0]);
  const given = value.split(',').map(normalized), parts = expected.map(normalized);
  if (given.length !== parts.length || given.some(x => !x)) return false;
  if (!(slot.answer?.orderMatters ?? item.answer.orderMatters)) { given.sort(); parts.sort(); }
  return given.every((x, j) => x === parts[j]);
 });
}
export function initialSourceProgress(): SourceProgress { return { position: 0, status: 'active', responses: [], draft: [] }; }
export function applySourceMutation(items: SourceItem[], current: SourceProgress, m: ProgressMutation): SourceProgress {
 if (!m || !['draft', 'answer', 'pause'].includes(m.action) || !Number.isInteger(m.position) || m.position !== current.position
  || !Array.isArray(m.values) || m.values.some(v => typeof v !== 'string' || v.length > 2000)) throw invalid();
 const next: SourceProgress = structuredClone(current), item = items[current.position];
 if (item && (item.verification.status !== 'source-verified')) throw invalid();
 if (!item) { if (m.action !== 'pause' || m.values.length) throw conflict(); return next; }
 if (m.values.length !== sourceSlots(item).length) throw invalid();
 next.draft = m.values;
 if (m.action === 'answer') {
  if (m.values.some(v => !normalized(v))) throw invalid();
  next.responses.push({ itemId: item.id, values: m.values, correct: sourceGrade(item, m.values) });
  next.position++; next.draft = []; next.status = next.position === items.length ? 'completed' : 'active';
 } else next.status = m.action === 'pause' ? 'paused' : 'active';
 return next;
}
export type SourceWorkspace = { cursor: number; status: 'active' | 'paused' | 'completed'; responses: Record<string, { values: string[]; submitted: boolean; correct: boolean | null; checkedSlots?: boolean[] }> };
export type SourceBatch = { version: string; revision: number; mutationId: string; cursor: number; status: 'active' | 'paused'; updates: { itemId: string; values: string[]; submitted: boolean; checkedSlots?: boolean[] }[] };
export function workspaceFromLegacy(progress: SourceProgress, count: number): SourceWorkspace {
 const responses: SourceWorkspace['responses'] = {};
 progress.responses.forEach(r => { responses[r.itemId] = { values: r.values, submitted: true, correct: r.correct, checkedSlots: r.values.map(()=>true) }; });
 return { cursor: Math.min(progress.position, count-1), status: progress.status, responses };
}
export function applySourceBatch(items: SourceItem[], current: SourceWorkspace, batch: SourceBatch): SourceWorkspace {
 if (!Number.isInteger(batch.cursor) || batch.cursor<0 || batch.cursor>=items.length || !['active','paused'].includes(batch.status) || !Array.isArray(batch.updates) || batch.updates.length>items.length) throw invalid();
 const next=structuredClone(current), seen=new Set<string>();
 for(const update of batch.updates) {
  const item=items.find(i=>i.id===update.itemId);
  if(!item || item.verification.status!=='source-verified' || seen.has(update.itemId) || typeof update.submitted!=='boolean' || !Array.isArray(update.values) || update.values.length!==sourceSlots(item).length || update.values.some(v=>typeof v!=='string'||v.length>2000)) throw invalid();
  if(update.checkedSlots!==undefined&&(!Array.isArray(update.checkedSlots)||update.checkedSlots.length!==update.values.length||update.checkedSlots.some(v=>typeof v!=='boolean')))throw invalid();
  seen.add(update.itemId);const checkedSlots=(update.checkedSlots||update.values.map(()=>update.submitted)).map((v,i)=>v&&!!normalized(update.values[i]));const submitted=checkedSlots.every(Boolean)&&update.values.every(v=>!!normalized(v));
  next.responses[item.id]={values:update.values,submitted,correct:submitted?sourceGrade(item,update.values):null,checkedSlots};
 }
 next.cursor=batch.cursor;next.status=batch.status==='paused'?'paused':items.every(i=>next.responses[i.id]?.submitted)?'completed':'active';return next;
}
@Injectable()
export class SourceBlankProgressService {
 constructor(private readonly db: DbService, private readonly textbook: TextbookService) {}
 private async source(id: string) {
  const quiz = await this.textbook.semanticQuiz(id) as Record<string, unknown>;
  const items = quiz.items as SourceItem[];
  return { items, version: digest({ schema: quiz.schemaVersion, source: quiz.source, items }) };
 }
 async get(userId: string, id: string) {
  const { version } = await this.source(id);
  const result = await this.db.pool.query('SELECT revision,progress,updated_at FROM hanq.source_blank_progress WHERE user_id=$1 AND quiz_id=$2 AND source_version=$3', [userId, id, version]);
  const row = result.rows[0];
  return { version, revision: row?.revision || 0, progress: row?.progress || initialSourceProgress(), updatedAt: row?.updated_at || null };
 }
 async save(userId: string, id: string, m: ProgressMutation) {
  const { items, version } = await this.source(id);
  if (!m || m.version !== version || !Number.isInteger(m.revision) || m.revision < 0 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(m.mutationId || '')) throw invalid();
  const hash = digest(m);
  return this.db.tx(async q => {
   // Serializes first insertion and later writes for this account/source, without touching other records.
   await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [userId + ':' + id + ':' + version]);
   const result = await q.query('SELECT revision,progress,mutation_id,mutation_hash,updated_at FROM hanq.source_blank_progress WHERE user_id=$1 AND quiz_id=$2 AND source_version=$3 FOR UPDATE', [userId,id,version]);
   const row = result.rows[0];
   if (row?.mutation_id === m.mutationId) { if (row.mutation_hash !== hash) throw conflict(); return { version, revision: row.revision, progress: row.progress, updatedAt: row.updated_at }; }
   if ((row?.revision || 0) !== m.revision) throw conflict();
   const progress = applySourceMutation(items, row?.progress || initialSourceProgress(), m), revision = m.revision + 1;
   const saved = await q.query(`INSERT INTO hanq.source_blank_progress (user_id,quiz_id,source_version,revision,progress,mutation_id,mutation_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (user_id,quiz_id,source_version) DO UPDATE SET revision=EXCLUDED.revision,progress=EXCLUDED.progress,mutation_id=EXCLUDED.mutation_id,mutation_hash=EXCLUDED.mutation_hash,updated_at=now() RETURNING updated_at`, [userId,id,version,revision,progress,m.mutationId,hash]);
   return { version, revision, progress, updatedAt: saved.rows[0].updated_at };
  });
 }
 private async legacyWorkspace(q: { query: DbService['pool']['query'] }, userId: string, id: string, version: string, count: number) {
  const legacy=await q.query('SELECT progress FROM hanq.source_blank_progress WHERE user_id=$1 AND quiz_id=$2 AND source_version=$3',[userId,id,version]);
  const progress: SourceProgress=legacy.rows[0]?.progress || initialSourceProgress();
  const workspace=workspaceFromLegacy(progress,count);
  if(progress.draft.length && progress.position<count) {
   const {items}=await this.source(id);workspace.responses[items[progress.position].id]={values:progress.draft,submitted:false,correct:null};
  }
  return workspace;
 }
 async getWorkspace(userId: string, id: string) {
  const {items,version}=await this.source(id);
  const result=await this.db.pool.query('SELECT revision,workspace,updated_at FROM hanq.source_blank_workspaces WHERE user_id=$1 AND quiz_id=$2 AND source_version=$3',[userId,id,version]),row=result.rows[0];
  return {version,revision:row?.revision||0,workspace:row?.workspace||await this.legacyWorkspace(this.db.pool,userId,id,version,items.length),updatedAt:row?.updated_at||null};
 }
 async saveWorkspace(userId: string, id: string, m: SourceBatch) {
  const {items,version}=await this.source(id);
  if(!m||m.version!==version||!Number.isInteger(m.revision)||m.revision<0||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(m.mutationId||''))throw invalid();
  const hash=digest(m);
  return this.db.tx(async q=>{
   await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[userId+':'+id+':'+version]);
   const result=await q.query('SELECT revision,workspace,mutation_id,mutation_hash,updated_at FROM hanq.source_blank_workspaces WHERE user_id=$1 AND quiz_id=$2 AND source_version=$3 FOR UPDATE',[userId,id,version]),row=result.rows[0];
   if(row?.mutation_id===m.mutationId){if(row.mutation_hash!==hash)throw conflict();return {version,revision:row.revision,workspace:row.workspace,updatedAt:row.updated_at};}
   if((row?.revision||0)!==m.revision)throw conflict();
   const initial=row?.workspace||await this.legacyWorkspace(q,userId,id,version,items.length),workspace=applySourceBatch(items,initial,m),revision=m.revision+1;
   const saved=await q.query(`INSERT INTO hanq.source_blank_workspaces (user_id,quiz_id,source_version,revision,workspace,mutation_id,mutation_hash) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(user_id,quiz_id,source_version) DO UPDATE SET revision=EXCLUDED.revision,workspace=EXCLUDED.workspace,mutation_id=EXCLUDED.mutation_id,mutation_hash=EXCLUDED.mutation_hash,updated_at=now() RETURNING updated_at`,[userId,id,version,revision,workspace,m.mutationId,hash]);
   return {version,revision,workspace,updatedAt:saved.rows[0].updated_at};
  });
 }

}

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthService } from '../../src/auth/auth.service';
import { JwtAuthGuard } from '../../src/auth/guards';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter';
import type { DbService } from '../../src/db/db.service';
import { History81Controller } from '../../src/textbook/history81.controller';
import { HISTORY81_PDF } from '../../src/textbook/history81-quiz';
import { History81Service } from '../../src/textbook/history81.service';
import type { JoseonScriptService } from '../../src/textbook/joseon-script.service';
import type { GoryeoScriptService } from '../../src/textbook/goryeo-script.service';
import type { OpeningScriptService } from '../../src/textbook/opening-script.service';
import { ScriptHeadersGuard } from '../../src/textbook/joseon-script.controller';
import { TextbookMemberGuard } from '../../src/textbook/textbook-member.guard';
import { TextbookController } from '../../src/textbook/textbook.controller';
import { TextbookService } from '../../src/textbook/textbook.service';
import { applySourceBatch, SourceBlankProgressService, type SourceBatch, type SourceItem, type SourceWorkspace } from '../../src/textbook/source-blank-progress';

const items: SourceItem[] = [1, 2, 3].map((number) => ({
 id: `item-${number}`, kind: 'blank', verification: { status: 'source-verified' },
 blanks: Array.from({ length: number === 2 ? 2 : 1 }, (_, i) => ({ id: `slot-${i}`, answerIds: [`answer-${i}`] })),
 answers: [{ id: 'answer-0', text: 'first' }, { id: 'answer-1', text: 'second' }],
 answer: { text: 'first', orderMatters: true },
}));
const initial = (): SourceWorkspace => ({ cursor: 0, status: 'active', responses: {} });
const batch = (patch: Partial<SourceBatch> = {}): SourceBatch => ({ version: 'synthetic', revision: 0, mutationId: randomUUID(), cursor: 0, status: 'completed', updates: [], ...patch });

test('explicit completion accepts an empty session without inventing responses or mutating its inputs', () => {
 const current = initial(), before = structuredClone(items), result = applySourceBatch(items, current, batch());
 assert.equal(result.status, 'completed');
 assert.deepEqual(result.responses, {});
 assert.deepEqual(current, initial());
 assert.deepEqual(items, before);
});

test('partial completion preserves existing answers, checked masks, drafts and unanswered questions', () => {
 const current = applySourceBatch(items, initial(), batch({ status: 'active', updates: [{ itemId: 'item-1', values: ['wrong'], submitted: true }] }));
 const result = applySourceBatch(items, current, batch({ updates: [{ itemId: 'item-2', values: ['first', ''], submitted: true, checkedSlots: [true, true] }] }));
 assert.equal(result.status, 'completed');
 assert.deepEqual(result.responses['item-1'], current.responses['item-1']);
 assert.deepEqual(result.responses['item-2'], { values: ['first', ''], submitted: false, correct: null, checkedSlots: [true, false] });
 assert.equal(result.responses['item-3'], undefined);
 assert.equal(current.responses['item-2'], undefined);
 const paused = applySourceBatch(items, result, batch({ status: 'paused' }));
 assert.equal(paused.status, 'paused');
 assert.deepEqual(paused.responses, result.responses);
 assert.equal(applySourceBatch(items, paused, batch({ status: 'active' })).status, 'active');
});

test('legacy automatic completion and invalid-status rejection remain unchanged', () => {
 const result = applySourceBatch([items[0]], initial(), batch({ status: 'active', updates: [{ itemId: 'item-1', values: ['first'], submitted: true }] }));
 assert.equal(result.status, 'completed');
 assert.equal(result.responses['item-1'].correct, true);
 for (const status of ['finished', '', null]) assert.throws(() => applySourceBatch(items, initial(), batch({ status: status as SourceBatch['status'] })), { code: 'invalid_source_progress' });
});

type Row = { revision: number; workspace: SourceWorkspace; mutation_id: string; mutation_hash: string; updated_at: string };
function memoryDb() {
 const rows = new Map<string, Row>(), calls: { sql: string; values: unknown[] }[] = [];
 let queue = Promise.resolve();
 const query = async (sql: string, values: unknown[]) => {
  calls.push({ sql, values });
  if (sql.startsWith('SELECT pg_advisory')) return { rows: [] };
  assert(sql.includes('hanq.source_blank_workspaces') || sql.startsWith('SELECT progress FROM hanq.source_blank_progress'));
  const key = JSON.stringify(values.slice(0, 3));
  if (sql.startsWith('SELECT')) {
   assert(sql.includes('WHERE user_id=$1 AND quiz_id=$2 AND source_version=$3'));
   return { rows: sql.includes('hanq.source_blank_progress') ? [] : rows.has(key) ? [structuredClone(rows.get(key))] : [] };
  }
  assert(sql.startsWith('INSERT INTO hanq.source_blank_workspaces'));
  const row = { revision: values[3] as number, workspace: structuredClone(values[4]) as SourceWorkspace, mutation_id: values[5] as string, mutation_hash: values[6] as string, updated_at: '2026-11-10T00:00:00Z' };
  rows.set(key, row);
  return { rows: [{ updated_at: row.updated_at }] };
 };
 const db = { pool: { query }, tx: async <T>(run: (q: { query: typeof query }) => Promise<T>) => {
  const prior = queue; let release!: () => void;
  queue = new Promise<void>(resolve => { release = resolve; }); await prior;
  try { return await run({ query }); } finally { release(); }
 } } as unknown as DbService;
 return { db, rows, calls };
}

test('HTTP generic, revision fallback and scripted workspaces persist incomplete completion with DTO, ownership, CAS and retry protection', async () => {
 const mem = memoryDb();
 const textbook = { semanticQuiz: async (era: string) => ({ schemaVersion: 'synthetic', source: { era }, items }), forRevision: async () => textbook } as unknown as TextbookService;
 const source = new SourceBlankProgressService(mem.db, textbook);
 const history = new History81Service(mem.db, {} as JoseonScriptService, {} as GoryeoScriptService, {} as OpeningScriptService);
 history.quiz = async (_revision, era) => ({ schemaVersion: 'synthetic', version: `synthetic-${era}`, source: { scriptSha256: 'synthetic-source' }, items });
 const tokens = { a: 'synthetic-owner-a-session-123456789', b: 'synthetic-owner-b-session-123456789' };
 const module = await Test.createTestingModule({ controllers: [TextbookController, History81Controller], providers: [
  JwtAuthGuard, TextbookMemberGuard, ScriptHeadersGuard,
  { provide: AuthService, useValue: { authenticate: async (token: string) => { const owner = token === tokens.a ? 'a' : token === tokens.b ? 'b' : null; return owner ? { userId: owner, sessionId: 'fixture' } : null; } } },
  { provide: TextbookService, useValue: textbook }, { provide: SourceBlankProgressService, useValue: source }, { provide: History81Service, useValue: history },
 ] }).compile();
 const app = module.createNestApplication({ logger: false });
 app.useGlobalFilters(new ApiExceptionFilter());
 app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
 await app.init();
 try {
  const req = request(app.getHttpServer());
  for (const route of ['/api/v1/textbook/semantic/workspaces/prehistory', `/api/v1/textbook/revisions/${HISTORY81_PDF}/semantic/workspaces/ancient`, `/api/v1/textbook/revisions/${HISTORY81_PDF}/semantic/workspaces/goryeo`]) {
   const read = async (owner: 'a' | 'b') => (await req.get(route).set('Authorization', `Bearer ${tokens[owner]}`).expect(200).expect('Cache-Control', 'private, no-store')).body;
   const put = (body: object) => req.put(route).set('Authorization', `Bearer ${tokens.a}`).send(body);
   await req.put(route).send(batch()).expect(401);
   const start = await read('a'), other = await read('b');
   assert.equal(start.revision, 0);
   const empty = batch({ version: start.version });
   const first = (await put(empty).expect(200)).body;
   assert.equal(first.workspace.status, 'completed'); assert.deepEqual(first.workspace.responses, {});
   assert.deepEqual((await put(empty).expect(200)).body, first);
   assert.deepEqual(await read('a'), first);
   assert.deepEqual(await read('b'), other);
   await put({ ...empty, status: 'paused' }).expect(409);
   await put({ ...empty, mutationId: randomUUID() }).expect(409);
   for (const patch of [{ status: 'finished' }, { userId: 'b' }, { updates: [{ itemId: 'item-1', values: ['first'], submitted: true, correct: true }] }]) {
    await put({ ...empty, revision: 1, mutationId: randomUUID(), ...patch }).expect(400);
   }
   const incomplete = batch({ version: start.version, revision: 1, updates: [
    { itemId: 'item-1', values: ['wrong'], submitted: true },
    { itemId: 'item-2', values: ['first', ''], submitted: false, checkedSlots: [true, false] },
   ] });
   const saved = (await put({ ...incomplete, ...(route.endsWith('/goryeo') ? { selectedReviewQuestionIds: ['item-2'] } : {}) }).expect(200)).body;
   assert.equal(saved.revision, 2); assert.equal(saved.version, start.version); assert.equal(saved.workspace.status, 'completed');
   assert.equal(saved.workspace.responses['item-1'].correct, false);
   assert.deepEqual(saved.workspace.responses['item-2'], { values: ['first', ''], submitted: false, correct: null, checkedSlots: [true, false] });
   assert.equal(saved.workspace.responses['item-3'], undefined);
   assert.deepEqual((await put({ ...incomplete, ...(route.endsWith('/goryeo') ? { selectedReviewQuestionIds: ['item-2'] } : {}) }).expect(200)).body, saved);
   assert.deepEqual(await read('a'), saved); assert.deepEqual(await read('b'), other);
   const competing = () => put(batch({ version: start.version, revision: 2 }));
   const races = await Promise.all([competing(), competing()]);
   assert.deepEqual(races.map(r => r.status).sort(), [200, 409]);
   const latest = await read('a'); assert.equal(latest.revision, 3);
   if (route.endsWith('/goryeo')) assert.deepEqual(latest.workspace.selectedReviewQuestionIds, ['item-2']);
  }
  assert.equal(mem.rows.size, 3);
  assert(mem.calls.filter(call => call.sql.startsWith('INSERT')).every(call => call.values[0] === 'a'));
 } finally { await app.close(); }
});
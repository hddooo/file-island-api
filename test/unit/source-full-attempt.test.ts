import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthService } from '../../src/auth/auth.service';
import { JwtAuthGuard } from '../../src/auth/guards';
import { AppError } from '../../src/common/app-error';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter';
import { isGrowthReason } from '../../src/profile/growth-history';
import { HISTORY81_PDF } from '../../src/textbook/history81-quiz';
import { History81Service } from '../../src/textbook/history81.service';
import { ScriptHeadersGuard } from '../../src/textbook/joseon-script.controller';
import { SourceAttemptController } from '../../src/textbook/source-attempt.controller';
import { SourceAttemptRepository, type CompleteSourceAttempt, type CompletedSourceAttempt, type SourceAttemptScope } from '../../src/textbook/source-attempt-repository';
import { sourceAttemptXp } from '../../src/textbook/source-attempt-score';
import { gradeFullSourceAttempt, SourceAttemptService, type FullSourceAttempt } from '../../src/textbook/source-attempt.service';
import { applySourceBatch, type SourceItem } from '../../src/textbook/source-blank-progress';
import { TextbookMemberGuard } from '../../src/textbook/textbook-member.guard';
import { TextbookService } from '../../src/textbook/textbook.service';

// Entirely synthetic: no private textbook fixtures, database or production credentials.
const items: SourceItem[] = [1, 2, 3, 4, 5].map(number => ({
  id: `synthetic-${number}`, kind: 'blank', verification: { status: 'source-verified' },
  blanks: [{ id: 'slot', answerIds: ['answer'] }], answers: [{ id: 'answer', text: 'synthetic answer' }],
  answer: { text: 'synthetic answer', orderMatters: true },
}));
const quiz = { schemaVersion: 'synthetic', source: { revision: 'synthetic' }, items };
const version = createHash('sha256').update(JSON.stringify({ schema: quiz.schemaVersion, source: quiz.source, items })).digest('hex');
const body = (patch: Partial<FullSourceAttempt> = {}): FullSourceAttempt => ({
  attemptId: randomUUID(), mode: 'full', status: 'completed', version, gradingVersion: 2,
  responses: items.map(item => ({ itemId: item.id, values: ['synthetic answer'] })), ...patch,
});

test('XP uses exact ratio boundaries, never rounded displayed percentages', () => {
  assert.equal(isGrowthReason('source-full-quiz'), true);
  assert.equal(isGrowthReason('source-full-practice'), false);
  for (const [correct, total, expected] of [[4, 5, 10], [7, 10, 5], [3, 5, 1], [0, 5, 0], [79, 99, 5], [69, 99, 1], [59, 99, 0], [159, 200, 5], [139, 200, 1], [119, 200, 0]]) {
    assert.equal(sourceAttemptXp(correct, total), expected);
  }
  for (const [correct, total] of [[0, 0], [-1, 5], [6, 5], [1.5, 5], [1, 201], [NaN, 5], [1, Infinity]]) {
    assert.throws(() => sourceAttemptXp(correct, total), { code: 'invalid_source_attempt' });
  }
});

test('legacy empty workspace completion remains practice state and cannot become a scored full attempt', () => {
  const workspace = applySourceBatch(items, { cursor: 0, status: 'active', responses: {} }, {
    version, revision: 0, mutationId: randomUUID(), cursor: 0, status: 'completed', updates: [],
  });
  assert.equal(workspace.status, 'completed');
  assert.deepEqual(workspace.responses, {});
  assert.throws(() => gradeFullSourceAttempt(items, version, body({ responses: [] })), { code: 'invalid_source_attempt' });
});

test('full completion grades every authoritative item and leaves input unchanged', () => {
  const input = body(); input.responses[0].values = ['synthetic incorrect'];
  const before = structuredClone({ input, items });
  const grade = gradeFullSourceAttempt(items, version, input);
  assert.deepEqual({ correct: grade.correct, total: grade.total, xp: grade.xpAward }, { correct: 4, total: 5, xp: 10 });
  assert.deepEqual(grade.canonical.map(row => row.correct), [false, true, true, true, true]);
  assert.deepEqual({ input, items }, before);
});

test('every slot of a multi-slot item must be present; a blank slot scores the item wrong; a complete wrong answer scores zero', () => {
  const item: SourceItem = { ...items[0], blanks: [
    { id: 'first-slot', answerIds: ['answer'] }, { id: 'second-slot', answerIds: ['second-answer'] },
  ], answers: [...items[0].answers, { id: 'second-answer', text: 'second synthetic answer' }] };
  const input = body({ responses: [{ itemId: item.id, values: ['synthetic answer', 'second synthetic answer'] }] });
  assert.equal(gradeFullSourceAttempt([item], version, input).correct, 1);
  assert.throws(() => gradeFullSourceAttempt([item], version, { ...input, responses: [{ itemId: item.id, values: ['synthetic answer'] }] }), { code: 'invalid_source_attempt' });
  for (const values of [['synthetic answer', ''], ['synthetic answer', ' \n'], ['', '']]) {
    const blank = gradeFullSourceAttempt([item], version, { ...input, responses: [{ itemId: item.id, values }] });
    assert.deepEqual([blank.correct, blank.total, blank.xpAward], [0, 1, 0], 'unanswered slot counts as wrong');
  }
  const wrong = gradeFullSourceAttempt([item], version, { ...input, responses: [{ itemId: item.id, values: ['synthetic answer', 'wrong'] }] });
  assert.equal(wrong.correct, 0); assert.equal(wrong.total, 1); assert.equal(wrong.xpAward, 0);
});

test('partial, interrupted, practice, forged, duplicate and malformed completions fail before storage', () => {
  const valid = body();
  const invalidBodies: unknown[] = [null, { ...valid, mode: 'practice' }, { ...valid, status: 'paused' },
    { ...valid, version: 'stale' }, { ...valid, gradingVersion: 3 }, { ...valid, attemptId: 'invalid' },
    { ...valid, responses: [] }, { ...valid, responses: valid.responses.slice(1) },
    { ...valid, score: 100 }, { ...valid, xpAward: 10 }, { ...valid, userId: 'another-owner' },
    { ...valid, selectedReviewQuestionIds: [items[0].id] },
    { ...valid, responses: valid.responses.map((row, i) => i === 0 ? { ...row, correct: true } : row) },
    { ...valid, responses: valid.responses.map((row, i) => i === 0 ? valid.responses[1] : row) },
    { ...valid, responses: valid.responses.map((row, i) => i === 0 ? { ...row, itemId: 'unknown' } : row) },
  ];
  for (const values of [[], ['a', 'b'], ['a'.repeat(2001)], [null]]) {
    invalidBodies.push({ ...valid, responses: valid.responses.map((row, i) => i === 0 ? { ...row, values } : row) });
  }
  for (const input of invalidBodies) assert.throws(() => gradeFullSourceAttempt(items, version, input as FullSourceAttempt), { code: 'invalid_source_attempt' });
  // An unanswered question in a submitted full run is recorded as wrong, not rejected.
  for (const values of [[''], [' \t\n']]) {
    const graded = gradeFullSourceAttempt(items, version, { ...valid, responses: valid.responses.map((row, i) => i === 0 ? { ...row, values } : row) });
    assert.equal(graded.correct, items.length - 1);
  }
  for (const roster of [[], [...items, items[0]], items.map((item, i) => i === 0 ? { ...item, verification: { status: 'unverified' } } : item), items.map((item, i) => i === 0 ? { ...item, blanks: [] } : item)]) {
    assert.throws(() => gradeFullSourceAttempt(roster, version, valid), { code: 'invalid_source_attempt' });
  }
});

function harness() {
  const writes: { owner: string; input: CompleteSourceAttempt }[] = [];
  const reads: { owner: string; scope: SourceAttemptScope }[] = [];
  const replays: { owner: string; attemptId: string; hash: Buffer }[] = [];
  const receipts = new Map<string, { hash: Buffer; attempt: CompletedSourceAttempt }>();
  let unavailable = false;
  const source = { unavailable: false, changed: false, reads: 0 };
  // This fake exercises service/API wiring and replay hashing, NOT PostgreSQL transactions or concurrency.
  const fake = {
    replay: async (owner: string, attemptId: string, hash: Buffer) => {
      if (unavailable) throw Object.assign(new Error('synthetic private SQL detail'), { code: '42P01' });
      replays.push({ owner, attemptId, hash });
      const prior = receipts.get(`${owner}:${attemptId}`);
      if (!prior) return null;
      if (!prior.hash.equals(hash)) throw new AppError(409, 'source_attempt_conflict', 'Conflict');
      return { attempt: prior.attempt, replayed: true as const };
    },
    complete: async (owner: string, input: CompleteSourceAttempt) => {
      if (unavailable) throw Object.assign(new Error('synthetic private SQL detail'), { code: '42P01' });
      writes.push({ owner, input });
      const key = `${owner}:${input.attemptId}`, prior = receipts.get(key);
      if (prior) {
        if (!prior.hash.equals(input.payloadHash)) throw new AppError(409, 'source_attempt_conflict', 'Conflict');
        return { attempt: prior.attempt, replayed: true };
      }
      const attempt = { id: input.attemptId, sequence: String(receipts.size + 1), scope: input.scope,
        correct: input.correct, total: input.total, xpAward: sourceAttemptXp(input.correct, input.total),
        scoreXp: sourceAttemptXp(input.correct, input.total), rewarded: sourceAttemptXp(input.correct, input.total) > 0, completedAt: '2026-01-01T00:00:00.000Z' };
      receipts.set(key, { hash: input.payloadHash, attempt });
      return { attempt, replayed: false };
    },
    list: async (owner: string, scope: SourceAttemptScope) => {
      reads.push({ owner, scope });
      const selected = [...receipts].filter(([key, value]) => key.startsWith(`${owner}:`) && JSON.stringify(value.attempt.scope) === JSON.stringify(scope)).map(([, value]) => value.attempt).reverse().slice(0, 5);
      return { items: selected, latest: selected[0] ?? null };
    },
  };
  const textbook = { semanticQuiz: async () => {
    source.reads++;
    if (source.unavailable) throw new AppError(503, 'synthetic_source_unavailable', 'Synthetic source unavailable');
    return source.changed ? { ...quiz, source: { revision: 'synthetic-updated' } } : quiz;
  }, forRevision: async (revision: string) => {
    if (revision !== 'synthetic-revision') throw new AppError(404, 'not_found', 'Unknown revision');
    return textbook;
  } } as unknown as TextbookService;
  const scriptedReads: string[] = [];
  const history = { quiz: async (revision: string, era: string) => { scriptedReads.push(`${revision}:${era}`); return { ...quiz, version }; } } as unknown as History81Service;
  return { service: new SourceAttemptService(fake as unknown as SourceAttemptRepository, textbook, history), writes, reads, replays, receipts, scriptedReads, source, unavailable: () => { unavailable = true; } };
}

test('service canonicalizes response order and UUID casing, binds scopes and never forwards invalid completions', async () => {
  const h = harness(), input = body();
  const first = await h.service.complete('owner-a', 'joseon', input);
  const replay = await h.service.complete('owner-a', 'joseon', { ...input, attemptId: input.attemptId.toUpperCase(), responses: [...input.responses].reverse() });
  assert.equal(first.replayed, false); assert.equal(replay.replayed, true);
  assert.deepEqual(replay.attempt, first.attempt);
  assert(h.writes[0].input.payloadHash.equals(h.replays[1].hash));
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].owner, 'owner-a');
  for (const changed of [{ gradingVersion: 1 }, { responses: input.responses.map((r, i) => i === 0 ? { ...r, values: ['incorrect'] } : r) }]) {
    await assert.rejects(h.service.complete('owner-a', 'joseon', { ...input, ...changed } as FullSourceAttempt), { code: 'source_attempt_conflict' });
  }
  await assert.rejects(h.service.complete('owner-a', 'goryeo', input), { code: 'source_attempt_conflict' });
  await assert.rejects(h.service.complete('owner-a', 'joseon', input, 'synthetic-revision'), { code: 'source_attempt_conflict' });
  const other = await h.service.complete('owner-b', 'joseon', input);
  assert.equal(other.replayed, false);
  const count = h.writes.length;
  await assert.rejects(h.service.complete('owner-a', 'joseon', body({ responses: [] })), { code: 'invalid_source_attempt' });
  await assert.rejects(h.service.complete('owner-a', '../joseon', input), { code: 'invalid_source_attempt' });
  assert.equal(h.writes.length, count);
  await h.service.complete('owner-a', 'joseon', body(), HISTORY81_PDF);
  assert.deepEqual(h.scriptedReads, [`${HISTORY81_PDF}:joseon`]);
  await h.service.list('owner-b', 'joseon', 1, 'synthetic-revision');
  assert.deepEqual(h.reads.at(-1), { owner: 'owner-b', scope: { quizId: 'joseon', sourceVersion: version, gradingVersion: 1, sourceRevision: 'synthetic-revision' } });
});

test('exact owned receipt replays after source update or outage without regrading or storing another completion', async () => {
  const h = harness(), input = body();
  const first = await h.service.complete('owner-a', 'joseon', input);
  assert.equal(h.source.reads, 1);
  h.source.changed = true;
  const changedSourceReplay = await h.service.complete('owner-a', 'joseon', input);
  assert.equal(changedSourceReplay.replayed, true);
  assert.deepEqual(changedSourceReplay.attempt, first.attempt);
  assert.equal(h.source.reads, 1);
  await assert.rejects(h.service.complete('owner-a', 'joseon', body()), { code: 'invalid_source_attempt' });
  h.source.unavailable = true;
  const reads = h.source.reads;
  const outageReplay = await h.service.complete('owner-a', 'joseon', { ...input, responses: [...input.responses].reverse() });
  assert.equal(outageReplay.replayed, true); assert.deepEqual(outageReplay.attempt, first.attempt);
  await assert.rejects(h.service.complete('owner-a', 'joseon', { ...input, responses: input.responses.map((row, i) => i === 0 ? { ...row, values: ['changed'] } : row) }), { code: 'source_attempt_conflict' });
  assert.equal(h.source.reads, reads);
  assert.equal(h.writes.length, 1);
  await assert.rejects(h.service.complete('owner-b', 'joseon', input), { code: 'synthetic_source_unavailable' });
  assert.equal(h.writes.length, 1);
});

test('HTTP guards, DTOs, owner and revision scope, retry hashes and missing-schema redaction', async () => {
  const h = harness();
  const tokens = { a: 'synthetic-owner-a-session-123456789', b: 'synthetic-owner-b-session-123456789' };
  const module = await Test.createTestingModule({ controllers: [SourceAttemptController], providers: [
    JwtAuthGuard, TextbookMemberGuard, ScriptHeadersGuard,
    { provide: AuthService, useValue: { authenticate: async (token: string) => token === tokens.a ? { userId: 'owner-a', sessionId: 'synthetic' } : token === tokens.b ? { userId: 'owner-b', sessionId: 'synthetic' } : null } },
    { provide: SourceAttemptService, useValue: h.service },
  ] }).compile();
  const app = module.createNestApplication({ logger: false });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  await app.init();
  try {
    const req = request(app.getHttpServer()), route = '/api/v1/textbook/semantic/full-attempts/joseon';
    const post = (value: unknown, path = route) => req.post(path).set('Authorization', `Bearer ${tokens.a}`).send(value as object);
    await req.post(route).send(body()).expect(401).expect('Cache-Control', 'private, no-store');
    await req.get(route).expect(401).expect('Cache-Control', 'private, no-store');
    const invalid = body();
    for (const patch of [{ mode: 'practice' }, { status: 'active' }, { status: 'paused' }, { gradingVersion: '2' }, { gradingVersion: null }, { userId: 'owner-b' }, { correct: 5 }, { xpAward: 10 }, { completedAt: '2099-01-01' }, { selectedReviewQuestionIds: [items[0].id] }, { responses: [] }, { responses: invalid.responses.map(row => ({ ...row, correct: true })) }]) {
      await post({ ...invalid, ...patch }).expect(400);
    }
    assert.equal(h.writes.length, 0);
    const input = body(), first = (await post(input).expect(201).expect('Cache-Control', 'private, no-store')).body;
    assert.equal(first.replayed, false); assert.equal(first.attempt.xpAward, 10);
    const replay = (await post({ ...input, responses: [...input.responses].reverse() }).expect(201)).body;
    assert.equal(replay.replayed, true); assert.deepEqual(replay.attempt, first.attempt);
    await post({ ...input, responses: input.responses.map((row, i) => i === 0 ? { ...row, values: ['incorrect'] } : row) }).expect(409);
    const ownerGet = await req.get(route + '?gradingVersion=2').set('Authorization', `Bearer ${tokens.a}`).expect(200);
    assert.equal(ownerGet.body.latest.id, input.attemptId);
    const otherGet = await req.get(route + '?gradingVersion=2').set('Authorization', `Bearer ${tokens.b}`).expect(200);
    assert.deepEqual(otherGet.body, { items: [], latest: null });
    await req.get(route + '?gradingVersion=3').set('Authorization', `Bearer ${tokens.a}`).expect(400);
    const revised = '/api/v1/textbook/revisions/synthetic-revision/semantic/full-attempts/joseon';
    await post(body(), revised).expect(201);
    assert.equal(h.writes.at(-1)?.input.scope.sourceRevision, 'synthetic-revision');
    await post(body(), '/api/v1/textbook/revisions/unknown/semantic/full-attempts/joseon').expect(404);
    h.unavailable();
    const stopped = await post(body()).expect(503);
    assert.equal(stopped.body.error.code, 'schema_not_ready');
    assert(!JSON.stringify(stopped.body).includes('SQL'));
  } finally { await app.close(); }
});

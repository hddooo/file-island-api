import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validate} from 'class-validator';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DbService} from '../../src/db/db.service';
import {FocusAnswerDto, focusBank, VOCABULARY_MINI_BANKS, WeaknessPracticeService} from '../../src/toeic-notes/weakness-practice';

test('three chapter banks use separate bounded question namespaces', async () => {
  for (const bank of VOCABULARY_MINI_BANKS) {
    assert.equal(focusBank(bank), bank);
    for (const number of [1, 50]) {
      const dto = Object.assign(new FocusAnswerDto(), {eventId: randomUUID(), questionId: bank + '-q' + String(number).padStart(3, '0'), version: 1, selected: 0, attemptedAt: '2026-10-25T12:00:00Z'});
      assert.equal((await validate(dto)).length, 0);
    }
    const invalid = Object.assign(new FocusAnswerDto(), {questionId: bank + '-q051'});
    assert((await validate(invalid)).some(e => e.property === 'questionId'));
  }
  assert.throws(() => focusBank('vocab-mini-004-v1'), /Unknown practice set/);
});

test('each chapter keeps its own first-result key and 50-question denominator', async () => {
  const saved = new Map<string, unknown>();
  const db = {pool: {query: async (sql: string, args: unknown[]) => {
    const key = String(args[0]) + ':' + String(args[1]);
    if (sql.startsWith('SELECT DISTINCT')) return {rows: []};
    if (sql.startsWith('SELECT result')) return {rows: saved.has(key) ? [{result: saved.get(key)}] : []};
    if (sql.startsWith('INSERT INTO hanq.weakness_practice_results')) {
      assert(!saved.has(key)); saved.set(key, JSON.parse(String(args[2]))); return {rows: []};
    }
    throw Error('Unexpected fixture query');
  }}} as unknown as DbService;
  const service = new WeaknessPracticeService(db, {now: () => new Date('2026-10-25T12:00:00Z')}, true);
  for (const bank of VOCABULARY_MINI_BANKS) {
    const result = await service.finish('synthetic-owner', bank, {questionIds: []});
    assert.equal((result.firstResult as {unanswered: number}).unanswered, 50);
    assert.deepEqual(await service.finish('synthetic-owner', bank, {questionIds: []}), result);
    assert.equal((await service.progress('another-synthetic-owner', bank)).firstResult, null);
  }
  assert.equal(saved.size, 3);
});

test('new migration retains all previously accepted banks without touching attempt rows', () => {
  const prior = readFileSync('migrations/038_vocabulary_mini.sql', 'utf8');
  const next = readFileSync('migrations/039_vocabulary_mini_chapters.sql', 'utf8');
  for (const match of prior.matchAll(/'([^']+)'/g)) assert(next.includes(match[0]));
  for (const bank of VOCABULARY_MINI_BANKS) assert(next.includes("'" + bank + "'"));
  assert(!/\b(?:DELETE|TRUNCATE|UPDATE|DROP TABLE)\b/i.test(next));
});


test('own recent learning identifies each chapter without exposing internal set IDs', async () => {
  const {recentOwnLearning} = await import('../../src/profile/recent-own-learning');
  const query = {query: async () => ({rows: VOCABULARY_MINI_BANKS.map(bank => ({at: '2026-10-25T12:00:00Z', subject: '토익해변', set_name: bank}))})};
  const result = await recentOwnLearning(query as unknown as import('../../src/db/db.service').Queryable, 'synthetic-owner');
  assert.deepEqual(result.items.map(x => x.setName), [1, 2, 3].map(n => `Chapter ${n} 단어 미니모의 50문항`));
});

import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { statsOf, UNKNOWN_PART } from '../../src/cbt/cbt-policy';
import { projectRoot } from '../../src/common/project-root';
import { CatalogError, examQuestions, loadFrontCatalog, parseGlobalAssignment, quizQuestions } from '../../src/questions/catalog-loader';

const FRONT = resolve(projectRoot(), process.env.HANQ_FRONT_DIR?.trim() || '../hanq_front');
const items = loadFrontCatalog(FRONT);
const rawQuiz = parseGlobalAssignment(readFileSync(join(FRONT, 'media', 'quiz-catalog.js'), 'utf8'), 'HANQ_QUIZ_CATALOG') as { questions: Record<string, Record<string, unknown>> };
const rawRecall = parseGlobalAssignment(readFileSync(join(FRONT, 'media', 'era-recall-quiz.js'), 'utf8'), 'HANQ_ERA_RECALL_QUIZ') as { questions: Record<string, Record<string, unknown>> };
const rawExam = parseGlobalAssignment(readFileSync(join(FRONT, 'media', 'exam-pool.js'), 'utf8'), 'HANQ_EXAM_POOL') as { questions: Record<string, Record<string, unknown>> };

const rawReviewed = parseGlobalAssignment(readFileSync(join(FRONT,'media','reviewed-quiz.js'),'utf8'),'HANQ_REVIEWED_QUIZ') as {questions:Record<string,Record<string,unknown>>};
const reviewedCount=Object.keys(rawReviewed.questions).length;

/** Keys that carry or reveal the answer/explanation anywhere in a pre-grade payload. */
const FORBIDDEN = new Set(['answer', 'a', 'compound', 'correct', 'review', 'why', 'cue', 'overview', 'legacy', 'sources', 'source', 'dedup', 'rv', 'flags', 'kind', 'duplicateOf']);

function forbiddenKeys(x: unknown, path = ''): string[] {
  if (Array.isArray(x)) return x.flatMap((v, i) => forbiddenKeys(v, `${path}[${i}]`));
  if (x && typeof x === 'object') {
    return Object.entries(x as Record<string, unknown>).flatMap(([k, v]) => [...(FORBIDDEN.has(k) ? [`${path}.${k}`] : []), ...forbiddenKeys(v, `${path}.${k}`)]);
  }
  return [];
}

describe('catalog seed source (real front data, parsed without executing it)', () => {
  it('rejects an incomplete unified snapshot or unknown selection before any seed writes',()=>{
    const dir=mkdtempSync(join(tmpdir(),'hanq-scope-catalog-'));
    try {mkdirSync(join(dir,'media'));for(const f of ['quiz-catalog.js','exam-pool.js','unified-quiz-selection.js'])copyFileSync(join(FRONT,'media',f),join(dir,'media',f));
      assert.throws(()=>loadFrontCatalog(dir),/requires media\/era-recall-quiz/);
      copyFileSync(join(FRONT,'media','era-recall-quiz.js'),join(dir,'media','era-recall-quiz.js'));
      copyFileSync(join(FRONT,'media','reviewed-quiz.js'),join(dir,'media','reviewed-quiz.js'));
      assert.equal(loadFrontCatalog(dir).length,1490+reviewedCount);
      writeFileSync(join(dir,'media','unified-quiz-selection.js'),'window.HANQ_UNIFIED_QUIZ_SELECTION= {"eras":{"goryeo":["unknown-id"]}};');
      assert.throws(()=>loadFrontCatalog(dir),/unknown or duplicate/);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });

  it('keeps the 18 comprehensive original questions out of period statistics', () => {
    const originals = items.filter((q) => q.kind === 'mock');
    const stats = statsOf(originals.map((q, position) => ({ position, era: q.era, part: UNKNOWN_PART, points: q.points, answered: false, correct: false })));
    assert.equal(originals.length, 500);
    assert.equal(originals.filter((q) => q.era === 'comprehensive').length, 18);
    assert.equal(stats.eras.excluded.count, 18);
    assert.equal(stats.eras.buckets.reduce((n, b) => n + b.total, 0), 482);
    assert.ok(stats.eras.buckets.every((b) => b.key !== 'comprehensive' && b.wrongRate === 1));
    assert.equal(stats.parts.buckets.reduce((n, b) => n + b.total, 0), 500);
  });

  it('preserves703quiz items, adds287source-learning items and keeps500exam items with stable ids and versions', () => {
    const quiz = items.filter((q) => q.kind === 'quiz'), mock = items.filter((q) => q.kind === 'mock');
    assert.equal(Object.keys(rawQuiz.questions).length,703);
    assert.equal(Object.keys(rawRecall.questions).length,287);
    assert.equal(quiz.length, Object.keys(rawQuiz.questions).length+Object.keys(rawRecall.questions).length+reviewedCount);
    assert.equal(quiz.length,990+reviewedCount);
    assert.equal(mock.length, 500);
    for (const q of items) {
      const raw = q.kind === 'quiz' ? rawQuiz.questions[q.questionId] ?? rawRecall.questions[q.questionId] ?? rawReviewed.questions[q.questionId] : rawExam.questions[q.questionId];
      assert.equal(q.version, String(raw.v));
      assert.deepEqual(q.optionIds, (raw.options as { id: string }[]).map((o) => o.id));
      assert.equal(q.correctOptionId, (raw.options as { id: string; correct?: boolean }[]).find((o) => o.correct)!.id);
    }
  });

  it('no pre-grade public payload contains an answer-bearing key (all1490items)', () => {
    const leaks = items.flatMap((q) => forbiddenKeys(q.publicPayload).map((p) => q.questionId + p));
    assert.deepEqual(leaks, []);
  });

  it('public options are exactly {id, text}', () => {
    for (const q of items) {
      for (const o of q.publicPayload.options as Record<string, unknown>[]) assert.deepEqual(Object.keys(o).sort(), ['id', 'text'], q.questionId);
    }
  });

  it('regression: composite answers stored in `compound` never reach the public payload', () => {
    const withCompound = Object.values(rawQuiz.questions).filter((r) => r.compound != null);
    assert.equal(withCompound.length, 11, 'the real catalog has 11 compound items (the regression must stay meaningful)');
    const byId = new Map(items.map((q) => [q.questionId, q]));
    for (const r of withCompound) {
      const pub = JSON.stringify(byId.get(String(r.id))!.publicPayload);
      assert.ok(!pub.includes('"compound"'), String(r.id));
      assert.ok(!pub.includes(JSON.stringify(r.compound)), String(r.id));
    }
    const ex = rawQuiz.questions['legacy-joseon-late-012'];
    if (ex) {
      assert.ok(ex.compound != null);
      assert.equal(byId.get('legacy-joseon-late-012')!.publicPayload.compound, undefined);
    }
  });

  it('the full original item is kept only for post-grade review', () => {
    const q = items.find((x) => x.kind === 'quiz')!;
    assert.deepEqual(q.reviewPayload, rawQuiz.questions[q.questionId]);
    const e = items.find((x) => x.kind === 'mock')!;
    assert.deepEqual(e.reviewPayload, rawExam.questions[e.questionId]);
  });

  it('exam items keep images, era and the shared material image of 72-47/72-48', () => {
    const e = items.find((x) => x.questionId === 'exam-72-47')!;
    assert.equal(typeof e.publicPayload.image, 'string');
    assert.match(String(e.publicPayload.commonImage), /^media\/exam-expanded\/72-common47-48\.webp$/);
    assert.equal(typeof e.publicPayload.era, 'string');
    assert.equal(e.examRound, 72);
    assert.equal(e.examNumber, 47);
  });

  it('rejects structurally broken catalogs instead of seeding them', () => {
    assert.throws(() => parseGlobalAssignment('window.HANQ_QUIZ_CATALOG=alert(1);', 'HANQ_QUIZ_CATALOG'), CatalogError);
    const two = { questions: { q1: { id: 'q1', v: '1', options: [{ id: 'o1', text: 'A', correct: true }, { id: 'o2', text: 'B', correct: true }] } } };
    assert.throws(() => quizQuestions(two), /exactly one correct/);
    const badExam = { questions: { 'exam-70-01': { id: 'exam-70-01', v: '1', exam: 70, number: 1, points: 2, answer: 2, options: [1, 2, 3, 4, 5].map((k) => ({ id: `exam-70-01-option-${k}`, text: '①', correct: k === 1 })) } } };
    assert.throws(() => examQuestions(badExam), /disagree/);
  });
});

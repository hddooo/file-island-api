import assert from 'node:assert/strict';
import { it } from 'node:test';
import { cbtExamResult, studyExamResult } from '../../src/profile/exam-result';
import { resultOf } from '../../src/cbt/cbt-policy';
import { summarize } from '../../src/wrong-notes/runs.service';
import { studyReward } from '../../src/wrong-notes/study-policy';

/** The stored wrong-note challenge score exactly as RunsService.finalize writes it (summarize + examScore/growthReward). */
function studyScore(correct: number, questions = 20) {
  const s = summarize(Array.from({ length: questions }, (_, i) => ({ pointsKind: 'official', points: 2, answered: true, correct: i < correct })));
  const examScore = Math.round((correct * 100) / questions);
  return Object.assign(s, { examScore, growthReward: studyReward(examScore), rewardEligible: true });
}
/** A stored CBT result exactly as cbt-policy resultOf builds it (50 items, original weights summing to 100). */
function cbtResult(correctPositions: number[]) {
  const items = Array.from({ length: 50 }, (_, i) => ({ position: i, points: i < 50 ? 2 : 0, answered: true, correct: correctPositions.includes(i), era: null, part: '기타' }));
  return JSON.parse(JSON.stringify(resultOf(75, items as never, 'submit', new Date('2026-10-09T03:00:00.000Z'))));
}

it('wrong-note challenge: 45/100 with 9/20 correct is shown next to the -100 deduction', () => {
  const s = studyScore(9);
  assert.deepEqual(studyExamResult(s, -100), { score: 45, maxScore: 100, correct: 9, total: 20 });
});

it('wrong-note challenge: high positive and zero scores are valid stored results', () => {
  assert.deepEqual(studyExamResult(studyScore(19), 200), { score: 95, maxScore: 100, correct: 19, total: 20 });
  assert.deepEqual(studyExamResult(studyScore(0), -100), { score: 0, maxScore: 100, correct: 0, total: 20 });
  assert.deepEqual(studyExamResult(studyScore(13), 50), { score: 65, maxScore: 100, correct: 13, total: 20 });
});

it('wrong-note challenge: missing legacy or malformed stored data never produces a score', () => {
  assert.equal(studyExamResult(null, -100), null, 'legacy/unfinished run: no stored score');
  assert.equal(studyExamResult(undefined, 50), null);
  assert.equal(studyExamResult([], 50), null);
  const base = studyScore(9);
  const bad: Record<string, unknown>[] = [
    { ...base, examScore: undefined }, // stored before examScore existed: no guessing from correct/questions
    { ...base, examScore: 46 }, // disagrees with correct/questions
    { ...base, examScore: '45' },
    { ...base, examScore: 45.5 },
    { ...base, examScore: 101 },
    { ...base, correct: 21 },
    { ...base, correct: -1 },
    { ...base, questions: 0 },
    { ...base, questions: 20.5 },
    { ...base, growthReward: 50 }, // reward not matching the band
    { ...base, rewardEligible: false }, // not a challenge run
  ];
  for (const s of bad) assert.equal(studyExamResult(s, -100), null, JSON.stringify(s).slice(0, 80));
  assert.equal(studyExamResult(base, 50), null, 'stored reward must equal the ledger amount');
});

it('CBT final result: weighted score/correct/total from the stored result, matching the ledger amount', () => {
  const r = cbtResult(Array.from({ length: 41 }, (_, i) => i)); // 41 × 2 = 82 → +150
  assert.equal(r.growthReward, 150);
  assert.deepEqual(cbtExamResult(r, 150), { score: 82, maxScore: 100, correct: 41, total: 50 });
  const low = cbtResult([0, 1, 2]);
  assert.deepEqual(cbtExamResult(low, -100), { score: 6, maxScore: 100, correct: 3, total: 50 });
  assert.deepEqual(cbtExamResult(cbtResult([]), -100), { score: 0, maxScore: 100, correct: 0, total: 50 });
});

it('CBT: inconsistent, out-of-range or missing stored results are not shown', () => {
  const r = cbtResult(Array.from({ length: 41 }, (_, i) => i));
  assert.equal(cbtExamResult(null, 150), null);
  assert.equal(cbtExamResult(r, 200), null, 'ledger amount must match');
  for (const patch of [{ score: 101 }, { score: -1 }, { score: '82' }, { maxScore: 50 }, { total: 20 }, { correct: 51 }, { growthReward: 200 }, { correct: 0 }, { correct: 50 }]) {
    assert.equal(cbtExamResult({ ...r, ...patch }, 150), null, JSON.stringify(patch));
  }
});

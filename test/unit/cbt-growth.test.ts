import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cbtReward, resultOf, type GradedItem } from '../../src/cbt/cbt-policy';

describe('CBT final-score growth (migration 009): bands on the original weighted score', () => {
  it('every band boundary', () => {
    const expect: [number, number][] = [[0, -100], [59, -100], [60, 50], [69, 50], [70, 100], [79, 100], [80, 150], [89, 150], [90, 200], [100, 200]];
    for (const [score, reward] of expect) assert.equal(cbtReward(score), reward, String(score));
  });
  it('rejects scores that cannot come from a 100-point round', () => {
    for (const bad of [-1, 101, 59.5, NaN]) assert.throws(() => cbtReward(bad));
  });
  it('the result uses the weighted raw sum (1–3 point items), not the count of correct answers', () => {
    // 50 items: 25 × 3 points + 25 × 1 point = 100. Answer only the 3-point ones → 25/50 correct but 75 points.
    const items: GradedItem[] = Array.from({ length: 50 }, (_, k) => ({ position: k, era: 'modern', part: 'x', points: k < 25 ? 3 : 1, answered: k < 25, correct: k < 25 }));
    const r = resultOf(79, items, 'submit', new Date('2026-10-09T00:00:00Z'));
    assert.equal(r.maxScore, 100);
    assert.equal(r.correct, 25);
    assert.equal(r.score, 75);
    assert.equal(r.growthReward, 100, '75 points → 70–79 band, although only half the questions were right');
    const flipped = items.map((i) => ({ ...i, answered: i.points === 1, correct: i.points === 1 }));
    const f = resultOf(79, flipped, 'expired', new Date('2026-10-09T00:00:00Z'));
    assert.equal(f.correct, 25);
    assert.equal(f.score, 25);
    assert.equal(f.growthReward, -100);
  });
});

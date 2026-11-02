import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isMixedEra, isRecognizedEra, RECOGNIZED_ERAS, resultOf, statsOf, type GradedItem } from '../../src/cbt/cbt-policy';

const item = (position: number, era: string | null, part: string, points: number, answered: boolean, correct: boolean): GradedItem =>
  ({ position, era, part, points, answered, correct });

describe('cbt-policy era statistics', () => {
  it('recognizes exactly the ten periods', () => {
    assert.deepEqual([...RECOGNIZED_ERAS], ['prehistory', 'gojoseon', 'samguk', 'nambuk', 'goryeo', 'joseon-early', 'joseon-late', 'opening', 'colonial', 'modern']);
    for (const e of RECOGNIZED_ERAS) {
      assert.equal(isRecognizedEra(e), true, e);
      assert.equal(isMixedEra(e), false, e);
    }
    for (const e of ['comprehensive', 'mixed', null, 'unknown', 'islands', 'joseon', 'modern-x', 'Goryeo', '']) {
      assert.equal(isMixedEra(e), true, String(e));
    }
  });

  it('excludes comprehensive/mixed/null/unknown/related-topic eras with count, positions and reason', () => {
    const items = [
      item(0, 'goryeo', '정치', 2, true, true),
      item(1, 'goryeo', '정치', 2, true, false),
      item(2, 'goryeo', '문화', 2, false, false),
      item(3, 'comprehensive', '문화', 3, true, true),
      item(4, 'mixed', '정치', 1, true, false),
      item(5, null, '경제', 2, false, false),
      item(6, 'unknown-era', '경제', 2, true, true),
      item(7, 'islands', '경제', 2, true, true),
      item(8, 'colonial', '사회', 3, true, true),
    ];
    const s = statsOf(items);
    assert.deepEqual(s.eras.buckets.map((b) => b.key), ['goryeo', 'colonial']);
    assert.deepEqual(s.eras.excluded, { count: 5, positions: [3, 4, 5, 6, 7], reason: 'mixed_or_unknown_era' });
    const g = s.eras.buckets.find((b) => b.key === 'goryeo')!;
    // unanswered counts as wrong; the denominator is the era total
    assert.deepEqual(g, { key: 'goryeo', total: 3, correct: 1, wrong: 2, answered: 2, unanswered: 1, wrongRate: 2 / 3 });
    assert.equal(s.eras.buckets.find((b) => b.key === 'colonial')!.wrongRate, 0);
  });

  it('every item comprehensive → no era buckets, all excluded', () => {
    const s = statsOf([item(0, 'comprehensive', '정치', 2, true, true), item(1, 'comprehensive', '정치', 2, false, false)]);
    assert.deepEqual(s.eras.buckets, []);
    assert.equal(s.eras.excluded.count, 2);
  });

  it('era exclusion does not affect score, counts or parts', () => {
    const base = [item(0, 'goryeo', '정치', 3, true, true), item(1, 'samguk', '문화', 2, true, false), item(2, 'nambuk', '정치', 1, false, false)];
    const relabeled = base.map((i, k) => ({ ...i, era: k === 0 ? 'comprehensive' : k === 1 ? null : 'mixed' }));
    const at = new Date('2026-10-09T00:00:00Z');
    const a = resultOf(79, base, 'submit', at), b = resultOf(79, relabeled, 'submit', at);
    for (const k of ['score', 'maxScore', 'correct', 'wrong', 'unanswered', 'answered', 'grade', 'passed', 'total'] as const) assert.deepEqual(b[k], a[k], k);
    assert.equal(a.score, 3);
    assert.equal(a.wrong, 1);
    assert.equal(a.unanswered, 1);
    assert.deepEqual(b.stats.parts, a.stats.parts);
    const p = a.stats.parts.buckets.find((x) => x.key === '정치')!;
    assert.deepEqual(p, { key: '정치', total: 2, correct: 1, wrong: 1, answered: 1, unanswered: 1, wrongRate: 1 / 2 });
    assert.equal(a.stats.eras.excluded.count, 0);
    assert.deepEqual(b.stats.eras.excluded.positions, [0, 1, 2]);
  });
});

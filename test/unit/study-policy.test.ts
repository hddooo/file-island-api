import assert from 'node:assert/strict';
import { it } from 'node:test';
import { COOLDOWN_MS, isStudyEligible, kstDate, selectStudy, STUDY_POLICY, studyEligibleAt, studyReward, studyWeight } from '../../src/wrong-notes/study-policy';

/** Deterministic PRNG (mulberry32) so the statistical checks are reproducible. */
function prng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return (((t ^ (t >>> 14)) >>> 0) + 1) / 4294967297; }; }
const NOW = new Date('2026-10-09T03:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const DAY = 86_400_000;
const share = (pool: { question_id: string; wrong_count: number; last_wrong_at?: Date | null }[], exposures: Map<string, number>, id: string, n = 6000, seed = 7) => {
  const r = prng(seed); let hit = 0; for (let i = 0; i < n; i++) if (selectStudy(pool, exposures, 1, NOW, r)[0].question_id === id) hit++; return hit / n;
};

it('reward challenge remains 20 questions/30 minutes; repeat practice has no cooldown', () => {
  assert.equal(STUDY_POLICY.size,20);assert.equal(STUDY_POLICY.durationMs,1800000);
  assert.deepEqual(STUDY_POLICY.correctIntervalsDays,[1,3,7]);assert.equal(COOLDOWN_MS,0);
});
it('correct and wrong answers are immediately eligible across former boundaries and KST midnight',()=>{
  for(const correct of [true,false]) for(const days of [0,1,3,7]) {
    const at=studyEligibleAt({lastCorrectAt:NOW,latestCorrect:correct,nextReviewAt:new Date(NOW.getTime()+days*DAY)});
    assert.equal(at,null);
    for(const offset of [0,1,23*3600000+59*60000,DAY])assert.equal(isStudyEligible(at,new Date(NOW.getTime()+offset)),true);
  }
  assert.equal(studyEligibleAt({lastCorrectAt:null,latestCorrect:false,nextReviewAt:null}),null);
  const lastCorrectAt=new Date('2026-10-08T14:59:00Z');
  const now=new Date('2026-10-08T15:01:00Z');assert.notEqual(kstDate(lastCorrectAt),kstDate(now));
  assert.equal(isStudyEligible(studyEligibleAt({lastCorrectAt,latestCorrect:true,nextReviewAt:new Date(now.getTime()+7*DAY)}),now),true);
});

it('weights are monotonic: more mistakes ↑, more recent mistake ↑, more exposures ↓, bounded unseen boost', () => {
  const w = (wrong: number, ageDays: number, exp: number) => studyWeight({ wrong_count: wrong, last_wrong_at: ago(ageDays * DAY) }, exp, NOW);
  for (let k = 0; k < 7; k++) assert.ok(w(k + 1, 3, 1) >= w(k, 3, 1), 'frequency ' + k);
  assert.equal(w(5, 3, 1), w(50, 3, 1), 'frequency capped');
  for (const d of [0, 1, 5, 10, 13]) assert.ok(w(2, d, 1) >= w(2, d + 1, 1), 'recency ' + d);
  assert.equal(w(2, 14, 1), w(2, 400, 1), 'recency boost fades out after 14 days');
  for (let e = 1; e < 8; e++) assert.ok(w(2, 3, e) > w(2, 3, e + 1), 'exposure ' + e);
  assert.ok(w(2, 3, 0) > w(2, 3, 1));
  assert.ok(w(2, 3, 0) / w(2, 3, 1) <= 2.25 + 1e-9, 'unseen boost is bounded (not an absolute first tier)');
});

it('sampling without replacement never duplicates and returns at most the pool', () => {
  const pool = Array.from({ length: 30 }, (_, i) => ({ question_id: 'q' + i, wrong_count: 1 + (i % 4), last_wrong_at: ago(i * DAY) }));
  const r = prng(1);
  for (let k = 0; k < 50; k++) { const s = selectStudy(pool, new Map(), 20, NOW, r); assert.equal(s.length, 20); assert.equal(new Set(s.map((x) => x.question_id)).size, 20); }
  assert.equal(selectStudy(pool.slice(0, 3), new Map(), 20, NOW, r).length, 3);
});

it('statistics: frequent mistakes are chosen more often in proportion to their weight', () => {
  const pool = [{ question_id: 'low', wrong_count: 1, last_wrong_at: ago(30 * DAY) }, { question_id: 'high', wrong_count: 5, last_wrong_at: ago(30 * DAY) }];
  const p = share(pool, new Map([['low', 1], ['high', 1]]), 'high'); // weights 2 vs 6 → expected 0.75
  assert.ok(p > 0.72 && p < 0.78, String(p));
});

it('statistics: a recent mistake is favoured over an old one with the same count', () => {
  const pool = [{ question_id: 'old', wrong_count: 2, last_wrong_at: ago(30 * DAY) }, { question_id: 'new', wrong_count: 2, last_wrong_at: ago(0) }];
  const p = share(pool, new Map([['old', 1], ['new', 1]]), 'new'); // 1.5 vs 1 → expected 0.6
  assert.ok(p > 0.57 && p < 0.63, String(p));
});

it('statistics: frequently shown questions lose weight; never-shown get a bounded boost, not absolute priority', () => {
  const pool = [{ question_id: 'shown', wrong_count: 5, last_wrong_at: ago(30 * DAY) }, { question_id: 'unseen', wrong_count: 1, last_wrong_at: ago(30 * DAY) }];
  const p = share(pool, new Map([['shown', 1]]), 'shown'); // shown 6×0.667=4 vs unseen 2×1.5=3 → 4/7 ≈ 0.571
  assert.ok(p > 0.54 && p < 0.60, 'a frequently missed shown question can still beat an unseen one: ' + p);
  const heavy = share([{ question_id: 'a', wrong_count: 2, last_wrong_at: ago(30 * DAY) }, { question_id: 'b', wrong_count: 2, last_wrong_at: ago(30 * DAY) }], new Map([['a', 1], ['b', 6]]), 'a'); // 0.667 vs 0.25 → 0.727
  assert.ok(heavy > 0.70 && heavy < 0.76, String(heavy));
});

it('reward boundaries distinguish exam score and growth points', () => {
  for (const [score, points] of [[0, -100], [59, -100], [60, 50], [69, 50], [70, 100], [79, 100], [80, 150], [89, 150], [90, 200], [100, 200]]) assert.equal(studyReward(score), points);
});
it('Korean calendar date changes at 15:00 UTC', () => {
  assert.equal(kstDate(new Date('2026-10-08T14:59:59Z')), '2026-10-08'); assert.equal(kstDate(new Date('2026-10-08T15:00:00Z')), '2026-10-09');
});

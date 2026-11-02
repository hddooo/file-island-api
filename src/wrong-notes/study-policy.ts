import { randomInt } from 'node:crypto';
/** Change this policy for future sessions only; existing sessions keep their fixed deadline and queue. */
export const STUDY_POLICY = { size: 20, durationMs: 30 * 60_000, countdownMs: 3000, correctIntervalsDays: [1, 3, 7] } as const;

/** Repeated owner practice is immediately available. Spaced dates remain informational. */
export const COOLDOWN_MS = 0;
export function studyEligibleAt(_x: { lastCorrectAt: Date | null; latestCorrect: boolean; nextReviewAt: Date | null }): Date | null { return null; }
export const isStudyEligible = (eligibleAt: Date | null, now: Date) => !eligibleAt || now.getTime() >= eligibleAt.getTime();

/** Explainable selection weight (all factors monotonic, all bounded):
 *   frequency  1 + min(wrong_count, 5)                     — more mistakes → more likely (capped at 6×)
 *   recency    1 + 0.5 × max(0, 1 − age / 14 days)          — a mistake today weighs 1.5×, fading to 1× after 14 days
 *   exposure   1.5 if never shown, else 1 / (1 + 0.5 × n)   — shown more often → less likely; a bounded boost (not
 *                                                             an absolute first tier) for questions never shown */
export const STUDY_WEIGHT = { maxWrongCount: 5, recentDays: 14, recentBoost: 0.5, unseenBoost: 1.5, exposureStep: 0.5 } as const;
export function studyWeight(x: { wrong_count: number; last_wrong_at?: Date | null; manual_added_at?: Date | null }, exposure: number, now: Date): number {
  const freq = 1 + Math.min(Math.max(0, x.wrong_count || 0), STUDY_WEIGHT.maxWrongCount);
  const recencyAt = x.last_wrong_at || x.manual_added_at;
  const ageDays = recencyAt ? Math.max(0, (now.getTime() - recencyAt.getTime()) / 86_400_000) : Infinity;
  const recency = 1 + STUDY_WEIGHT.recentBoost * Math.max(0, 1 - ageDays / STUDY_WEIGHT.recentDays);
  const exp = Math.max(0, exposure || 0);
  const shown = exp === 0 ? STUDY_WEIGHT.unseenBoost : 1 / (1 + STUDY_WEIGHT.exposureStep * exp);
  return freq * recency * shown;
}

/** Weighted sampling WITHOUT replacement (Efraimidis–Spirakis keys −ln(u)/w): the `size` smallest keys win. */
export function selectStudy<T extends { question_id: string; wrong_count: number; last_wrong_at?: Date | null; manual_added_at?: Date | null }>(
  pool: T[], exposures: Map<string, number>, size: number, now: Date = new Date(), random: () => number = () => randomInt(1, 0x1000000) / 0x1000000,
): T[] {
  return pool.map((item) => ({ item, key: -Math.log(Math.min(1, Math.max(Number.MIN_VALUE, random()))) / studyWeight(item, exposures.get(item.question_id) || 0, now) }))
    .sort((a, b) => a.key - b.key).slice(0, size).map((x) => x.item);
}

export const STUDY_DAILY_LIMIT=5;
export const kstDate=(date:Date)=>new Date(date.getTime()+9*3600000).toISOString().slice(0,10);
export const studyReward=(score:number)=>score<60?-100:score<70?50:score<80?100:score<90?150:200;

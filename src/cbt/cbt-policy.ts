import type { QuestionRow } from '../questions/questions.repository';

/** Authenticated official-round CBT: one past exam (rounds 79 → 70), its 50 original questions in original order,
 *  the 5 original numbered choices, original 1–3 point weights summing to 100, 80 minutes on the server clock. */
export const CBT_ROUNDS = [80, 79, 78, 77, 76, 75, 74, 73, 72, 71, 70] as const;
export const CBT_SIZE = 50;
export const CBT_TOTAL_POINTS = 100;
export const CBT_DURATION_MS = 80 * 60_000;
export const UNKNOWN_PART = '기타·분류 확인 필요';
/** Grade bands (advanced level): 1급 ≥ 80, 2급 ≥ 70, 3급 ≥ 60, otherwise no grade. */
export const GRADE_RULE = [
  { grade: 1, min: 80 },
  { grade: 2, min: 70 },
  { grade: 3, min: 60 },
] as const;

/** Final-run growth (migration 009) on the ORIGINAL weighted score 0–100 (no normalization), one reward per final run:
 *  <60 −100 · 60–69 +50 · 70–79 +100 · 80–89 +150 · ≥90 +200. Never per question. */
export const CBT_REWARD_BANDS = [
  { min: 90, reward: 200 },
  { min: 80, reward: 150 },
  { min: 70, reward: 100 },
  { min: 60, reward: 50 },
] as const;
export const CBT_REWARD_BELOW = -100;
export function cbtReward(score: number): number {
  if (!Number.isInteger(score) || score < 0 || score > CBT_TOTAL_POINTS) throw new Error('cbt score out of range');
  for (const b of CBT_REWARD_BANDS) if (score >= b.min) return b.reward;
  return CBT_REWARD_BELOW;
}

/** Current policy: first final completion per owner/round, not per run. Historical band helper above stays immutable. */
export function cbtFirstRoundReward(score:number):number {
 if(!Number.isInteger(score)||score<0||score>100)throw new Error('cbt score out of range');
 return score>=80?10:score>=70?5:score>=60?3:-10;
}

export function gradeOf(score: number): 1 | 2 | 3 | null {
  for (const g of GRADE_RULE) if (score >= g.min) return g.grade;
  return null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => !!x && typeof x === 'object' && !Array.isArray(x);

export type RoundCheck = { ok: true; rows: QuestionRow[] } | { ok: false; reason: string };

/** Validates a round EXACTLY as stored: numbers 1..50 once each, ids exam-RR-NN, options exam-RR-NN-option-1..5 in
 *  original order, points 1–3 summing to 100. Anything missing or unknown makes the round unavailable (never invented). */
export function checkRound(round: number, rows: QuestionRow[]): RoundCheck {
  const mine = rows.filter((r) => r.kind === 'mock' && r.exam_round === round);
  if (mine.length !== CBT_SIZE) return { ok: false, reason: 'question_count' };
  const sorted = mine.slice().sort((a, b) => (a.exam_number ?? 0) - (b.exam_number ?? 0));
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i], n = i + 1, id = `exam-${round}-${pad2(n)}`;
    if (r.exam_number !== n || r.question_id !== id) return { ok: false, reason: 'numbering' };
    if (r.option_ids.length !== 5 || !r.option_ids.every((o, k) => o === `${id}-option-${k + 1}`)) return { ok: false, reason: 'options' };
    if (!r.option_ids.includes(r.correct_option_id)) return { ok: false, reason: 'answer' };
    if (![1, 2, 3].includes(r.points)) return { ok: false, reason: 'points' };
  }
  if (sorted.reduce((s, r) => s + r.points, 0) !== CBT_TOTAL_POINTS) return { ok: false, reason: 'points_total' };
  return { ok: true, rows: sorted };
}

// ---- private assets: canonical file names derived from validated integers, never from stored paths ----

export const CBT_ASSET_NAME = /^(7\d|80)-(0[1-9]|[1-4]\d|50)\.webp$|^(7\d|80)-common(0[1-9]|[1-4]\d|50)-(0[1-9]|[1-4]\d|50)\.webp$/;

export const questionImageName = (round: number, number: number) => `${round}-${pad2(number)}.webp`;

/** Shared passage image (e.g. 72-common47-48.webp): only when the public item declares one. The name comes from the
 *  declared commonQuestionIDs of the same round, or else the canonical basename of the declared image. */
export function commonImage(round: number, number: number, pub: Json): { name: string; numbers: number[] } | null {
  if (!pub.commonImage) return null;
  const ids = Array.isArray(pub.commonQuestionIDs) ? pub.commonQuestionIDs : [];
  const nums = ids.map((x) => (typeof x === 'string' ? /^exam-(\d\d)-(\d\d)$/.exec(x) : null)).filter((m): m is RegExpExecArray => !!m && Number(m[1]) === round).map((m) => Number(m[2]));
  if (nums.length >= 2 && nums.length === ids.length && nums.includes(number)) {
    const s = [...new Set(nums)].sort((a, b) => a - b);
    const name = `${round}-common${pad2(s[0])}-${pad2(s[s.length - 1])}.webp`;
    if (CBT_ASSET_NAME.test(name)) return { name, numbers: s };
  }
  if (typeof pub.commonImage === 'string') {
    const base = pub.commonImage.split(/[\\/]/).pop() ?? '';
    const m = new RegExp(`^${round}-common(\\d\\d)-(\\d\\d)\\.webp$`).exec(base);
    if (m && CBT_ASSET_NAME.test(base) && Number(m[1]) <= number && number <= Number(m[2])) {
      const numbers: number[] = [];
      for (let k = Number(m[1]); k <= Number(m[2]); k++) numbers.push(k);
      return { name: base, numbers };
    }
  }
  return null;
}

// ---- privacy: strip static/public asset references from anything sent to the client ----

const ASSET_KEY = /^(image|images|img|commonimage|imagesha256|sha256|src|path|paths|file|files|filename|asset|assets|url|urls|href|crop|crops|thumbnail|sourcepath|sourcefile|sourceurl)$/i;
const ASSET_VALUE = /\.(webp|png|jpe?g|gif|svg|avif|bmp|pdf)\b|^(https?:|file:|data:|blob:|\/|\.{1,2}[\\/]|[a-z]:\\)|https?:\/\/|(^|[\s\\/"'(])(media|assets|public|images?|crops?|originals?)[\\/]/i;

/** Deep copy without asset keys or path/URL-looking strings (bounded depth). */
export function stripAssets(v: unknown, depth = 0): unknown {
  if (depth > 12) return null;
  if (typeof v === 'string') return ASSET_VALUE.test(v.trim()) ? undefined : v;
  if (Array.isArray(v)) return v.map((x) => stripAssets(x, depth + 1)).filter((x) => x !== undefined);
  if (isObj(v)) {
    const out: Json = {};
    for (const [k, x] of Object.entries(v)) {
      if (ASSET_KEY.test(k)) continue;
      const y = stripAssets(x, depth + 1);
      if (y !== undefined) out[k] = y;
    }
    return out;
  }
  return v;
}

// ---- deterministic initial part (topic) classification ----

const PART_KEYWORDS: [string, string[]][] = [
  ['정치', ['국왕', '왕권', '정치', '제도', '관제', '관청', '통치', '정변', '반정', '개혁', '전쟁', '침입', '외교', '조약', '군사', '반란', '항쟁', '정부', '의병', '헌법', '선거', '정책', '즉위', '체제']],
  ['경제', ['토지', '조세', '세금', '화폐', '상업', '무역', '수취', '농업', '시장', '전시과', '과전법', '대동법', '균역법', '수공업', '광업', '경제', '공납', '상인', '은행', '산업']],
  ['사회', ['신분', '향약', '농민', '봉기', '민란', '노비', '여성', '가족', '사회', '백정', '양반', '천민', '향리', '풍속', '구휼', '의창', '상평창', '혼인', '노동']],
  ['문화', ['불교', '유교', '성리학', '실학', '석탑', '사찰', '불상', '문화유산', '예술', '서적', '저술', '회화', '건축', '학문', '교육', '종교', '문학', '과학', '천문', '역사서', '도자기', '편찬']],
];
const PART_SOURCE_KEY = /decisive|clue|memory|answer/i;

function collectStrings(v: unknown, out: string[], depth: number): void {
  if (depth > 8 || out.length > 200) return;
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, out, depth + 1));
  else if (isObj(v)) Object.values(v).forEach((x) => collectStrings(x, out, depth + 1));
}

function partTexts(v: unknown, out: string[], depth = 0): void {
  if (depth > 8) return;
  if (Array.isArray(v)) {
    v.forEach((x) => partTexts(x, out, depth + 1));
    return;
  }
  if (!isObj(v)) return;
  for (const [k, x] of Object.entries(v)) {
    if (PART_SOURCE_KEY.test(k)) collectStrings(x, out, depth + 1);
    else partTexts(x, out, depth + 1);
  }
}

/** Keyword vote over the review's decisive-answer / clue / memory texts only. Ties or no evidence → UNKNOWN_PART.
 *  This is an initial deterministic label, NOT a manually verified classification of the 500 questions. */
export function initialPart(review: Json): string {
  const texts: string[] = [];
  partTexts(review, texts);
  const text = texts.filter((t) => !ASSET_VALUE.test(t.trim())).join('\n');
  if (!text) return UNKNOWN_PART;
  const votes = PART_KEYWORDS.map(([label, words]) => ({ label, n: words.filter((w) => text.includes(w)).length }));
  const best = Math.max(...votes.map((v) => v.n));
  const winners = votes.filter((v) => v.n === best);
  return best > 0 && winners.length === 1 ? winners[0].label : UNKNOWN_PART;
}

// ---- results and statistics ----

export interface GradedItem {
  position: number;
  era: string | null;
  part: string;
  points: number;
  answered: boolean;
  correct: boolean;
}

export interface StatBucket {
  key: string;
  total: number;
  correct: number;
  /** Wrong INCLUDING unanswered (an unanswered question is a wrong question for study purposes). */
  wrong: number;
  answered: number;
  unanswered: number;
  /** wrong / total; null when total is 0. */
  wrongRate: number | null;
}

/** The only periods era statistics recognize. Everything else — 'comprehensive' (18 of the 500 originals), 'mixed',
 *  null, unknown or merely well-formed labels, related-topic ids — is excluded explicitly, never bucketed or guessed. */
export const RECOGNIZED_ERAS = ['prehistory', 'gojoseon', 'samguk', 'nambuk', 'goryeo', 'joseon-early', 'joseon-late', 'opening', 'colonial', 'modern'] as const;
const RECOGNIZED = new Set<string>(RECOGNIZED_ERAS);

export const isRecognizedEra = (era: string | null | undefined): era is (typeof RECOGNIZED_ERAS)[number] => typeof era === 'string' && RECOGNIZED.has(era);
export const isMixedEra = (era: string | null) => !isRecognizedEra(era);

export function buckets(items: GradedItem[], keyOf: (i: GradedItem) => string): StatBucket[] {
  const map = new Map<string, GradedItem[]>();
  for (const i of items) map.set(keyOf(i), [...(map.get(keyOf(i)) ?? []), i]);
  return [...map.entries()].map(([key, g]) => {
    const correct = g.filter((x) => x.correct).length, answered = g.filter((x) => x.answered).length;
    return { key, total: g.length, correct, wrong: g.length - correct, answered, unanswered: g.length - answered, wrongRate: g.length ? (g.length - correct) / g.length : null };
  }).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

export function statsOf(items: GradedItem[]) {
  const withEra = items.filter((i) => !isMixedEra(i.era));
  const noEra = items.filter((i) => isMixedEra(i.era));
  return {
    eras: {
      basis: 'question_versions.era (raw source category)',
      buckets: buckets(withEra, (i) => i.era!),
      excluded: { count: noEra.length, positions: noEra.map((i) => i.position), reason: 'mixed_or_unknown_era' },
    },
    parts: {
      basis: 'initial-keyword-heuristic (review decisive answer / clue / memory)',
      verified: false,
      unknownLabel: UNKNOWN_PART,
      buckets: buckets(items, (i) => i.part),
    },
  };
}

export function resultOf(round: number, items: GradedItem[], reason: 'submit' | 'expired', at: Date) {
  const score = items.reduce((s, i) => s + (i.correct ? i.points : 0), 0);
  const correct = items.filter((i) => i.correct).length;
  const answered = items.filter((i) => i.answered).length;
  const grade = gradeOf(score);
  return {
    round,
    total: items.length,
    maxScore: items.reduce((s, i) => s + i.points, 0),
    score,
    correct,
    wrong: answered - correct,
    unanswered: items.length - answered,
    answered,
    grade,
    passed: grade !== null,
    gradeRule: GRADE_RULE,
    growthReward: cbtReward(score),
    rewardBands: { below60: CBT_REWARD_BELOW, bands: CBT_REWARD_BANDS },
    reason,
    gradedAt: at.toISOString(),
    stats: statsOf(items),
  };
}

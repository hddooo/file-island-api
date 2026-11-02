import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256hex } from '../common/util';

// Reads the static front's generated data files WITHOUT executing them: each is a comment line, then
// `window.NAME={json};` on one line.
//  media/quiz-catalog.js → window.HANQ_QUIZ_CATALOG (703 multiple-choice items, ids legacy-… and check-…, option ids o<sha1>)
//  media/exam-pool.js    → window.HANQ_EXAM_POOL   (500 past-exam items exam-RR-NN, options exam-RR-NN-option-1..5, images)

type Json = Record<string, unknown>;

export interface SeedQuestion {
  questionId: string;
  version: string;
  kind: 'quiz' | 'mock';
  chapter: string | null;
  era: string | null;
  relatedEras: string[];
  examRound: number | null;
  examNumber: number | null;
  points: number;
  optionIds: string[];
  correctOptionId: string;
  /** Safe to send before grading: no answer, correct flag, review, explanation or answer-bearing source records. */
  publicPayload: Json;
  /** Sent only after the user's own graded submission: the complete original item (answer, reviews, sources). */
  reviewPayload: Json;
  contentHash: string;
}

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogError';
  }
}

export function parseGlobalAssignment(source: string, globalName: string): Json {
  const marker = `window.${globalName}=`;
  const start = source.indexOf(marker);
  if (start < 0) throw new CatalogError(`${globalName} assignment not found`);
  let body = source.slice(start + marker.length).trim();
  if (body.endsWith(';')) body = body.slice(0, -1);
  try {
    return JSON.parse(body) as Json;
  } catch {
    throw new CatalogError(`${globalName} is not plain JSON`);
  }
}

const isObj = (x: unknown): x is Json => !!x && typeof x === 'object' && !Array.isArray(x);
const strOrNull = (x: unknown) => (typeof x === 'string' ? x : null);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;

function pick(o: Json, keys: string[]): Json {
  const out: Json = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

function checkOptions(id: string, options: unknown): { ids: string[]; correct: string; list: Json[] } {
  if (!Array.isArray(options) || options.length < 2 || options.length > 6) throw new CatalogError(`${id}: needs 2–6 options`);
  const list = options as Json[];
  const ids = list.map((o) => (isObj(o) && typeof o.id === 'string' && ID_RE.test(o.id) ? o.id : ''));
  if (ids.some((x) => !x) || new Set(ids).size !== ids.length) throw new CatalogError(`${id}: option ids missing or duplicated`);
  const correct = list.filter((o) => o.correct === true);
  if (correct.length !== 1) throw new CatalogError(`${id}: exactly one correct option required`);
  return { ids, correct: String(correct[0].id), list };
}

export function quizQuestions(catalog: Json): SeedQuestion[] {
  const qs = catalog.questions;
  if (!isObj(qs)) throw new CatalogError('HANQ_QUIZ_CATALOG.questions missing');
  return Object.entries(qs).map(([key, raw]) => {
    if (!isObj(raw) || raw.id !== key || !ID_RE.test(key) || raw.v == null) throw new CatalogError(`quiz ${key}: malformed item`);
    const { ids, correct, list } = checkOptions(key, raw.options);
    const publicPayload: Json = {
      // Explicit allow-list. NOT included (answer-bearing): a, answer, compound (holds composite answers such as
      // {first:'균역법', king:'영조'}), kind, options[].correct/review, why, cue, overview, legacy, sources, dedup, rv, flags.
      ...pick(raw, ['id', 'chapter', 'relatedEras', 'shape', 'prompt', 'ask', 'q']),
      v: String(raw.v),
      mode: 'quiz',
      options: list.map((o) => ({ id: o.id, text: o.text })),
    };
    return {
      questionId: key,
      version: String(raw.v),
      kind: 'quiz' as const,
      chapter: strOrNull(raw.chapter),
      era: strOrNull(raw.chapter),
      relatedEras: Array.isArray(raw.relatedEras) ? raw.relatedEras.filter((x): x is string => typeof x === 'string') : [],
      examRound: null,
      examNumber: null,
      points: 1,
      optionIds: ids,
      correctOptionId: correct,
      publicPayload,
      reviewPayload: raw,
      contentHash: sha256hex(JSON.stringify(raw)),
    };
  });
}

export function examQuestions(pool: Json): SeedQuestion[] {
  const qs = pool.questions;
  if (!isObj(qs)) throw new CatalogError('HANQ_EXAM_POOL.questions missing');
  return Object.entries(qs).map(([key, raw]) => {
    const m = /^exam-(\d\d)-(\d\d)$/.exec(key);
    if (!m || !isObj(raw) || raw.id !== key || raw.v == null) throw new CatalogError(`exam ${key}: malformed item`);
    const { ids, correct, list } = checkOptions(key, raw.options);
    if (ids.length !== 5 || !ids.every((x, i) => x === `${key}-option-${i + 1}`)) throw new CatalogError(`${key}: options must be ${key}-option-1..5`);
    if (correct !== `${key}-option-${raw.answer}`) throw new CatalogError(`${key}: answer and correct flag disagree`);
    const points = Number(raw.points);
    if (![1, 2, 3].includes(points)) throw new CatalogError(`${key}: points must be 1–3`);
    if (Number(raw.exam) !== Number(m[1]) || Number(raw.number) !== Number(m[2])) throw new CatalogError(`${key}: exam/number mismatch`);
    const publicPayload: Json = {
      ...pick(raw, ['id', 'exam', 'number', 'era', 'relatedEras', 'points', 'negative', 'image', 'commonImage', 'commonLabel', 'commonQuestionIDs']),
      v: String(raw.v),
      mode: 'mock',
      // Options carry only id/text (①–⑤). NOT included: answer, options[].correct/review, overview, legacy, source, rv.
      options: list.map((o) => ({ id: o.id, text: o.text })),
    };
    return {
      questionId: key,
      version: String(raw.v),
      kind: 'mock' as const,
      chapter: null,
      era: strOrNull(raw.era),
      relatedEras: Array.isArray(raw.relatedEras) ? raw.relatedEras.filter((x): x is string => typeof x === 'string') : [],
      examRound: Number(raw.exam),
      examNumber: Number(raw.number),
      points,
      optionIds: ids,
      correctOptionId: correct,
      publicPayload,
      reviewPayload: raw,
      contentHash: sha256hex(JSON.stringify(raw)),
    };
  });
}

/** Loads both catalogs from <frontDir>/media. Throws on any structural problem (never seeds half-validated data). */
export function loadFrontCatalog(frontDir: string): SeedQuestion[] {
  const read = (f: string) => {
    try {
      return readFileSync(join(frontDir, 'media', f), 'utf8');
    } catch {
      throw new CatalogError(`cannot read media/${f} under HANQ_FRONT_DIR`);
    }
  };
  const quiz = quizQuestions(parseGlobalAssignment(read('quiz-catalog.js'), 'HANQ_QUIZ_CATALOG'));
  const exam = examQuestions(parseGlobalAssignment(read('exam-pool.js'), 'HANQ_EXAM_POOL'));
  const extraFile = join(frontDir, 'media', 'era-recall-quiz.js');
  const extra = existsSync(extraFile) ? quizQuestions(parseGlobalAssignment(read('era-recall-quiz.js'), 'HANQ_ERA_RECALL_QUIZ')) : [];
  const reviewedFile = join(frontDir, 'media', 'reviewed-quiz.js');
  const reviewed = existsSync(reviewedFile) ? quizQuestions(parseGlobalAssignment(read('reviewed-quiz.js'), 'HANQ_REVIEWED_QUIZ')) : [];
  // A unified front snapshot must seed every ID it publishes. Fail before DB writes
  // when a copied media directory omits the supplemental catalog.
  const selectionFile = join(frontDir, 'media', 'unified-quiz-selection.js');
  if (existsSync(selectionFile)) {
    if (!existsSync(extraFile)) throw new CatalogError('unified quiz requires media/era-recall-quiz.js');
    const selection = parseGlobalAssignment(read('unified-quiz-selection.js'), 'HANQ_UNIFIED_QUIZ_SELECTION');
    if (!isObj(selection.eras)) throw new CatalogError('unified quiz eras missing');
    const ids = new Set([...quiz, ...extra, ...reviewed].map((q) => q.questionId));
    for (const [era, chosen] of Object.entries(selection.eras)) {
      if (!Array.isArray(chosen) || new Set(chosen).size !== chosen.length || chosen.some((id) => typeof id !== 'string' || !ids.has(id))) {
        throw new CatalogError(`unified quiz ${era}: unknown or duplicate question ids`);
      }
    }
  }
  const all = [...quiz, ...extra, ...reviewed, ...exam];
  if (new Set(all.map((q) => q.questionId)).size !== all.length) throw new CatalogError('question ids collide between catalogs');
  return all;
}

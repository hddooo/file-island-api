import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { notFound } from '../common/app-error';
import { textbookUnavailable } from './textbook-member.guard';

export const SEMANTIC_DIRECTORY = 'private-textbook-semantic-data';
export const SEMANTIC_QUIZZES = ['prehistory', 'ancient', 'nambuk', 'goryeo', 'joseon', 'opening', 'colonial', 'modern'] as const;
export const semanticPageNumber = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 144;
export const semanticQuizId = (value: unknown): value is string => typeof value === 'string' && (SEMANTIC_QUIZZES as readonly string[]).includes(value);
export function semanticFigureId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^p(\d{3})-figure-([1-9]\d{0,2})$/.exec(value);
  return !!match && semanticPageNumber(Number(match[1]));
}
function allowedFile(filename: string): boolean {
  if (filename === 'manifest.json') return true;
  const figure = /^assets\/(p\d{3}-figure-[1-9]\d{0,2})\.(jpeg|png)$/.exec(filename);
  if (figure && semanticFigureId(figure[1])) return true;
  const page = /^pages\/page-(\d{3})\.json$/.exec(filename);
  const quiz = /^quizzes\/(?:four-choice\/)?([a-z]+)\.json$/.exec(filename);
  return !!((page && semanticPageNumber(Number(page[1]))) || (quiz && semanticQuizId(quiz[1])));
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const hash = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);

/** Fixed server-only filenames: no filesystem paths from HTTP parameters or JSON are followed. */
export async function readSemanticFile(repositoryRoot: string, filename: string): Promise<Buffer> {
  if (!allowedFile(filename)) throw notFound();
  try {
    const repository = await realpath(repositoryRoot);
    const root = resolve(repository, SEMANTIC_DIRECTORY);
    if (await realpath(root) !== root) throw textbookUnavailable();
    const path = resolve(root, filename);
    if (await realpath(path) !== path) throw textbookUnavailable();
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw textbookUnavailable();
      return await file.readFile();
    } finally { await file.close(); }
  } catch { throw textbookUnavailable(); }
}

export function validateSemanticJson(filename: string, data: unknown): Record<string, unknown> {
  if (!object(data)) throw textbookUnavailable();
  if (filename === 'manifest.json') {
    if (data.schemaVersion !== 'hanq-semantic-manifest/1' || !Array.isArray(data.quizzes) || !Array.isArray(data.pages)
      || data.quizzes.length > SEMANTIC_QUIZZES.length || data.pages.length > 144
      || !data.quizzes.every(q => object(q) && semanticQuizId(q.id)
        && (q.itemCount === undefined || (Number.isSafeInteger(q.itemCount) && Number(q.itemCount) > 0 && Number(q.itemCount) <= 200)))
      || new Set(data.quizzes.map(q => (q as Record<string, unknown>).id)).size !== data.quizzes.length
      || !data.pages.every(p => object(p) && semanticPageNumber(p.pdfPage))
      || new Set(data.pages.map(p => (p as Record<string, unknown>).pdfPage)).size !== data.pages.length
      || (data.pageCount !== undefined && data.pageCount !== data.pages.length)
      || (data.quizCount !== undefined && data.quizCount !== data.quizzes.length)
      || (data.fourChoices !== undefined && (!Array.isArray(data.fourChoices) || data.fourChoices.length > 8
        || !data.fourChoices.every(q => object(q) && semanticQuizId(q.id) && Number.isSafeInteger(q.itemCount) && Number(q.itemCount) > 0 && Number(q.itemCount) <= 200)
        || new Set(data.fourChoices.map(q => (q as Record<string, unknown>).id)).size !== data.fourChoices.length))
      || (data.figures !== undefined && (!Array.isArray(data.figures) || data.figures.length > 144 * 999
        || !data.figures.every(f => object(f) && semanticFigureId(f.id)
          && (f.extension === undefined || f.extension === 'jpeg' || f.extension === 'png')
          && (f.sha256 === undefined || hash(f.sha256))
          && (f.bytes === undefined || (Number.isSafeInteger(f.bytes) && Number(f.bytes) > 0 && Number(f.bytes) <= 2 * 1024 * 1024)))
        || new Set(data.figures.map(f => (f as Record<string, unknown>).id)).size !== data.figures.length))) throw textbookUnavailable();
  } else if (filename.startsWith('quizzes/four-choice/') && allowedFile(filename)) {
    if (data.schemaVersion !== 'hanq-source-four-choice/1' || data.eraId !== filename.slice(20, -5) || data.sourceQuizId !== data.eraId || typeof data.id !== 'string' || data.id.length > 100
      || !hash(data.sourceQuizSha256) || !Array.isArray(data.items) || !data.items.length || data.items.length > 200
      || new Set(data.items.map(i => object(i) ? i.id : null)).size !== data.items.length
      || !data.items.every(i => object(i) && typeof i.id === 'string' && typeof i.sourceItemId === 'string'
        && i.reviewStatus === 'verified' && object(i.sourceQuestion) && typeof i.sourceQuestion.text === 'string'
        && Array.isArray(i.options) && i.options.length === 4
        && i.options.every(o => object(o) && typeof o.id === 'string' && typeof o.text === 'string' && o.text.trim().length > 0 && Array.isArray(o.sourceRefs) && o.sourceRefs.length > 0)
        && new Set(i.options.map(o => (o as Record<string, unknown>).id)).size === 4
        && new Set(i.options.map(o => String((o as Record<string, unknown>).text).normalize('NFKC').replace(/\s/g, ''))).size === 4
        && i.options.filter(o => (o as Record<string, unknown>).id === i.correctOptionId).length === 1
        && object(i.verification) && i.verification.sourceGrounded === true && i.verification.originalQuestionUnchanged === true)) throw textbookUnavailable();
  } else if (filename.startsWith('quizzes/') && allowedFile(filename)) {
    if (data.schemaVersion !== 'hanq-source-quiz/1' || data.id !== filename.slice(8, -5) || !object(data.source) || !hash(data.source.sha256)
      || !Array.isArray(data.items) || !data.items.length || data.items.length > 200
      || !data.items.every(i => object(i) && typeof i.id === 'string' && typeof i.text === 'string'
        && Array.isArray(i.segments) && Array.isArray(i.answers) && object(i.verification)
        && i.verification.status === 'source-verified' && i.verification.textVerified === true && i.verification.answerPairVerified === true)) throw textbookUnavailable();
  } else if (filename.startsWith('pages/') && allowedFile(filename)) {
    if (data.schemaVersion !== 'hanq-semantic/1' || data.pdfPage !== Number(filename.slice(11, -5)) || !hash(data.sourceSha256)
      || typeof data.width !== 'number' || !Number.isFinite(data.width) || data.width <= 0
      || typeof data.height !== 'number' || !Number.isFinite(data.height) || data.height <= 0
      || !Array.isArray(data.blocks) || data.blocks.length > 1000
      || !data.blocks.every(b => object(b) && typeof b.id === 'string' && typeof b.type === 'string')) throw textbookUnavailable();
  } else throw notFound();
  return data;
}

export async function readSemanticJson(repositoryRoot: string, filename: string) {
  try { return validateSemanticJson(filename, JSON.parse((await readSemanticFile(repositoryRoot, filename)).toString('utf8'))); }
  catch { if (!allowedFile(filename)) throw notFound(); throw textbookUnavailable(); }
}

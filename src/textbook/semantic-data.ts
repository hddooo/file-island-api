import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { notFound } from '../common/app-error';
import { textbookUnavailable } from './textbook-member.guard';

export const SEMANTIC_DIRECTORY = 'private-textbook-semantic-data';
export const SEMANTIC_QUIZZES = ['prehistory', 'ancient', 'nambuk', 'goryeo', 'joseon', 'opening', 'colonial', 'modern'] as const;
const OLD_SOURCE_SHA = '35d850c6e9d9910c24cccce4b2ae37b963ee1ecd24f1926033f48d98f9de0442';
const NEW_SOURCE_SHA = 'd54c1aa5d5816eeb73a2e82da0ec699555c2cbf1e7cb717a3b84420ed18296de';
export type SemanticSourceProfile = Readonly<{maxPdfPages: 144 | 147; sourceSha256?: string; checkReferences?: boolean}>;
const LEGACY_PROFILE: SemanticSourceProfile = Object.freeze({maxPdfPages: 144});
const OLD_PROFILE: SemanticSourceProfile = Object.freeze({maxPdfPages: 144, sourceSha256: OLD_SOURCE_SHA});
const NEW_PROFILE: SemanticSourceProfile = Object.freeze({maxPdfPages: 147, sourceSha256: NEW_SOURCE_SHA, checkReferences: true});
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const hash = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);

/** A source profile grants bounds, not review/readiness or a new revision identity. */
export function textbookRevisionPageCount(revision: string): 144 | 147 {
 if (revision === OLD_SOURCE_SHA) return 144;
 if (revision === NEW_SOURCE_SHA) return 147;
 throw notFound();
}
export function semanticSourceProfile(manifest: Record<string, unknown>, sourceRevision?: string): SemanticSourceProfile {
 const source = object(manifest.source) ? manifest.source : undefined, total = source?.totalPdfPages;
 let profile: SemanticSourceProfile;
 if (source?.sha256 === NEW_SOURCE_SHA) {
  if (total !== 147) throw textbookUnavailable();
  profile = NEW_PROFILE;
 } else {
  if (source?.sha256 === OLD_SOURCE_SHA && total !== undefined && total !== 144) throw textbookUnavailable();
  if (total !== undefined && (!Number.isSafeInteger(total) || Number(total) < 1 || Number(total) > 144)) throw textbookUnavailable();
  profile = source?.sha256 === OLD_SOURCE_SHA ? OLD_PROFILE : LEGACY_PROFILE;
 }
 if (sourceRevision !== undefined) {
  if (source?.sha256 !== sourceRevision || total !== textbookRevisionPageCount(sourceRevision)) throw textbookUnavailable();
  profile = Object.freeze({...profile, sourceSha256: sourceRevision, checkReferences: true});
  validateSourceReferences(manifest, profile);
 }
 return profile;
}
export const semanticPageNumber = (value: unknown, profile: SemanticSourceProfile = LEGACY_PROFILE): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= profile.maxPdfPages;
export const semanticQuizId = (value: unknown): value is string => typeof value === 'string' && (SEMANTIC_QUIZZES as readonly string[]).includes(value);
export function semanticFigureId(value: unknown, profile: SemanticSourceProfile = LEGACY_PROFILE): value is string {
  if (typeof value !== 'string') return false;
  const match = /^p(\d{3})-figure-([1-9]\d{0,2})$/.exec(value);
  return !!match && semanticPageNumber(Number(match[1]), profile);
}
function allowedFile(filename: string, profile: SemanticSourceProfile): boolean {
  if (filename === 'manifest.json') return true;
  const figure = /^assets\/(p\d{3}-figure-[1-9]\d{0,2})\.(jpeg|png)$/.exec(filename);
  if (figure && semanticFigureId(figure[1], profile)) return true;
  const page = /^pages\/page-(\d{3})\.json$/.exec(filename);
  const quiz = /^quizzes\/(?:four-choice\/)?([a-z]+)\.json$/.exec(filename);
  return !!((page && semanticPageNumber(Number(page[1]), profile)) || (quiz && semanticQuizId(quiz[1])));
}

/** PDF provenance hashes differ from figure/render/quiz JSON hashes. Keep those checks separate. */
export function validateSourceReferences(data: unknown, profile: SemanticSourceProfile) {
 const sourceHash = (value: unknown) => {
  if ((profile.checkReferences && value !== profile.sourceSha256) || (value === NEW_SOURCE_SHA && profile.sourceSha256 !== NEW_SOURCE_SHA)) throw textbookUnavailable();
 };
 const pending: {value: unknown; key: string}[] = [{value: data, key: ''}];
 while (pending.length) {
  const {value, key} = pending.pop()!;
  if (profile.checkReferences) {
   if (['pdfPage', 'answerPdfPage', 'sourcePage', 'pdfFrom', 'pdfTo', 'fromPage', 'toPage'].includes(key) && !semanticPageNumber(value, profile)) throw textbookUnavailable();
   if (key === 'pdfPages' && (!Array.isArray(value) || !value.every(page => semanticPageNumber(page, profile)))) throw textbookUnavailable();
   if (key === 'pageDimensions' && (!object(value) || !Object.keys(value).every(page => /^[1-9]\d{0,2}$/.test(page) && semanticPageNumber(Number(page), profile)))) throw textbookUnavailable();
   if (key === 'sourceRenderSha256' && !hash(value) && (!object(value) || !Object.entries(value).every(([page, renderHash]) => /^[1-9]\d{0,2}$/.test(page) && semanticPageNumber(Number(page), profile) && hash(renderHash)))) throw textbookUnavailable();
   if (key === 'totalPdfPages' && value !== profile.maxPdfPages) throw textbookUnavailable();
   if (typeof value === 'string' && /(?:^id$|Ids?$)/.test(key)) {
    const anchor = /^p(\d{3})(?:-|:)/.exec(value);
    if (anchor && !semanticPageNumber(Number(anchor[1]), profile)) throw textbookUnavailable();
   }
  }
  if (key === 'sourceSha256') sourceHash(value);
  if (Array.isArray(value)) { for (const child of value) pending.push({value: child, key: key === 'pdfPages' ? '' : key}); }
  else if (object(value)) {
   if (key === 'source' && Object.hasOwn(value, 'sha256')) sourceHash(value.sha256);
   for (const [childKey, child] of Object.entries(value)) pending.push({value: child, key: childKey});
  }
 }
}

/** Fixed server-only filenames: no filesystem paths from HTTP parameters or JSON are followed. */
export async function readSemanticDirectoryFile(directory: string, filename: string, profile: SemanticSourceProfile = LEGACY_PROFILE): Promise<Buffer> {
  if (!allowedFile(filename, profile)) throw notFound();
  try {
    const root = resolve(directory);
    if (await realpath(directory) !== root) throw textbookUnavailable();
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

export async function readSemanticFile(repositoryRoot: string, filename: string, profile: SemanticSourceProfile = LEGACY_PROFILE): Promise<Buffer> {
  if (!allowedFile(filename, profile)) throw notFound();
  try {
    const repository = await realpath(repositoryRoot);
    return await readSemanticDirectoryFile(resolve(repository, SEMANTIC_DIRECTORY), filename, profile);
  } catch { throw textbookUnavailable(); }
}

export function validateSemanticJson(filename: string, data: unknown, sourceProfile: SemanticSourceProfile = LEGACY_PROFILE): Record<string, unknown> {
  if (!object(data)) throw textbookUnavailable();
  const profile = filename === 'manifest.json' ? semanticSourceProfile(data) : sourceProfile;
  if (filename === 'manifest.json') {
    if (data.schemaVersion !== 'hanq-semantic-manifest/1' || !Array.isArray(data.quizzes) || !Array.isArray(data.pages)
      || data.quizzes.length > SEMANTIC_QUIZZES.length || data.pages.length > profile.maxPdfPages
      || !data.quizzes.every(q => object(q) && semanticQuizId(q.id)
        && (q.itemCount === undefined || (Number.isSafeInteger(q.itemCount) && Number(q.itemCount) > 0 && Number(q.itemCount) <= 200)))
      || new Set(data.quizzes.map(q => (q as Record<string, unknown>).id)).size !== data.quizzes.length
      || !data.pages.every(p => object(p) && semanticPageNumber(p.pdfPage, profile))
      || new Set(data.pages.map(p => (p as Record<string, unknown>).pdfPage)).size !== data.pages.length
      || (data.pageCount !== undefined && data.pageCount !== data.pages.length)
      || (data.quizCount !== undefined && data.quizCount !== data.quizzes.length)
      || (data.fourChoices !== undefined && (!Array.isArray(data.fourChoices) || data.fourChoices.length > 8
        || !data.fourChoices.every(q => object(q) && semanticQuizId(q.id) && Number.isSafeInteger(q.itemCount) && Number(q.itemCount) > 0 && Number(q.itemCount) <= 200)
        || new Set(data.fourChoices.map(q => (q as Record<string, unknown>).id)).size !== data.fourChoices.length))
      || (data.figures !== undefined && (!Array.isArray(data.figures) || data.figures.length > profile.maxPdfPages * 999
        || !data.figures.every(f => object(f) && semanticFigureId(f.id, profile)
          && (f.extension === undefined || f.extension === 'jpeg' || f.extension === 'png')
          && (f.sha256 === undefined || hash(f.sha256))
          && (f.bytes === undefined || (Number.isSafeInteger(f.bytes) && Number(f.bytes) > 0 && Number(f.bytes) <= 2 * 1024 * 1024)))
        || new Set(data.figures.map(f => (f as Record<string, unknown>).id)).size !== data.figures.length))) throw textbookUnavailable();
  } else if (filename.startsWith('quizzes/four-choice/') && allowedFile(filename, profile)) {
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
  } else if (filename.startsWith('quizzes/') && allowedFile(filename, profile)) {
    if (data.schemaVersion !== 'hanq-source-quiz/1' || data.id !== filename.slice(8, -5) || !object(data.source) || !hash(data.source.sha256)
      || !Array.isArray(data.items) || !data.items.length || data.items.length > 200
      || !data.items.every(i => object(i) && typeof i.id === 'string' && typeof i.text === 'string'
        && Array.isArray(i.segments) && Array.isArray(i.answers) && object(i.verification)
        && i.verification.status === 'source-verified' && i.verification.textVerified === true && i.verification.answerPairVerified === true)) throw textbookUnavailable();
  } else if (filename.startsWith('pages/') && allowedFile(filename, profile)) {
    if (data.schemaVersion !== 'hanq-semantic/1' || data.pdfPage !== Number(filename.slice(11, -5)) || !hash(data.sourceSha256)
      || typeof data.width !== 'number' || !Number.isFinite(data.width) || data.width <= 0
      || typeof data.height !== 'number' || !Number.isFinite(data.height) || data.height <= 0
      || !Array.isArray(data.blocks) || data.blocks.length > 1000
      || !data.blocks.every(b => object(b) && typeof b.id === 'string' && typeof b.type === 'string')) throw textbookUnavailable();
  } else throw notFound();
  validateSourceReferences(data, profile);
  return data;
}

export async function readSemanticJson(repositoryRoot: string, filename: string, profile: SemanticSourceProfile = LEGACY_PROFILE) {
  try { return validateSemanticJson(filename, JSON.parse((await readSemanticFile(repositoryRoot, filename, profile)).toString('utf8')), profile); }
  catch { if (!allowedFile(filename, profile)) throw notFound(); throw textbookUnavailable(); }
}

/** Direct canonical directories are selected only by the fixed revision resolver. */
export async function readSemanticDirectoryJson(directory: string, filename: string, profile: SemanticSourceProfile = LEGACY_PROFILE) {
 try { return validateSemanticJson(filename, JSON.parse((await readSemanticDirectoryFile(directory, filename, profile)).toString('utf8')), profile); }
 catch { if (!allowedFile(filename, profile)) throw notFound(); throw textbookUnavailable(); }
}

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const OLD_PDF_SHA = '35d850c6e9d9910c24cccce4b2ae37b963ee1ecd24f1926033f48d98f9de0442';
export const NEW_PDF_SHA = 'd54c1aa5d5816eeb73a2e82da0ec699555c2cbf1e7cb717a3b84420ed18296de';
export const syntheticHash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Test-only shapes; no PDF extraction, real item IDs, revision name, or source registration. */
export function syntheticSemanticBundle(pdfSha = NEW_PDF_SHA, totalPdfPages = 147) {
 const pdfPage = totalPdfPages;
 const items = ['A', 'B', 'C', 'D'].map((answer, index) => ({
  id: `synthetic-${pdfSha.slice(0, 8)}-${index}`, kind: 'single', originalNumber: index + 1,
  text: 'SYNTHETIC TEST QUESTION', sourceText: 'SYNTHETIC TEST QUESTION ( )',
  pdfPage, sourcePage: pdfPage, segments: [{type: 'text', text: 'SYNTHETIC TEST QUESTION'}],
  blanks: [{id: 'synthetic-slot', answerIds: ['synthetic-answer']}],
  answer: {text: 'SYNTHETIC ' + answer, orderMatters: false},
  answers: [{id: 'synthetic-answer', text: 'SYNTHETIC ' + answer, sourcePage: pdfPage}],
  source: {sha256: pdfSha, pdfPage, answerPdfPage: pdfPage, questionBlockIds: [`p${pdfPage}-b0001`]},
  verification: {status: 'source-verified', textVerified: true, answerPairVerified: true},
 }));
 const quiz = {schemaVersion: 'hanq-source-quiz/1', id: 'prehistory', source: {sha256: pdfSha, pdfPages: [pdfPage], pageDimensions: {[pdfPage]: [100, 100]}}, items};
 const quizHash = syntheticHash(JSON.stringify(quiz));
 const first = items[0];
 const derived = {schemaVersion: 'hanq-source-four-choice/1', id: 'synthetic-choices', eraId: 'prehistory', sourceQuizId: 'prehistory', sourceQuizSha256: quizHash,
  items: [{id: 'synthetic-derived', sourceItemId: first.id, sourceQuestion: {text: first.text, sourceText: first.sourceText, segments: first.segments, source: first.source, originalNumber: first.originalNumber}, reviewStatus: 'verified',
   options: items.map((item, index) => ({id: String(index), text: item.answer.text, sourceRefs: [{kind: 'original-quiz-answer', quizId: 'prehistory', quizSha256: quizHash, itemId: item.id}]})), correctOptionId: '0', verification: {sourceGrounded: true, originalQuestionUnchanged: true}}]};
 const figure = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
 const manifest = {schemaVersion: 'hanq-semantic-manifest/1', source: {sha256: pdfSha, totalPdfPages},
  pages: [{pdfPage}], quizzes: [{id: 'prehistory', itemCount: items.length, pdfPages: [pdfPage]}], fourChoices: [{id: 'prehistory', itemCount: 1}],
  figures: [{id: `p${pdfPage}-figure-1`, pdfPage, extension: 'png', bytes: figure.length, sha256: syntheticHash(figure)}]};
 const page = {schemaVersion: 'hanq-semantic/1', pdfPage, sourceSha256: pdfSha, width: 100, height: 100, blocks: [{id: `p${pdfPage}-b0001`, type: 'text'}]};
 return {manifest, quiz, derived, page, figure};
}

export async function writeSyntheticBundle(repository: string, bundle: ReturnType<typeof syntheticSemanticBundle>) {
 const root = join(repository, 'private-textbook-semantic-data');
 for (const name of ['pages', 'assets', 'quizzes/four-choice']) await mkdir(join(root, name), {recursive: true});
 for (const [name, value] of Object.entries({'manifest.json': bundle.manifest, [`pages/page-${bundle.page.pdfPage}.json`]: bundle.page, 'quizzes/prehistory.json': bundle.quiz, 'quizzes/four-choice/prehistory.json': bundle.derived})) await writeFile(join(root, name), JSON.stringify(value));
 await writeFile(join(root, `assets/p${bundle.page.pdfPage}-figure-1.png`), bundle.figure);
 return root;
}

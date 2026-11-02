import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, rm, writeFile, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Test} from '@nestjs/testing';
import request from 'supertest';
import {TextbookService, SEMANTIC_REPOSITORY_ROOT} from '../../src/textbook/textbook.service';
import {validateSemanticJson, semanticSourceProfile} from '../../src/textbook/semantic-data';
import {TextbookController} from '../../src/textbook/textbook.controller';
import {TextbookMemberGuard} from '../../src/textbook/textbook-member.guard';
import {JwtAuthGuard} from '../../src/auth/guards';
import {AuthService} from '../../src/auth/auth.service';
import {SourceBlankProgressService} from '../../src/textbook/source-blank-progress';
import {ApiExceptionFilter} from '../../src/common/api-exception.filter';
import {APP_CONFIG} from '../../src/common/tokens';
import type {AppConfig} from '../../src/config/config';
import {NEW_PDF_SHA, OLD_PDF_SHA, syntheticSemanticBundle, writeSyntheticBundle} from '../helpers/semantic-source-fixture';

const unavailable = (e: unknown) => !!e && typeof e === 'object' && 'status' in e && e.status === 503;
test('only exact new PDF SHA and147 total select a bounded147 manifest; legacy144 remains valid', () => {
 const legacy = syntheticSemanticBundle(OLD_PDF_SHA, 144).manifest;
 assert.equal(validateSemanticJson('manifest.json', legacy), legacy);
 const next = syntheticSemanticBundle().manifest;
 assert.equal(validateSemanticJson('manifest.json', next), next);
 assert.doesNotThrow(() => validateSemanticJson('manifest.json', {...next, pages: Array.from({length: 147}, (_, i) => ({pdfPage: i + 1}))}));
 for (const manifest of [
  {...next, source: {sha256: 'a'.repeat(64), totalPdfPages: 147}},
  {...next, source: {sha256: NEW_PDF_SHA, totalPdfPages: 144}},
  {...legacy, source: {sha256: OLD_PDF_SHA, totalPdfPages: 147}},
  {...next, source: {sha256: NEW_PDF_SHA}},
  {...next, pages: [{pdfPage: 148}]},
  {...next, figures: [{...next.figures[0], id: 'p148-figure-1', pdfPage: 148}]},
 ]) assert.throws(() => validateSemanticJson('manifest.json', manifest));
});

test('legacy144 retains its original child-hash policy while refusing new-PDF content under a legacy manifest', () => {
 const legacy = syntheticSemanticBundle(OLD_PDF_SHA, 144), profile = semanticSourceProfile(legacy.manifest);
 legacy.page.sourceSha256 = 'a'.repeat(64);
 assert.doesNotThrow(() => validateSemanticJson('pages/page-144.json', legacy.page, profile));
 assert.doesNotThrow(() => validateSemanticJson('manifest.json', {...legacy.manifest, source: {sha256: 'b'.repeat(64), totalPdfPages: 144}}));
 legacy.page.sourceSha256 = NEW_PDF_SHA;
 assert.throws(() => validateSemanticJson('pages/page-144.json', legacy.page, profile));
});

test('new profile serves listed page/figure147 and quizzes/choices without adding public filesystem paths', async () => {
 const repository = await mkdtemp(join(tmpdir(), 'hanq-profile147-'));
 try {
  await writeSyntheticBundle(repository, syntheticSemanticBundle());
  const service = new TextbookService({} as AppConfig, repository);
  assert.equal((await service.semanticPage('147') as {pdfPage: number}).pdfPage, 147);
  assert.equal((await service.semanticQuiz('prehistory') as {items: unknown[]}).items.length, 4);
  assert.equal((await service.semanticChoices('prehistory') as {items: unknown[]}).items.length, 1);
  const image = await service.semanticFigure('p147-figure-1');assert.equal(image.mime, 'image/png');assert.equal(image.data.length, 8);
  const response = JSON.stringify(await service.semanticManifest());assert(!response.includes(repository));assert(!response.includes('dataPath'));
  for (const page of ['148', '0', '0147', '../147']) await assert.rejects(service.semanticPage(page));
  await assert.rejects(service.semanticFigure('p148-figure-1'));await assert.rejects(service.semanticFigure('p147-figure-2'));
  await assert.rejects(service.semanticQuiz('ancient'));await assert.rejects(service.semanticChoices('ancient'));
 } finally {await rm(repository, {recursive: true, force: true});}
});

test('new manifest refuses old child hashes and out-of-profile PDF references at every semantic read', async () => {
 const repository = await mkdtemp(join(tmpdir(), 'hanq-profile147-drift-'));
 try {
  const service = new TextbookService({} as AppConfig, repository);
  for (const alter of [
   (b: ReturnType<typeof syntheticSemanticBundle>) => {b.page.sourceSha256 = OLD_PDF_SHA;},
   (b: ReturnType<typeof syntheticSemanticBundle>) => {b.page.blocks[0].id = 'p148-b0001';},
   (b: ReturnType<typeof syntheticSemanticBundle>) => {b.quiz.source.sha256 = OLD_PDF_SHA;},
   (b: ReturnType<typeof syntheticSemanticBundle>) => {b.quiz.items[0].source.sha256 = OLD_PDF_SHA;},
   (b: ReturnType<typeof syntheticSemanticBundle>) => {b.quiz.source.pdfPages = [148];},
   (b: ReturnType<typeof syntheticSemanticBundle>) => {b.quiz.source.pageDimensions = {'148': [100, 100]};},
   (b: ReturnType<typeof syntheticSemanticBundle>) => {b.quiz.items[0].source.answerPdfPage = 148;},
   (b: ReturnType<typeof syntheticSemanticBundle>) => {b.quiz.items[0].answers[0].sourcePage = 148;},
  ]) {
   const bundle = syntheticSemanticBundle();alter(bundle);await writeSyntheticBundle(repository, bundle);
   await assert.rejects(bundle.page.sourceSha256 !== NEW_PDF_SHA || bundle.page.blocks[0].id === 'p148-b0001' ? service.semanticPage('147') : service.semanticQuiz('prehistory'), unavailable);
  }
  const bundle = syntheticSemanticBundle();bundle.derived.items[0].sourceQuestion.source.pdfPage = 148;await writeSyntheticBundle(repository, bundle);await assert.rejects(service.semanticChoices('prehistory'), unavailable);
  const legacy = syntheticSemanticBundle(OLD_PDF_SHA, 144);legacy.page.sourceSha256 = NEW_PDF_SHA;await writeSyntheticBundle(repository, legacy);await assert.rejects(service.semanticPage('144'), unavailable);
 } finally {await rm(repository, {recursive: true, force: true});}
});

test('147 keeps MIME, integrity, size, fixed-path and symlink protections and leaves legacy fixtures usable', async () => {
 const repository = await mkdtemp(join(tmpdir(), 'hanq-profile147-files-'));
 try {
  const bundle = syntheticSemanticBundle(),root = await writeSyntheticBundle(repository, bundle),service = new TextbookService({} as AppConfig, repository);
  const file = join(root, 'assets/p147-figure-1.png');
  await writeFile(file, Buffer.from([255,216,255,217]));await assert.rejects(service.semanticFigure('p147-figure-1'), unavailable);
  await writeSyntheticBundle(repository, bundle);bundle.manifest.figures[0].sha256 = 'a'.repeat(64);await writeSyntheticBundle(repository, bundle);await assert.rejects(service.semanticFigure('p147-figure-1'), unavailable);
  await writeSyntheticBundle(repository, syntheticSemanticBundle());await writeFile(file, Buffer.alloc(2097153));await assert.rejects(service.semanticFigure('p147-figure-1'), unavailable);
  await writeSyntheticBundle(repository, syntheticSemanticBundle());await rm(file);await writeFile(join(repository, 'outside.png'), bundle.figure);await symlink(join(repository, 'outside.png'), file);await assert.rejects(service.semanticFigure('p147-figure-1'), unavailable);
  await assert.rejects(service.semanticFigure('../outside'));await assert.rejects(service.semanticPage('%2f147'));
  await rm(file);await writeSyntheticBundle(repository, syntheticSemanticBundle(OLD_PDF_SHA, 144));assert.equal((await service.semanticPage('144') as {pdfPage: number}).pdfPage, 144);await assert.rejects(service.semanticPage('147'));
 } finally {await rm(repository, {recursive: true, force: true});}
});

test('147 routes keep private auth before source lookup, allow members and reject revoked/invalid sessions', async () => {
 const repository = await mkdtemp(join(tmpdir(), 'hanq-profile147-auth-'));let revoked = false;
 try {
  await writeSyntheticBundle(repository, syntheticSemanticBundle());
  const module = await Test.createTestingModule({controllers: [TextbookController], providers: [TextbookService, TextbookMemberGuard, JwtAuthGuard,
   {provide: APP_CONFIG, useValue: {}}, {provide: SEMANTIC_REPOSITORY_ROOT, useValue: repository},
   {provide: SourceBlankProgressService, useValue: {}},
   {provide: AuthService, useValue: {authenticate: async (token: string) => !revoked && token === 'synthetic-member-session' ? {userId: 'synthetic-unit-member', sessionId: 'synthetic-unit-session'} : null}},
  ]}).compile();
  const app = module.createNestApplication({logger: false});app.useGlobalFilters(new ApiExceptionFilter());await app.init();
  try {
   for (const route of ['manifest', 'pages/147', 'figures/p147-figure-1', 'quizzes/prehistory', 'choices/prehistory']) {
    const url = '/api/v1/textbook/semantic/' + route;
    await request(app.getHttpServer()).get(url).expect(401);await request(app.getHttpServer()).get(url).set('Authorization', 'Bearer synthetic-invalid-session').expect(401);
    await request(app.getHttpServer()).get(url).set('Authorization', 'Bearer synthetic-member-session').expect(200);
    revoked = true;await request(app.getHttpServer()).get(url).set('Authorization', 'Bearer synthetic-member-session').expect(401);revoked = false;
   }
  } finally {await app.close();}
 } finally {await rm(repository, {recursive: true, force: true});}
});

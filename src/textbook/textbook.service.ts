import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { notFound } from '../common/app-error';
import { projectRoot } from '../common/project-root';
import { APP_CONFIG } from '../common/tokens';
import type { AppConfig } from '../config/config';
import { readSemanticFile, readSemanticJson, semanticPageNumber, semanticQuizId, semanticFigureId, semanticSourceProfile, readSemanticDirectoryFile, readSemanticDirectoryJson, textbookRevisionPageCount, validateSourceReferences, type SemanticSourceProfile } from './semantic-data';
import { textbookUnavailable } from './textbook-member.guard';

type JsonObject = Record<string, unknown>;
const object = (v: unknown): v is JsonObject => !!v && typeof v === 'object' && !Array.isArray(v);
const within = (root: string, path: string) => { const p = relative(root, path); return p !== '' && p !== '..' && !p.startsWith(`..${sep}`) && !isAbsolute(p); };
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Only this exact server-only directory is permitted inside the API repository. */
export const BUNDLED_TEXTBOOK_DIR = 'private-textbook-data';

export async function resolveTextbookDataRoot(dataDir: string | null | undefined, repositoryRoot: string): Promise<string> {
  try {
    const repo = await realpath(repositoryRoot);
    const bundled = resolve(repo, BUNDLED_TEXTBOOK_DIR);
    const requested = dataDir ?? bundled;
    if (!isAbsolute(requested)) throw textbookUnavailable();
    const root = await realpath(requested);
    // Refuse root aliases/symlinks and every repository child except the exact bundle.
    if (root !== resolve(requested) || root === repo || (within(repo, root) && root !== bundled)) throw textbookUnavailable();
    return root;
  } catch { throw textbookUnavailable(); }
}

/** Strip filesystem references recursively; vectorPaths are geometry, not filesystem paths. */
function publicData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicData);
  if (!object(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(?:Path|File|Dir|Url|URI)$/i.test(key) && key !== 'imageReferences')
    .map(([key, child]) => [key, publicData(child)]));
}

export const SEMANTIC_REPOSITORY_ROOT = Symbol('SEMANTIC_REPOSITORY_ROOT');
const REVISION_SCOPE = Symbol('TEXTBOOK_REVISION_SCOPE');
type RevisionScope = Readonly<{sourceRevision: string; semanticDirectory: string; rawDirectory: string}>;

@Injectable()
export class TextbookService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(SEMANTIC_REPOSITORY_ROOT) private readonly semanticRepositoryRoot?: string,
    @Optional() @Inject(REVISION_SCOPE) private readonly revisionScope?: RevisionScope,
  ) {}

  private semanticRoot() { return this.semanticRepositoryRoot ?? projectRoot(); }

  /** A fresh immutable context per request; the default singleton never changes its roots. */
  async forRevision(sourceRevision: string): Promise<TextbookService> {
    textbookRevisionPageCount(sourceRevision);
    const requested = this.config.textbook?.revisionsDir;
    if (!requested || !isAbsolute(requested) || requested.includes('\u0000')) throw textbookUnavailable();
    try {
      const repository = await realpath(projectRoot()), root = resolve(requested);
      if (await realpath(requested) !== root || root === repository || within(repository, root)) throw textbookUnavailable();
      const revisionDirectory = resolve(root, sourceRevision);
      const scope = Object.freeze({sourceRevision, semanticDirectory: resolve(revisionDirectory, 'semantic'), rawDirectory: resolve(revisionDirectory, 'raw')});
      for (const directory of [revisionDirectory, scope.semanticDirectory, scope.rawDirectory]) if (await realpath(directory) !== directory) throw textbookUnavailable();
      const service = new TextbookService(this.config, undefined, scope);
      // A half bundle or crossed source metadata must not serve even one side.
      await service.rawManifest();
      await service.semanticJson('manifest.json');
      return service;
    } catch { throw textbookUnavailable(); }
  }

  private profile(manifest: JsonObject) { return semanticSourceProfile(manifest, this.revisionScope?.sourceRevision); }
  private async semanticJson(filename: string, profile?: SemanticSourceProfile) {
    const data = this.revisionScope ? await readSemanticDirectoryJson(this.revisionScope.semanticDirectory, filename, profile) : await readSemanticJson(this.semanticRoot(), filename, profile);
    if (filename === 'manifest.json') this.profile(data);
    return data;
  }
  private semanticFile(filename: string, profile: SemanticSourceProfile) {
    return this.revisionScope ? readSemanticDirectoryFile(this.revisionScope.semanticDirectory, filename, profile) : readSemanticFile(this.semanticRoot(), filename, profile);
  }

  async semanticManifest() { return publicData(await this.semanticJson('manifest.json')); }

  async semanticQuiz(id: string) {
    if (!semanticQuizId(id)) throw notFound();
    const manifest = await this.semanticJson('manifest.json');
    const entry = (manifest.quizzes as JsonObject[]).find(q => q.id === id);
    if (!entry) throw notFound();
    const data = await this.semanticJson(`quizzes/${id}.json`, this.profile(manifest));
    if (entry.itemCount !== undefined && entry.itemCount !== (data.items as unknown[]).length) throw textbookUnavailable();
    return publicData(data);
  }

  async semanticChoices(id: string) {
    if (!semanticQuizId(id)) throw notFound();
    const manifest = await this.semanticJson('manifest.json');
    const profile = this.profile(manifest);
    const entry = Array.isArray(manifest.fourChoices) ? (manifest.fourChoices as JsonObject[]).find(q => q.id === id) : undefined;
    if (!entry) throw notFound();
    const data = await this.semanticJson(`quizzes/four-choice/${id}.json`, profile);
    if (entry.itemCount !== (data.items as unknown[]).length) throw textbookUnavailable();
    const sourceBytes = await this.semanticFile(`quizzes/${id}.json`, profile);
    if (createHash('sha256').update(sourceBytes).digest('hex') !== data.sourceQuizSha256) throw textbookUnavailable();
    const original = await this.semanticJson(`quizzes/${id}.json`, profile);
    for (const value of data.items as JsonObject[]) {
      const source = (original.items as JsonObject[]).find(i => i.id === value.sourceItemId);
      const question = value.sourceQuestion as JsonObject;
      const correct = (value.options as JsonObject[]).find(o => o.id === value.correctOptionId);
      if (!source || !object(source.answer) || correct?.text !== source.answer.text
        || question.text !== source.text || question.sourceText !== source.sourceText
        || JSON.stringify(question.segments) !== JSON.stringify(source.segments)
        || JSON.stringify(question.source) !== JSON.stringify(source.source)
        || question.originalNumber !== source.originalNumber) throw textbookUnavailable();
      for (const option of value.options as JsonObject[]) {
        const grounded = (option.sourceRefs as JsonObject[]).some(ref => ref.kind === 'original-quiz-answer'
          && ref.quizId === id && ref.quizSha256 === data.sourceQuizSha256
          && (original.items as JsonObject[]).some(i => i.id === ref.itemId && object(i.answer) && i.answer.text === option.text));
        if (!grounded) throw textbookUnavailable();
      }
    }
    return publicData(data);
  }

  async semanticPage(page: string) {
    if (!/^[1-9]\d{0,2}$/.test(page)) throw notFound();
    const manifest = await this.semanticJson('manifest.json').catch(error => {
      // Without a validated source the original144 bound still applies.
      if (!semanticPageNumber(Number(page))) throw notFound();
      throw error;
    });
    const profile = this.profile(manifest);
    if (!semanticPageNumber(Number(page), profile)) throw notFound();
    if (!(manifest.pages as JsonObject[]).some(p => p.pdfPage === Number(page))) throw notFound();
    return publicData(await this.semanticJson(`pages/page-${page.padStart(3, '0')}.json`, profile));
  }

  async semanticFigure(id: string): Promise<{ data: Buffer; mime: 'image/jpeg' | 'image/png' }> {
    if (!/^p\d{3}-figure-[1-9]\d{0,2}$/.test(id)) throw notFound();
    const manifest = await this.semanticJson('manifest.json').catch(error => {
      if (!semanticFigureId(id)) throw notFound();
      throw error;
    });
    const profile = this.profile(manifest);
    if (!semanticFigureId(id, profile)) throw notFound();
    const entry = Array.isArray(manifest.figures) ? manifest.figures.find(f => object(f) && f.id === id) as JsonObject | undefined : undefined;
    if (!entry) throw notFound();
    const extension = entry.extension ?? 'jpeg';
    const data = await this.semanticFile(`assets/${id}.${extension}`, profile);
    const valid = extension === 'png' ? data.subarray(0, 8).equals(PNG_SIGNATURE)
      : data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9;
    if (!valid || (entry.bytes !== undefined && entry.bytes !== data.length)
      || (typeof entry.sha256 === 'string' && createHash('sha256').update(data).digest('hex') !== entry.sha256.toLowerCase())) throw textbookUnavailable();
    return { data, mime: extension === 'png' ? 'image/png' : 'image/jpeg' };
  }

  private async root(): Promise<string> {
    if (this.revisionScope) {
      if (await realpath(this.revisionScope.rawDirectory) !== this.revisionScope.rawDirectory) throw textbookUnavailable();
      return this.revisionScope.rawDirectory;
    }
    return resolveTextbookDataRoot(this.config.textbook?.dataDir, projectRoot());
  }

  private async read(relativePath: string, maxBytes: number, optional = false): Promise<Buffer> {
    const root = await this.root();
    try {
      const candidate = resolve(root, relativePath);
      const canonical = await realpath(candidate);
      if (!within(root, canonical) || canonical !== candidate) throw textbookUnavailable();
      const file = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > maxBytes) throw textbookUnavailable();
        return await file.readFile();
      } finally { await file.close(); }
    } catch (error) {
      if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') throw notFound();
      throw textbookUnavailable();
    }
  }

  private async rawManifest(): Promise<JsonObject & { pages: JsonObject[] }> {
    try {
      const data: unknown = JSON.parse((await this.read('manifest.json', 4 * 1024 * 1024)).toString('utf8'));
      if (!object(data) || !object(data.source) || !Array.isArray(data.pages)
        || typeof data.source.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(data.source.sha256)
        || !Number.isSafeInteger(data.source.bytes) || Number(data.source.bytes) <= 0
        || !Number.isSafeInteger(data.source.pageCount) || data.source.pageCount !== data.pages.length
        || !data.pages.length || data.pages.length > 9999
        || !data.pages.every((p, i) => object(p) && p.pdfPage === i + 1
          && typeof p.width === 'number' && Number.isFinite(p.width) && p.width > 0
          && typeof p.height === 'number' && Number.isFinite(p.height) && p.height > 0
          && (p.printedPage === null || Number.isSafeInteger(p.printedPage)))) throw textbookUnavailable();
      if (this.revisionScope) {
        if (data.source.sha256 !== this.revisionScope.sourceRevision || data.source.pageCount !== textbookRevisionPageCount(this.revisionScope.sourceRevision)
          || !data.pages.every((p, i) => object(p) && p.dataPath === `pages/page-${String(i + 1).padStart(3, '0')}.json` && p.imagePath === `renders/page-${String(i + 1).padStart(3, '0')}.png`
            && typeof p.dataSha256 === 'string' && /^[a-f0-9]{64}$/i.test(p.dataSha256) && typeof p.imageSha256 === 'string' && /^[a-f0-9]{64}$/i.test(p.imageSha256))) throw textbookUnavailable();
      }
      return data as JsonObject & { pages: JsonObject[] };
    } catch { throw textbookUnavailable(); }
  }

  private async selected(page: string): Promise<{ pageNumber: number; stem: string; entry: JsonObject }> {
    if (!/^[1-9]\d{0,3}$/.test(page)) throw notFound();
    const pageNumber = Number(page);
    const manifest = await this.rawManifest();
    const entry = manifest.pages[pageNumber - 1];
    if (!entry) throw notFound();
    const stem = `page-${String(pageNumber).padStart(3, '0')}`;
    if (entry.dataPath !== `pages/${stem}.json` || entry.imagePath !== `renders/${stem}.png`) throw textbookUnavailable();
    return { pageNumber, stem, entry };
  }

  async manifest() { return publicData(await this.rawManifest()); }

  async page(page: string) {
    const { stem, pageNumber, entry } = await this.selected(page);
    try {
      const bytes = await this.read(`pages/${stem}.json`, 32 * 1024 * 1024);
      if (this.revisionScope && createHash('sha256').update(bytes).digest('hex') !== String(entry.dataSha256).toLowerCase()) throw textbookUnavailable();
      const data: unknown = JSON.parse(bytes.toString('utf8'));
      if (!object(data) || data.pdfPage !== pageNumber || data.printedPage !== entry.printedPage
        || data.width !== entry.width || data.height !== entry.height || !Array.isArray(data.textBlocks)) throw textbookUnavailable();
      if (this.revisionScope) validateSourceReferences(data, {maxPdfPages: textbookRevisionPageCount(this.revisionScope.sourceRevision), sourceSha256: this.revisionScope.sourceRevision, checkReferences: true});
      return publicData(data);
    } catch { throw textbookUnavailable(); }
  }

  async image(page: string, enhanced = false): Promise<Buffer> {
    const { stem, entry } = await this.selected(page);
    const data = await this.read(`${enhanced ? 'enhanced' : 'renders'}/${stem}.png`, 32 * 1024 * 1024, enhanced);
    if (this.revisionScope && !enhanced && createHash('sha256').update(data).digest('hex') !== String(entry.imageSha256).toLowerCase()) throw textbookUnavailable();
    if (!data.subarray(0, 8).equals(PNG_SIGNATURE)) throw textbookUnavailable();
    return data;
  }
}

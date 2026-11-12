import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, parse, resolve, sep } from 'node:path';
import { AppError, notFound } from '../common/app-error';
import { JOSEON_SCRIPT_PIN } from './joseon-script.pin';

export const JOSEON_SCRIPT_ROOT = Symbol('JOSEON_SCRIPT_ROOT');
export const JOSEON_SCRIPT_IDENTITY = Symbol('JOSEON_SCRIPT_IDENTITY');
export interface ScriptPin {
  schema: string; sourceSha256: string; sourceBytes: number; prefix: string;
  bundle: { bytes: number; sha256: string };
  figures: readonly { name: string; bytes: number; sha256: string; width: number; height: number; assetKey: string }[];
}
const unavailable = () => new AppError(503, 'script_unavailable', 'Private Script is unavailable');
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const digest = (s: string) => /^[a-f0-9]{64}$/.test(s);
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
type Verified = { bundle: Buffer; figures: Map<string, Buffer> };

/** Fixed immutable private edition. No legacy fallback, environment-selected JSON or user file paths. */
@Injectable()
export class JoseonScriptService {
  private readonly root: string;
  private readonly pin: ScriptPin;
  private verified?: Promise<Verified>;
  constructor(
    @Optional() @Inject(JOSEON_SCRIPT_ROOT) root?: string,
    @Optional() @Inject(JOSEON_SCRIPT_IDENTITY) pin?: ScriptPin,
  ) {
    this.root = root ?? '/run/hanq-private-script/history/joseon/81-2026/8d0944e32d86';
    this.pin = pin ?? JOSEON_SCRIPT_PIN;
  }

  private async read(name: string, expected: { bytes: number; sha256: string }, max: number): Promise<Buffer> {
    if (!/^(?:scirpt\.md|bundle\.json|p\d{3}-\d{2}\.png)$/.test(name) ||
        !Number.isSafeInteger(expected.bytes) || expected.bytes < 1 || expected.bytes > max || !digest(expected.sha256)) throw unavailable();
    const file = join(this.root, name);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== expected.bytes || await realpath(file) !== resolve(file)) throw unavailable();
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== expected.bytes) throw unavailable();
      // Bounded allocation/read, including when an input grows during verification.
      const data = Buffer.alloc(expected.bytes + 1);
      let offset = 0;
      while (offset < data.length) {
        const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      const bytes = data.subarray(0, offset);
      if (offset !== expected.bytes || hash(bytes) !== expected.sha256) throw unavailable();
      return bytes;
    } finally { await handle.close(); }
  }

  private async verify(): Promise<Verified> {
    const p = this.pin;
    if (p.schema !== 'hanq-joseon-script-pin/1' || !digest(p.sourceSha256) ||
        p.prefix !== `history/joseon/81-2026/${p.sourceSha256.slice(0, 12)}/` || p.figures.length !== 38 ||
        new Set(p.figures.map(f => f.name)).size !== 38 || !isAbsolute(this.root)) throw unavailable();
    // Reject symlinks/junctions at every ancestor, not only the leaf file.
    let current = parse(resolve(this.root)).root;
    for (const part of resolve(this.root).slice(current.length).split(sep)) {
      current = join(current, part);
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(current) !== resolve(current)) throw unavailable();
    }
    await this.read('scirpt.md', { bytes: p.sourceBytes, sha256: p.sourceSha256 }, 256_000);
    const bundle = await this.read('bundle.json', p.bundle, 512_000);
    const b = JSON.parse(bundle.toString('utf8'));
    if (b.schema !== 'hanq-joseon-script/1' || b.source?.sha256 !== p.sourceSha256 || b.source.bytes !== p.sourceBytes ||
        b.source.assetKeyPrefix !== p.prefix || b.source.access !== 'authenticated-private-only' ||
        b.source.canonicalQuizMapping !== 'not-established' || b.source.questions !== 172 ||
        JSON.stringify(b.source.pages) !== JSON.stringify(Array.from({ length: 29 }, (_, i) => i + 59)) ||
        !Array.isArray(b.topics) || b.topics.length !== 4 || !Array.isArray(b.segments) || b.segments.length !== 45 ||
        !b.segments.every((s: { id?: unknown; markdown?: unknown; kind?: string }) => typeof s.id === 'string' && typeof s.markdown === 'string' && ['metadata', 'study', 'practice', 'answers'].includes(s.kind ?? '')) ||
        JSON.stringify(b.figures) !== JSON.stringify(p.figures.map(f => f.name)) ||
        JSON.stringify(b.figureManifest) !== JSON.stringify(p.figures)) throw unavailable();
    const figures = new Map<string, Buffer>();
    for (const f of p.figures) {
      if (!/^p\d{3}-\d{2}\.png$/.test(f.name) || f.assetKey !== p.prefix + f.name ||
          !Number.isSafeInteger(f.width) || !Number.isSafeInteger(f.height) || f.width < 1 || f.height < 1 ||
          f.width > 10000 || f.height > 10000 || f.width * f.height > 40_000_000) throw unavailable();
      const bytes = await this.read(f.name, f, 2_000_000);
      if (bytes.length < 33 || !bytes.subarray(0, 8).equals(pngSignature) || bytes.readUInt32BE(8) !== 13 ||
          bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(16) !== f.width || bytes.readUInt32BE(20) !== f.height) throw unavailable();
      figures.set(f.name, bytes);
    }
    return { bundle, figures };
  }

  private load(source: string) {
    if (source !== this.pin.sourceSha256) throw notFound();
    // Serve only fully verified bytes; subsequent disk changes cannot change this process's edition.
    this.verified ??= this.verify().catch(() => { this.verified = undefined; throw unavailable(); });
    return this.verified;
  }
  async bundle(source: string) { return (await this.load(source)).bundle; }
  async figure(source: string, name: string) {
    if (!this.pin.figures.some(f => f.name === name)) throw notFound();
    const value = (await this.load(source)).figures.get(name);
    if (!value) throw unavailable();
    return value;
  }
}

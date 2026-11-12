import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, parse, resolve, sep } from 'node:path';
import { AppError, notFound } from '../common/app-error';
import { OPENING_SCRIPT_PIN } from './opening-script.pin';

export const OPENING_SCRIPT_ROOT = Symbol('OPENING_SCRIPT_ROOT');
export const OPENING_SCRIPT_IDENTITY = Symbol('OPENING_SCRIPT_IDENTITY');
export interface ScriptPin {
  schema: string; projectionSha256: string; sourceSha256: string; sourceBytes: number; prefix: string;
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
export class OpeningScriptService {
  private readonly root: string;
  private readonly pin: ScriptPin;
  private verified?: Promise<Verified>;
  constructor(
    @Optional() @Inject(OPENING_SCRIPT_ROOT) root?: string,
    @Optional() @Inject(OPENING_SCRIPT_IDENTITY) pin?: ScriptPin,
  ) {
    this.root = root ?? '/run/hanq-private-script/history/opening/81-2026/255c37fb6812';
    this.pin = pin ?? OPENING_SCRIPT_PIN;
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
    if (p.schema !== 'hanq-opening-script-pin/1' || !digest(p.sourceSha256) ||
        p.prefix !== `history/opening/81-2026/${p.sourceSha256.slice(0, 12)}/` || p.figures.length !== 15 ||
        new Set(p.figures.map(f => f.name)).size !== 15 || !isAbsolute(this.root)) throw unavailable();
    // Reject symlinks/junctions at every ancestor, not only the leaf file.
    let current = parse(resolve(this.root)).root;
    for (const part of resolve(this.root).slice(current.length).split(sep)) {
      current = join(current, part);
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(current) !== resolve(current)) throw unavailable();
    }
    const source = await this.read('scirpt.md', { bytes: p.sourceBytes, sha256: p.sourceSha256 }, 256_000);
    const bundle = await this.read('bundle.json', p.bundle, 512_000);
    const b = JSON.parse(bundle.toString('utf8'));
    const inventory = [...p.figures.map(({ name, bytes, sha256, width, height }) => ({ name, bytes, sha256, width, height })),
      { name: 'scirpt.md', bytes: p.sourceBytes, sha256: p.sourceSha256 }];
    const topics = [{ id: 'heungseon', from: 89, to: 90 }, { id: 'opening-policy', from: 91, to: 95 },
      { id: 'sovereignty', from: 96, to: 104 }, { id: 'culture', from: 105, to: 107 }];
    if (b.schema !== 'hanq-opening-local/1' || b.source?.sha256 !== p.sourceSha256 || b.source.bytes !== p.sourceBytes ||
        !digest(p.projectionSha256) || b.projectionSha256 !== p.projectionSha256 ||
        typeof b.markdown !== 'string' || !Buffer.from(b.markdown, 'utf8').equals(source) ||
        !Array.isArray(b.topics) || b.topics.length !== 4 ||
        !b.topics.every((t: { id?: string; title?: unknown; from?: number; to?: number }, i: number) =>
          t.id === topics[i].id && t.from === topics[i].from && t.to === topics[i].to && typeof t.title === 'string') ||
        b.counts?.questions !== 118 || b.counts.answers !== 118 || b.counts.fields !== 119 ||
        b.counts.candidates !== 41 || b.counts.orderQuestions !== 4 ||
        JSON.stringify(b.inventory) !== JSON.stringify(inventory)) throw unavailable();
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
  async bundle(source: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const data = await this.load(source);
    signal?.throwIfAborted();
    return data.bundle;
  }
  async figure(source: string, name: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!this.pin.figures.some(f => f.name === name)) throw notFound();
    const value = (await this.load(source)).figures.get(name);
    signal?.throwIfAborted();
    if (!value) throw unavailable();
    return value;
  }
}

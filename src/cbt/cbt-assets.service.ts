import { Inject, Injectable, Logger } from '@nestjs/common';
import { constants } from 'node:fs';
import { open, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AppConfig } from '../config/config';
import { AppError } from '../common/app-error';
import { APP_CONFIG } from '../common/tokens';
import { sha256hex } from '../common/util';
import { CBT_ASSET_NAME } from './cbt-policy';

export const MAX_ASSET_BYTES = 8 * 1024 * 1024;

export const assetUnavailable = () => new AppError(503, 'asset_unavailable', 'This question image is not available right now');

/** Reads canonical CBT images from the user-approved public frontend, or an optional legacy private directory.
 *  - The name is checked against the canonical pattern (no separators, no dots beyond ".webp").
 *  - The directory and the file are both resolved with realpath; a file whose real location is not directly inside the
 *    real directory (symlink escape) is refused. The resolved file is opened with O_NOFOLLOW and must be a regular file.
 *  - Optional manifest (HANQ_CBT_ASSET_MANIFEST: {"files": {"79-01.webp": "<sha256 hex>" | {"sha256": "<hex>"}}}) is the
 *    integrity evidence for the canonical crops. The legacy question imageSha256 values are NOT compared (they
 *    describe older crops and differ for some questions).
 *  Any problem → 503 asset_unavailable for that image only; the rest of the API is unaffected. Paths are never logged. */
@Injectable()
export class CbtAssetsService {
  private readonly logger = new Logger('CbtAssets');
  private readonly dir: string | null;
  private readonly manifestFile: string | null;
  private readonly publicBase: string | null;
  private publicManifest: { until: number; value: Promise<Map<string, string> | null> } | null = null;
  private manifest: Promise<Map<string, string> | null> | null = null;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.dir = config.cbt?.assetDir ?? null;
    this.publicBase = config.cbt?.publicAssetBaseUrl ?? null;
    this.manifestFile = config.cbt?.manifestFile ?? null;
  }

  clearCatalogCache(): void { this.publicManifest=null;this.manifest=null; }

  get configured(): boolean {
    return this.dir !== null || this.publicBase !== null;
  }

  async read(name: string, signal?: AbortSignal): Promise<Buffer> {
    if (typeof name !== 'string' || !CBT_ASSET_NAME.test(name)) throw new AppError(404, 'not_found', 'Not found');
    if (this.dir) {
      try { return await this.readLocal(name); }
      catch (e) { if (!(e instanceof AppError) || e.code !== 'asset_unavailable' || !this.publicBase) throw e; }
    }
    if (!this.publicBase) throw assetUnavailable();
    const want = (await this.loadPublicManifest(signal))?.get(name);
    if (!want) throw assetUnavailable();
    const buf = await this.remoteBuffer(name, MAX_ASSET_BYTES, signal);
    if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP' || sha256hex(buf) !== want) throw assetUnavailable();
    return buf;
  }

  /** Fast list readiness: registered public manifest entries, or fully checked private files.
   * A list never downloads501remote images. start() still verifies every byte of the selected round before its clock starts. */
  async verifyCatalog(names: Iterable<string>, signal: AbortSignal): Promise<void> {
    const list=[...names];
    if(list.some(name=>typeof name!=='string'||!CBT_ASSET_NAME.test(name))) throw assetUnavailable();
    if(this.dir){try{for(const name of list)await this.readLocal(name);return;}catch(e){if(!(e instanceof AppError)||e.code!=='asset_unavailable'||!this.publicBase)throw e;}}
    if(!this.publicBase)throw assetUnavailable();
    const manifest=await this.loadPublicManifest(signal);
    if(!manifest||list.some(name=>!manifest.has(name)))throw assetUnavailable();
  }

  /** Bounded preflight: finish each batch before returning errors, and cap the entire operation below client timeout. */
  async verify(names: Iterable<string>, signal: AbortSignal = AbortSignal.timeout(12_000)): Promise<void> {
    const list = [...names];
    for (let i = 0; i < list.length; i += 4) {
      if (signal.aborted) throw assetUnavailable();
      const results = await Promise.allSettled(list.slice(i, i + 4).map((name) => this.read(name, signal)));
      const failed = results.find((r) => r.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    }
  }

  private async readLocal(name: string): Promise<Buffer> {
    let root: string, file: string;
    try {
      root = await realpath(this.dir!);
      if (!(await stat(root)).isDirectory()) throw new Error('not a directory');
      file = await realpath(join(root, name));
    } catch {
      throw assetUnavailable();
    }
    if (dirname(file) !== root) {
      this.logger.warn('refused an asset whose real path is outside the asset directory');
      throw assetUnavailable();
    }
    let buf: Buffer;
    try {
      const fh = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const st = await fh.stat();
        if (!st.isFile() || st.size < 12 || st.size > MAX_ASSET_BYTES) throw new Error('bad file');
        buf = await fh.readFile();
      } finally {
        await fh.close();
      }
    } catch {
      throw assetUnavailable();
    }
    if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') throw assetUnavailable();
    if (this.manifestFile) {
      const m = await this.loadManifest();
      const want = m?.get(name);
      if (!want || want !== sha256hex(buf)) throw assetUnavailable();
    }
    return buf;
  }

  /** Fixed public deployment source; never uses an item-supplied URL or follows redirects. */
  private async remoteBuffer(name: string, max: number, signal?: AbortSignal): Promise<Buffer> {
    try {
      const response = await fetch(`${this.publicBase}/${name}`, { redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
      if (!response.ok || !response.body || Number(response.headers.get('content-length') ?? 0) > max) throw new Error('unavailable');
      const reader = response.body.getReader(), chunks: Buffer[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > max) throw new Error('oversized');
          chunks.push(Buffer.from(value));
        }
      } finally { await reader.cancel(); }
      return Buffer.concat(chunks);
    } catch(e) { if(signal?.aborted||(e instanceof Error&&['TimeoutError','AbortError'].includes(e.name)))throw new AppError(503,'asset_check_timeout','Image readiness check timed out; retry');throw assetUnavailable(); }
  }

  private loadPublicManifest(signal?: AbortSignal): Promise<Map<string, string> | null> {
    if (this.publicManifest && this.publicManifest.until > Date.now()) return this.publicManifest.value;
    const value = (async () => {
      try {
        const raw = JSON.parse((await this.remoteBuffer('manifest.json', 1024 * 1024, signal)).toString('utf8')) as { files?: Record<string, unknown> };
        const out = new Map<string, string>();
        for (const [name, v] of Object.entries(raw.files ?? {})) {
          const hash = typeof v === 'string' ? v : v && typeof v === 'object' ? (v as { sha256?: unknown }).sha256 : null;
          if (CBT_ASSET_NAME.test(name) && typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash)) out.set(name, hash);
        }
        return out;
      } catch(e) {if(e instanceof AppError&&e.code==='asset_check_timeout'){this.publicManifest=null;throw e;}return null;}
    })();
    this.publicManifest = { until: Date.now() + 5_000, value };
    return value;
  }

  private loadManifest(): Promise<Map<string, string> | null> {
    this.manifest ??= (async () => {
      try {
        const raw = JSON.parse(await readFile(this.manifestFile!, 'utf8')) as { files?: Record<string, unknown> };
        const out = new Map<string, string>();
        for (const [k, v] of Object.entries(raw.files ?? {})) {
          const h = typeof v === 'string' ? v : v && typeof v === 'object' ? (v as { sha256?: unknown }).sha256 : null;
          if (CBT_ASSET_NAME.test(k) && typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)) out.set(k, h);
        }
        return out;
      } catch {
        this.logger.warn('CBT asset manifest could not be read; CBT images stay unavailable');
        this.manifest = null; // retried on the next request (e.g. once the private volume is mounted)
        return null;
      }
    })();
    return this.manifest;
  }
}

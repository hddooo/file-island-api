import { open } from 'node:fs/promises';
import { loadDatabaseConfig } from '../src/config/config';
import { createPool } from '../src/db/db.service';
import { sha256hex } from '../src/common/util';
import { appendCbt67To69, CbtAppendError, parseCbt67To69Append } from '../src/questions/cbt-67-69-appender';

const LIMIT = 16 * 1024 * 1024;
async function main() {
  const [mode, source, expected, ...rest] = process.argv.slice(2);
  if (!['--dry-run','--apply'].includes(mode ?? '') || !source || !expected || rest.length || !/^[a-f0-9]{64}$/.test(expected)) {
    console.error('usage: append-cbt-67-69 --dry-run|--apply <private-json-file> <sha256>');
    process.exitCode = 2;
    return;
  }
  const file = await open(source, 'r');
  let raw: unknown;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 2 || stat.size > LIMIT) throw new CbtAppendError('source_scope');
    // Make the byte bound hold even when the input file changes between its stat and read.
    const buffer = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const bytes = buffer.subarray(0, offset);
    if (offset !== stat.size || sha256hex(bytes) !== expected) throw new CbtAppendError('source_scope');
    try { raw = JSON.parse(bytes.toString('utf8')); }
    catch { throw new CbtAppendError('source_scope'); }
  } finally { await file.close(); }
  parseCbt67To69Append(raw); // Keep unreviewed content out of the DB connection path.
  const pool = createPool(loadDatabaseConfig(process.env).database);
  try { console.log(JSON.stringify(await appendCbt67To69(pool, raw, mode === '--apply', new Date()))); }
  finally { await pool.end(); }
}

main().catch(e => {
  console.error('[append-cbt-67-69] failed: ' + (e instanceof CbtAppendError ? e.reason : 'operation_failed'));
  process.exitCode = 1;
});

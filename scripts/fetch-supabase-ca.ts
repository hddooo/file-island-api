import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SUPABASE_CA_FILE, SUPABASE_CA_SHA256, SUPABASE_CA_URL, supabaseCaPath, verifiedSupabaseCa } from '../src/db/supabase-ca';

/** npm run ca:supabase — reproducibly fetches Supabase's PUBLIC server CA (prod-ca-2021) over HTTPS and writes
 *  certs/supabase-prod-ca-2021.crt ONLY if its SHA-256 fingerprint equals the pinned value. Changes no global trust store,
 *  reads no secrets, contacts no database. If a valid file is already present, nothing is downloaded. */
async function main() {
  const target = supabaseCaPath();
  if (existsSync(target) && verifiedSupabaseCa(readFileSync(target, 'utf8'))) {
    console.log(`[ca] ${SUPABASE_CA_FILE} already present and matches the pinned fingerprint`);
    return;
  }
  const res = await fetch(SUPABASE_CA_URL, { redirect: 'error' });
  if (!res.ok) throw new Error(`download failed with HTTP ${res.status}`);
  const pem = await res.text();
  if (!verifiedSupabaseCa(pem)) throw new Error(`downloaded certificate does not match the pinned fingerprint ${SUPABASE_CA_SHA256}; nothing written`);
  mkdirSync(dirname(target), { recursive: true });
  const tmp = target + '.tmp';
  writeFileSync(tmp, pem, { mode: 0o644 });
  renameSync(tmp, target);
  console.log(`[ca] wrote ${SUPABASE_CA_FILE} (SHA-256 ${SUPABASE_CA_SHA256})`);
}

main().catch((e: Error) => {
  console.error(`[ca] failed: ${e.message}`);
  process.exit(1);
});

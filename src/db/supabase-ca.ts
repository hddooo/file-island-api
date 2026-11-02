import { X509Certificate } from 'node:crypto';
import { join } from 'node:path';
import { projectRoot } from '../common/project-root';

/** Supabase's public server CA ("prod-ca-2021"). This is a public certificate, not a credential.
 *  Source: the download link Supabase Studio uses (supabase/supabase apps/studio/hooks/custom-content/custom-content.json).
 *  The file is accepted only if its SHA-256 fingerprint equals the pin below, so a tampered or wrong file fails closed. */
export const SUPABASE_CA_URL = 'https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt';
export const SUPABASE_CA_SHA256 = '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA';
export const SUPABASE_CA_FILE = 'certs/supabase-prod-ca-2021.crt';

export const supabaseCaPath = () => join(projectRoot(), SUPABASE_CA_FILE);

/** Hosts served by Supabase (direct db.<ref>.supabase.co and the pooler *.pooler.supabase.com). */
export function isSupabaseHost(host: string): boolean {
  return /(^|\.)supabase\.(co|com)$/i.test(host.replace(/\.$/, ''));
}

/** Returns the PEM if it parses as a certificate whose SHA-256 fingerprint is the pinned Supabase CA, else null. */
export function verifiedSupabaseCa(pem: string): string | null {
  try {
    const cert = new X509Certificate(pem);
    return cert.fingerprint256.toUpperCase() === SUPABASE_CA_SHA256 && cert.ca ? pem : null;
  } catch {
    return null;
  }
}

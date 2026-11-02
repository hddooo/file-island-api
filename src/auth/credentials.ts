import { AppError } from '../common/app-error';

/** C0/C1 controls, zero-width marks (U+200B–200F), line/paragraph separators and bidi embeddings/overrides
 *  (U+2028–202E), bidi isolates (U+2066–2069) and the BOM. Built from code points so this source file contains no
 *  invisible or line-terminator characters (a literal U+2028 inside a regex literal breaks the TypeScript parser). */
const CONTROL_RANGES: [number, number][] = [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]];
const CONTROL = new RegExp('[' + CONTROL_RANGES.map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('') + ']');
const EMAIL = /^[^\s@]{1,64}@[^\s@.][^\s@]*\.[^\s@]{2,}$/;

/** Unique key = trimmed, NFKC, lower-cased address. The original casing is kept only for display. */
export function normalizeEmail(raw: string): { normalized: string; display: string } {
  const nf = String(raw ?? '').normalize('NFKC');
  // Ordinary surrounding spaces are trimmed; controls/separators/BOM anywhere (even at the ends) are rejected.
  const display = nf.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
  if (display.length < 3 || display.length > 254 || CONTROL.test(display) || !EMAIL.test(display)) {
    throw new AppError(400, 'invalid_email', 'Enter a valid e-mail address');
  }
  return { normalized: display.toLowerCase(), display };
}

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/** New-password policy: 10–128 characters, not whitespace-only, not a single repeated character, not the e-mail. */
export function validateNewPassword(pw: string, emailNormalized?: string): void {
  const chars = [...String(pw ?? '')];
  const bad = (msg: string) => new AppError(400, 'weak_password', msg);
  if (chars.length < PASSWORD_MIN) throw bad(`Password must be at least ${PASSWORD_MIN} characters`);
  if (chars.length > PASSWORD_MAX) throw bad(`Password must be at most ${PASSWORD_MAX} characters`);
  if (!pw.trim() || new Set(chars).size < 4) throw bad('Password is too simple');
  if (emailNormalized && pw.toLowerCase() === emailNormalized) throw bad('Password must differ from the e-mail');
}

/** Display names: 1–40 visible characters, no control/bidi-override characters, no angle brackets. */
export function normalizeDisplayName(raw: string): string {
  const nf = String(raw ?? '').normalize('NFKC');
  // Check BEFORE collapsing whitespace: JS \s also matches U+2028/2029/FEFF, which must be rejected, not turned into spaces.
  const s = CONTROL.test(nf) ? '' : nf.replace(/\s+/g, ' ').trim();
  if ([...s].length < 1 || [...s].length > 40 || /[<>]/.test(s)) {
    throw new AppError(400, 'invalid_display_name', 'Display name must be 1–40 characters without control characters or < >');
  }
  return s;
}

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeDisplayName, normalizeEmail, validateNewPassword } from '../../src/auth/credentials';

// Special characters are built from code points so this file has no invisible characters.
const ch = (cp: number) => String.fromCharCode(cp);
const SPECIALS: [string, number][] = [
  ['NUL', 0x00], ['BEL', 0x07], ['DEL', 0x7f], ['C1 NEL', 0x85], ['ZERO WIDTH SPACE', 0x200b], ['RLM', 0x200f],
  ['LINE SEPARATOR', 0x2028], ['PARAGRAPH SEPARATOR', 0x2029], ['RLO', 0x202e], ['LRI', 0x2066], ['PDI', 0x2069], ['BOM', 0xfeff],
];

describe('credentials', () => {
  it('normalizes e-mail for uniqueness and keeps the display form', () => {
    assert.deepEqual(normalizeEmail('  Kim.Hanq@Example.COM '), { normalized: 'kim.hanq@example.com', display: 'Kim.Hanq@Example.COM' });
    assert.equal(normalizeEmail('ＡＢＣ@example.com').normalized, 'abc@example.com'); // NFKC folds full-width letters
  });
  it('rejects malformed e-mail', () => {
    for (const bad of ['', 'a', 'no-at.example.com', 'a@b', 'a b@example.com', 'x'.repeat(250) + '@e.com', 'kim@example.com' + ch(0xfeff), ch(0x2028) + 'kim@example.com', 'kim@example.com' + ch(0x202e)]) {
      assert.throws(() => normalizeEmail(bad), { code: 'invalid_email' } as object, JSON.stringify(bad));
    }
  });
  for (const [name, cp] of SPECIALS) {
    it(`rejects ${name} (U+${cp.toString(16).toUpperCase().padStart(4, '0')}) inside e-mail and display name`, () => {
      assert.throws(() => normalizeEmail(`ab${ch(cp)}c@example.com`), { code: 'invalid_email' } as object);
      assert.throws(() => normalizeDisplayName(`한${ch(cp)}동`), { code: 'invalid_display_name' } as object);
    });
  }
  it('still accepts ordinary letters next to the excluded ranges', () => {
    assert.equal(normalizeDisplayName(`한동${ch(0x2030)}`), `한동${ch(0x2030)}`); // per-mille sign, outside every range
    assert.equal(normalizeDisplayName('Hanq 한국사'), 'Hanq 한국사');
  });
  it('password policy: 10–128 characters, not trivial, not the e-mail', () => {
    assert.throws(() => validateNewPassword('short1!'), { code: 'weak_password' } as object);
    assert.throws(() => validateNewPassword('a'.repeat(12)), { code: 'weak_password' } as object);
    assert.throws(() => validateNewPassword('x'.repeat(129) + 'abcd'), { code: 'weak_password' } as object);
    assert.throws(() => validateNewPassword('kim.hanq@example.com', 'kim.hanq@example.com'), { code: 'weak_password' } as object);
    assert.doesNotThrow(() => validateNewPassword('한국사 공부 2026 화이팅'));
  });
  it('display names: trimmed, 1–40 chars, no markup', () => {
    assert.equal(normalizeDisplayName('  한  동  '), '한 동');
    for (const bad of ['', '   ', '<script>', 'x'.repeat(41)]) assert.throws(() => normalizeDisplayName(bad), { code: 'invalid_display_name' } as object);
  });
});

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readSemanticFile, readSemanticJson, validateSemanticJson } from '../../src/textbook/semantic-data';

test('semantic schemas validate fixed identities and reject unverified quiz pairs', () => {
  const page = { schemaVersion: 'hanq-semantic/1', pdfPage: 12, sourceSha256: 'a'.repeat(64), width: 100, height: 100, blocks: [] };
  assert.equal(validateSemanticJson('pages/page-012.json', page), page);
  assert.throws(() => validateSemanticJson('pages/page-012.json', { ...page, pdfPage: 13 }));
  const quiz = { schemaVersion: 'hanq-source-quiz/1', id: 'prehistory', source: { sha256: 'a'.repeat(64) }, items: [{ id: 'fixture', text: 'Synthetic test', segments: [], answers: [], verification: { status: 'source-verified', textVerified: true, answerPairVerified: true } }] };
  assert.equal(validateSemanticJson('quizzes/prehistory.json', quiz), quiz);
  quiz.items[0].verification.answerPairVerified = false;
  assert.throws(() => validateSemanticJson('quizzes/prehistory.json', quiz));
  assert.throws(() => validateSemanticJson('manifest.json', { schemaVersion: 'hanq-semantic-manifest/1', quizzes: [{ id: '../secret' }], pages: [] }));
});

test('semantic reads allow only exact files, enforce size and reject symlinks/malformed JSON', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'hanq-semantic-test-'));
  const root = join(repo, 'private-textbook-semantic-data');
  try {
    await assert.rejects(readSemanticFile(repo, 'manifest.json'));
    await mkdir(root);
    await writeFile(join(root, 'manifest.json'), JSON.stringify({ schemaVersion: 'hanq-semantic-manifest/1', quizzes: [{ id: 'prehistory' }], pages: [{ pdfPage: 12 }] }));
    assert.equal((await readSemanticJson(repo, 'manifest.json')).schemaVersion, 'hanq-semantic-manifest/1');
    await assert.rejects(readSemanticFile(repo, '../manifest.json'));
    await writeFile(join(root, 'manifest.json'), Buffer.alloc(2 * 1024 * 1024 + 1));
    await assert.rejects(readSemanticFile(repo, 'manifest.json'));
    await writeFile(join(root, 'manifest.json'), '{');
    await assert.rejects(readSemanticJson(repo, 'manifest.json'));
    await rm(join(root, 'manifest.json'));
    await writeFile(join(repo, 'outside.json'), '{}');
    await symlink(join(repo, 'outside.json'), join(root, 'manifest.json'));
    await assert.rejects(readSemanticFile(repo, 'manifest.json'));
    await rm(root, { recursive: true });
    await mkdir(join(repo, 'alias'));
    await symlink(join(repo, 'alias'), root);
    await assert.rejects(readSemanticFile(repo, 'manifest.json'));
  } finally { await rm(repo, { recursive: true, force: true }); }
});

test('semantic manifest refuses duplicates, invalid counts, unknown quiz IDs, and out-of-range pages', () => {
  const base = { schemaVersion: 'hanq-semantic-manifest/1', quizzes: [{ id: 'ancient', eraId: 'samguk', itemCount: 66 }], pages: [{ pdfPage: 9 }, { pdfPage: 144 }] };
  assert.equal(validateSemanticJson('manifest.json', base), base);
  for (const bad of [
    { ...base, pages: [{ pdfPage: 9 }, { pdfPage: 9 }] },
    { ...base, quizzes: [{ id: 'ancient' }, { id: 'ancient' }] },
    { ...base, pages: [{ pdfPage: 145 }] },
    { ...base, pages: [{ pdfPage: 0 }] },
    { ...base, pageCount: 1 },
    { ...base, quizCount: 2 },
    { ...base, quizzes: [{ id: 'ancient', itemCount: 201 }] },
    { ...base, quizzes: [{ id: '../other' }] },
  ]) assert.throws(() => validateSemanticJson('manifest.json', bad));
});

test('figure manifest forbids active formats, duplicates, unsafe IDs and invalid integrity metadata', () => {
  const base = { schemaVersion: 'hanq-semantic-manifest/1', quizzes: [], pages: [] };
  for (const figures of [
    [{ id: 'p009-figure-1', extension: 'svg' }],
    [{ id: 'p009-figure-1' }, { id: 'p009-figure-1' }],
    [{ id: '../secret' }], [{ id: 'p145-figure-1' }],
    [{ id: 'p009-figure-1', bytes: 2097153 }],
    [{ id: 'p009-figure-1', sha256: 'bad' }],
  ]) assert.throws(() => validateSemanticJson('manifest.json', { ...base, figures }));
  validateSemanticJson('manifest.json', { ...base, figures: [{ id: 'p012-figure-1' }, { id: 'p009-figure-2', extension: 'png', bytes: 8, sha256: 'a'.repeat(64) }] });
});

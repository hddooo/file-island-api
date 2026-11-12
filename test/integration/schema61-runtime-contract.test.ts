import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, it } from 'node:test';
import type { Pool } from 'pg';
import request from 'supertest';
import { bearer, signup, startApp, subId, type Session, type TestApp } from '../helpers/app';
import { freshDatabase, frontCatalog } from '../helpers/db';
import { testConfig } from '../helpers/env';

const SCHEMA61 = 'c27f38853d20daa55a8b2e4047515b5efec43a79c7ed2feae563218aba34c8d8';
const TITLES = ['current61-schema-and-absent-columns', 'current61-legacy-admin-xp', 'current61-hall-list-owner-learning', 'current61-absent-endpoints-no-db-writes', 'current61-preserved-schema-and-historical-ledger'] as const;
const completed = new Set<string>();
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
let pool: Pool, app: TestApp, admin: Session, owner: Session, other: Session;
let oldLedger: { event_key: string; [key: string]: unknown }[];
let columnNames: string[];
const ledger = async () => (await pool.query<{ version: string; checksum: string }>('SELECT version,checksum FROM hanq.schema_migrations ORDER BY version')).rows;
const balance = async () => Number((await pool.query<{ amount: string }>('SELECT coalesce(sum(amount),0)::text amount FROM hanq.growth_ledger WHERE user_id=$1', [owner.userId])).rows[0].amount);
async function databaseSnapshot(): Promise<string> {
  const names = (await pool.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='hanq' ORDER BY tablename")).rows;
  const digest = createHash('sha256');
  for (const { tablename } of names) {
    assert.match(tablename, /^[a-z0-9_]+$/);
    const result = await pool.query<{ value: unknown }>('SELECT to_jsonb(t) value FROM hanq."' + tablename + '" t ORDER BY to_jsonb(t)::text');
    digest.update(JSON.stringify({ table: tablename, rows: result.rows }));
  }
  return digest.digest('hex');
}
before(async () => {
  assert.equal(process.env.HANQ_QUAL_QUALIFICATION_PROFILE, 'schema61-local-private-retained-base');
  pool = await freshDatabase(testConfig()); app = await startApp();
  admin = await signup(app); owner = await signup(app); other = await signup(app);
  await pool.query("INSERT INTO hanq.member_roles(user_id,role) VALUES($1,'ADMIN')", [admin.userId]);
  oldLedger = (await pool.query<{ event_key: string; [key: string]: unknown }>('SELECT * FROM hanq.growth_ledger WHERE user_id=$1 ORDER BY event_key', [owner.userId])).rows;
});
after(async () => {
  if (app) await app.close(); if (pool) await pool.end();
  if (completed.size === TITLES.length) process.stdout.write('CURRENT61_CONTRACT ' + JSON.stringify({ version: 1, profile: 'schema61-local-private-retained-base', schemaSha256: SCHEMA61, cases: [...completed], legacyAdminXp: 'preserved', hallListAndOwnerLearning: 'preserved', schema55OnlyEndpoints: 'absent', schema55OnlyAdminColumns: 'absent', absentEndpointDatabaseUnchanged: true, historicalLedgerUnchanged: true, productionQualified: false }) + '\n');
});
it(TITLES[0], async () => {
  const rows = await ledger(); assert.equal(rows.length, 61); assert.equal(hash(rows), SCHEMA61);
  assert(rows.some(row => row.version === '056_private_script_artifacts.sql'));
  assert(!rows.some(row => row.version === '056_admin_partner_xp.sql'));
  columnNames = (await pool.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema='hanq' AND table_name='admin_xp_adjustments' ORDER BY ordinal_position")).rows.map(row => row.column_name);
  assert.deepEqual(columnNames, ['id', 'actor_id', 'user_id', 'request_id', 'requested_delta', 'balance_before', 'applied_delta', 'balance_after', 'reason', 'created_at']);
  completed.add(TITLES[0]);
});
it(TITLES[1], async () => {
  const route = '/api/v1/ops/members/' + owner.userId + '/xp', amount = await balance();
  const body = { requestId: randomUUID(), delta: 7, expectedBalance: amount, reason: 'synthetic schema61 contract' };
  await request(app.server).post(route).set(bearer(other.access)).send(body).expect(403);
  assert.equal(await balance(), amount);
  const first = await request(app.server).post(route).set(bearer(admin.access)).send(body).expect(201);
  assert.equal(first.body.replayed, false); assert.equal(first.body.adjustment.applied_delta, 7);
  assert.equal(await balance(), amount + 7);
  const snapshot = await databaseSnapshot();
  const replay = await request(app.server).post(route).set(bearer(admin.access)).send(body).expect(201);
  assert.equal(replay.body.replayed, true); assert.equal(await databaseSnapshot(), snapshot);
  await request(app.server).post(route).set(bearer(admin.access)).send({ ...body, delta: 8 }).expect(409);
  assert.equal(await databaseSnapshot(), snapshot);
  assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.admin_xp_adjustments WHERE actor_id=$1 AND request_id=$2', [admin.userId, body.requestId])).rows[0].n, 1);
  const xp = await pool.query<{ xp: string }>('SELECT coalesce(sum(xp),0)::text xp FROM hanq.owned_digimon WHERE user_id=$1', [owner.userId]);
  assert.equal(Number(xp.rows[0].xp), amount + 7);
  completed.add(TITLES[1]);
});
it(TITLES[2], async () => {
  await request(app.server).get('/api/v1/hall-of-fame').expect(401);
  await request(app.server).get('/api/v1/hall-of-fame/my-learning').expect(401);
  const ranking = await request(app.server).get('/api/v1/hall-of-fame').set(bearer(owner.access)).expect(200);
  assert(Array.isArray(ranking.body.items)); assert(ranking.body.items.some((row: { isMe: boolean }) => row.isMe));
  for (const row of ranking.body.items) assert.deepEqual(Object.keys(row).sort(), ['character', 'isMe', 'nickname', 'points', 'rank']);
  const free = (await pool.query<{ question_id: string }>("SELECT question_id FROM hanq.free_question_slots WHERE kind='quiz' ORDER BY chapter,position LIMIT 1")).rows[0];
  const question = frontCatalog().find(item => item.questionId === free.question_id); assert(question);
  await request(app.server).post('/api/v1/attempts').set(bearer(owner.access)).send({ submissionId: subId(), questionId: question.questionId, version: question.version, optionId: question.correctOptionId }).expect(201);
  const mine = await request(app.server).get('/api/v1/hall-of-fame/my-learning').set(bearer(owner.access)).expect(200);
  const theirs = await request(app.server).get('/api/v1/hall-of-fame/my-learning').set(bearer(other.access)).expect(200);
  assert(mine.body.items.length > 0); assert.equal(theirs.body.items.length, 0); assert.equal(typeof mine.body.coverage, 'string');
  for (const row of mine.body.items) assert.deepEqual(Object.keys(row).sort(), ['at', 'setName', 'subject']);
  const publicText = JSON.stringify([ranking.body, mine.body]);
  for (const secret of [owner.email, owner.userId, other.email, other.userId, question.correctOptionId, 'accessToken', 'password_hash']) assert(!publicText.includes(secret));
  completed.add(TITLES[2]);
});
it(TITLES[3], async () => {
  const snapshot = await databaseSnapshot(), member = '/api/v1/ops/members/' + owner.userId + '/partners';
  const partner = (await pool.query<{ id: string }>('SELECT id FROM hanq.owned_digimon WHERE user_id=$1 AND equipped', [owner.userId])).rows[0]; assert(partner);
  await request(app.server).get(member).set(bearer(admin.access)).expect(404);
  await request(app.server).post(member + '/' + partner.id + '/xp').set(bearer(admin.access)).send({ requestId: randomUUID(), delta: 1, expectedBalance: await balance(), expectedPartnerXp: 0, reason: 'absent route must not write' }).expect(404);
  await request(app.server).get('/api/v1/hall-of-fame/profiles/' + 'f'.repeat(32)).set(bearer(owner.access)).expect(404);
  assert.equal(await databaseSnapshot(), snapshot);
  completed.add(TITLES[3]);
});
it(TITLES[4], async () => {
  assert.equal(hash(await ledger()), SCHEMA61);
  const historical = (await pool.query('SELECT * FROM hanq.growth_ledger WHERE user_id=$1 AND event_key=ANY($2::text[]) ORDER BY event_key', [owner.userId, oldLedger.map(row => row.event_key)])).rows;
  assert.deepEqual(historical, oldLedger);
  assert.deepEqual((await pool.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema='hanq' AND table_name='admin_xp_adjustments' ORDER BY ordinal_position")).rows.map(row => row.column_name), columnNames);
  completed.add(TITLES[4]);
});

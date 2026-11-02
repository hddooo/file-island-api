import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { SignJWT, UnsecuredJWT, decodeJwt } from 'jose';
import { loadConfig } from '../../src/config/config';
import { TokenService } from '../../src/auth/token.service';

const config = loadConfig({
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://u@127.0.0.1:5432/unit_only',
  HANQ_JWT_ISSUER: 'hanq-unit',
  HANQ_JWT_ACCESS_SECRET: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0',
  HANQ_JWT_REFRESH_SECRET: '9a8b7c6d5e4f30211203f4e5d6c7b8a99a8b7c6d5e4f30211203f4e5d6c7b8a9',
});
const tokens = new TokenService(config);
const now = new Date('2026-10-08T00:00:00Z');
const user = randomUUID(), sid = randomUUID();

describe('JWT access/refresh separation', () => {
  it('round-trips a valid access token', async () => {
    const { token, expiresAt } = await tokens.signAccess(user, sid, now);
    assert.deepEqual(await tokens.verifyAccess(token, now), { userId: user, sessionId: sid });
    assert.equal(expiresAt.getTime() - now.getTime(), 604800_000);
  });
  it('rejects an expired access token (exp is enforced against the server clock)', async () => {
    const { token } = await tokens.signAccess(user, sid, now);
    assert.equal(await tokens.verifyAccess(token, new Date(now.getTime() + 604800_000)), null);
    assert.ok(await tokens.verifyAccess(token, new Date(now.getTime() + 604799_000)));
  });
  it('new login lasts exactly seven days; restore cannot extend its absolute deadline', async () => {
    const issued = await tokens.signAccess(user, sid, now);
    const claims = decodeJwt(issued.token);
    assert.equal(claims.exp! - claims.iat!, 604800);
    const restored = await tokens.signAccess(user, sid, new Date(now.getTime()+86400_000), issued.expiresAt);
    assert.equal(decodeJwt(restored.token).exp, claims.exp);
    assert.ok(await tokens.verifyAccess(restored.token,new Date(issued.expiresAt.getTime()-1000)));
    assert.equal(await tokens.verifyAccess(restored.token,issued.expiresAt),null);
  });
  it('rejects a tampered signature and a tampered payload', async () => {
    const { token } = await tokens.signAccess(user, sid, now);
    const [h, p, s] = token.split('.');
    const flip = (x: string) => (x[0] === 'A' ? 'B' : 'A') + x.slice(1);
    assert.equal(await tokens.verifyAccess(`${h}.${p}.${flip(s)}`, now), null);
    const evil = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), sub: randomUUID() })).toString('base64url');
    assert.equal(await tokens.verifyAccess(`${h}.${evil}.${s}`, now), null);
  });
  it('a refresh token is never accepted as an access token, and vice versa', async () => {
    const refresh = await tokens.signRefresh(user, sid, 'a'.repeat(43), now, new Date(now.getTime() + 3604800_000));
    assert.equal(await tokens.verifyAccess(refresh, now), null);
    const { token } = await tokens.signAccess(user, sid, now);
    assert.equal(await tokens.verifyRefresh(token, now), null);
    assert.ok(await tokens.verifyRefresh(refresh, now));
  });
  it('rejects alg=none, wrong issuer, wrong audience, wrong typ', async () => {
    const none = new UnsecuredJWT({ sid, token_use: 'access' }).setIssuer('hanq-unit').setAudience('hanq-api').setSubject(user).setIssuedAt().setExpirationTime('5m').encode();
    assert.equal(await tokens.verifyAccess(none, new Date()), null);
    const key = config.jwt.accessSecret;
    const base = () => new SignJWT({ sid, token_use: 'access' }).setSubject(user).setIssuedAt(now.getTime() / 1000).setExpirationTime(now.getTime() / 1000 + 300).setJti(randomUUID());
    assert.equal(await tokens.verifyAccess(await base().setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' }).setIssuer('evil').setAudience('hanq-api').sign(key), now), null);
    assert.equal(await tokens.verifyAccess(await base().setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' }).setIssuer('hanq-unit').setAudience('hanq-refresh').sign(key), now), null);
    assert.equal(await tokens.verifyAccess(await base().setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuer('hanq-unit').setAudience('hanq-api').sign(key), now), null);
    // Same claims, right header → accepted (proves the negatives above fail for the stated reason).
    assert.ok(await tokens.verifyAccess(await base().setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' }).setIssuer('hanq-unit').setAudience('hanq-api').sign(key), now));
  });
  it('rejects a token signed with the refresh secret even with access claims', async () => {
    const t = await new SignJWT({ sid, token_use: 'access' }).setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' }).setIssuer('hanq-unit').setAudience('hanq-api')
      .setSubject(user).setIssuedAt(now.getTime() / 1000).setExpirationTime(now.getTime() / 1000 + 300).setJti(randomUUID()).sign(config.jwt.refreshSecret);
    assert.equal(await tokens.verifyAccess(t, now), null);
  });
  it('rejects garbage and oversized input without throwing', async () => {
    for (const x of ['', 'abc', 'a.b.c', 'x'.repeat(5000)]) assert.equal(await tokens.verifyAccess(x, now), null);
  });
});

import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import type { AppConfig } from '../config/config';
import { APP_CONFIG } from '../common/tokens';
import { UUID_RE } from '../common/util';

/** Two token kinds that can never be confused: different secrets, audiences, `typ` headers and `token_use` claims, HS256 only. */
const ACCESS_TYP = 'at+jwt';
const REFRESH_TYP = 'rt+jwt';
const MAX_TOKEN_LENGTH = 2048;

export interface AccessClaims {
  userId: string;
  sessionId: string;
}
export interface RefreshClaims {
  userId: string;
  familyId: string;
  jti: string;
}

const sec = (d: Date) => Math.floor(d.getTime() / 1000);

@Injectable()
export class TokenService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async signAccess(userId: string, sessionId: string, now: Date, absoluteExpiresAt?: Date): Promise<{ token: string; expiresAt: Date }> {
    const j = this.config.jwt;
    const expiresAt = new Date(Math.min((sec(now) + j.accessTtlSec) * 1000, absoluteExpiresAt?.getTime() ?? Infinity));
    const token = await new SignJWT({ sid: sessionId, token_use: 'access' })
      .setProtectedHeader({ alg: 'HS256', typ: ACCESS_TYP })
      .setIssuer(j.issuer)
      .setAudience(j.accessAudience)
      .setSubject(userId)
      .setIssuedAt(sec(now))
      .setExpirationTime(sec(expiresAt))
      .setJti(randomUUID())
      .sign(j.accessSecret);
    return { token, expiresAt };
  }

  async signRefresh(userId: string, familyId: string, jti: string, now: Date, expiresAt: Date): Promise<string> {
    const j = this.config.jwt;
    return new SignJWT({ fam: familyId, token_use: 'refresh' })
      .setProtectedHeader({ alg: 'HS256', typ: REFRESH_TYP })
      .setIssuer(j.issuer)
      .setAudience(j.refreshAudience)
      .setSubject(userId)
      .setIssuedAt(sec(now))
      .setExpirationTime(sec(expiresAt))
      .setJti(jti)
      .sign(j.refreshSecret);
  }

  /** Returns null for anything not a valid, unexpired access token of this issuer (signature, alg, typ, aud, iss, exp, claims). */
  async verifyAccess(token: string, now: Date): Promise<AccessClaims | null> {
    if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH) return null;
    const j = this.config.jwt;
    try {
      const { payload } = await jwtVerify(token, j.accessSecret, {
        algorithms: ['HS256'],
        issuer: j.issuer,
        audience: j.accessAudience,
        typ: ACCESS_TYP,
        currentDate: now,
        requiredClaims: ['sub', 'exp', 'iat', 'jti'],
      });
      if (payload.token_use !== 'access' || typeof payload.sid !== 'string' || !UUID_RE.test(payload.sid) || !UUID_RE.test(String(payload.sub))) return null;
      return { userId: String(payload.sub), sessionId: payload.sid };
    } catch {
      return null;
    }
  }

  async verifyRefresh(token: string, now: Date): Promise<RefreshClaims | null> {
    if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH) return null;
    const j = this.config.jwt;
    try {
      const { payload } = await jwtVerify(token, j.refreshSecret, {
        algorithms: ['HS256'],
        issuer: j.issuer,
        audience: j.refreshAudience,
        typ: REFRESH_TYP,
        currentDate: now,
        requiredClaims: ['sub', 'exp', 'iat', 'jti'],
      });
      if (payload.token_use !== 'refresh' || typeof payload.fam !== 'string' || !UUID_RE.test(payload.fam) || !UUID_RE.test(String(payload.sub))) return null;
      if (typeof payload.jti !== 'string' || !/^[A-Za-z0-9_-]{32,64}$/.test(payload.jti)) return null;
      return { userId: String(payload.sub), familyId: payload.fam, jti: payload.jti };
    } catch {
      return null;
    }
  }
}

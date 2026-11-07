import{partnerState}from'../partner/evolution';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config/config';
import { AppError, unauthorized } from '../common/app-error';
import { APP_CONFIG, CLOCK, type Clock } from '../common/tokens';
import { randomToken, sha256 } from '../common/util';
import { DbService, type Queryable } from '../db/db.service';
import { normalizeDisplayName, normalizeEmail, validateNewPassword } from './credentials';
import {attendance,claimNickname} from '../portal/member-state';
import { LoginThrottleRepository } from './login-throttle.repository';
import { PasswordService } from './password.service';
import { chooseRetention, renewalDeadline, type RetentionMode } from './retention-policy';
import { SessionsRepository } from './sessions.repository';
import { TokenService } from './token.service';
import { UsersRepository, type UserRow } from './users.repository';

export interface IssuedSession {
  retentionMode?: RetentionMode;
  sessionExpiresAt?: Date;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  user: PublicUser;
}
export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export const publicUser = (u: UserRow): PublicUser => ({ id: u.id, email: u.email_display, displayName: u.display_name, createdAt: new Date(u.created_at).toISOString() });

const FAILURE_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly db: DbService,
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly throttle: LoginThrottleRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async signup(input: { email: string; password: string; displayName?: string }): Promise<{status:'pending'}> {
    const email = normalizeEmail(input.email);
    validateNewPassword(input.password, email.normalized);
    const displayName = normalizeDisplayName(input.displayName ?? (email.display.split('@')[0].slice(0,30)+'-'+randomUUID().slice(0,8)));
    const hash = await this.passwords.hash(input.password);
    const now = this.clock.now();
    return this.db.tx(async (q) => {
      const user = await this.users.insert(q, { id: randomUUID(), emailNormalized: email.normalized, emailDisplay: email.display, passwordHash: hash, displayName, now });
      if (!user) throw new AppError(409, 'email_taken', 'An account with this e-mail already exists');
      await claimNickname(q,user.id,displayName);
      return {status:'pending' as const};
    });
  }

  async signin(input: { email: string; password: string; rememberMe?: boolean }): Promise<IssuedSession> {
    if (input.rememberMe !== undefined && typeof input.rememberMe !== 'boolean') throw new AppError(400, 'invalid_remember_me', 'rememberMe must be boolean');
    if (input.rememberMe === true && !this.config.jwt.rememberEnabled) throw new AppError(503, 'remember_unavailable', 'Persistent login is not enabled');
    let email: { normalized: string };
    try {
      email = normalizeEmail(input.email);
    } catch {
      throw new AppError(401, 'invalid_credentials', 'E-mail or password is incorrect');
    }
    const now = this.clock.now();
    const key = sha256('hanq-login:' + email.normalized);
    const recent = await this.throttle.countSince(this.db.pool, key, new Date(now.getTime() - FAILURE_WINDOW_MS));
    if (recent >= this.config.rateLimit.loginFailuresPer15Min) {
      throw new AppError(429, 'too_many_failed_signins', 'Too many failed sign-ins for this account. Try again later');
    }
    const user = await this.users.findByEmail(this.db.pool, email.normalized);
    const ok = user && typeof input.password === 'string' && input.password.length <= 1024
      ? await this.passwords.verify(user.password_hash, input.password)
      : await this.passwords.verifyDummy(String(input.password ?? '').slice(0, 1024));
    if (!user || !ok) {
      await this.throttle.record(this.db.pool, key, now);
      throw new AppError(401, 'invalid_credentials', 'E-mail or password is incorrect');
    }
    // The (slow) hash check ran without locks. Before issuing a session, lock the user row and make sure the password
    // we verified is still the stored one: a password change that committed meanwhile must not be followed by a fresh
    // session created with the old password. Lock order everywhere: user row → session family.
    return this.db.tx(async (q) => {
      const locked = await this.users.findById(q, user.id, true);
      if (!locked || locked.password_hash !== user.password_hash) throw new AppError(401, 'invalid_credentials', 'E-mail or password is incorrect');
      this.assertApproved(locked);
      await attendance(q,locked.id,()=>this.clock.now(),true);
      await q.query("INSERT INTO hanq.member_access_logs(user_id,event,created_at) VALUES($1,'signin',$2)",[locked.id,now]);
      return this.issue(q, locked, now, input.rememberMe === true);
    });
  }

  /** New session family + first refresh token + access token. */
  async issue(q: Queryable, user: UserRow, now: Date, rememberMe = false): Promise<IssuedSession> {
    this.assertApproved(user);
    const j = this.config.jwt;
    const familyId = randomUUID();
    const policy = chooseRetention(rememberMe, now.getTime(), j.sessionMaxSec * 1000);
    const familyExpires = new Date(policy.expiresAt);
    await this.sessions.createFamily(q, { id: familyId, userId: user.id, now, expiresAt: familyExpires, mode: policy.mode });
    const refresh = await this.newRefresh(q, user.id, familyId, now, familyExpires, policy.mode);
    const access = await this.tokens.signAccess(user.id, familyId, now, new Date(renewalDeadline(policy, now.getTime(), j.accessTtlSec * 1000)!));
    return { retentionMode: policy.mode, sessionExpiresAt: familyExpires, accessToken: access.token, accessTokenExpiresAt: access.expiresAt, refreshToken: refresh.token, refreshTokenExpiresAt: refresh.expiresAt, user: publicUser(user) };
  }

  private async newRefresh(q: Queryable, userId: string, familyId: string, now: Date, familyExpires: Date, mode: RetentionMode = 'legacy'): Promise<{ id: string; token: string; expiresAt: Date }> {
    const id = randomUUID();
    const jti = randomToken(32);
    // Whole seconds, so the JWT exp and the stored expiry are the same instant.
    const expiresAt = new Date(Math.floor(Math.min(mode === 'remember-90d' ? familyExpires.getTime() : now.getTime() + this.config.jwt.refreshTtlSec * 1000, familyExpires.getTime()) / 1000) * 1000);
    await this.sessions.insertRefresh(q, { id, familyId, jtiHash: sha256(jti), now, expiresAt });
    return { id, token: await this.tokens.signRefresh(userId, familyId, jti, now, expiresAt), expiresAt };
  }

  /** Rotation: the presented token is marked used and replaced inside one transaction (row locks). Presenting a used token
   *  again is treated as theft: the whole family is revoked (committed) and the request fails. */
  async refresh(refreshToken: string | undefined): Promise<IssuedSession> {
    const now = this.clock.now();
    const claims = refreshToken ? await this.tokens.verifyRefresh(refreshToken, now) : null;
    if (!claims) throw unauthorized('invalid_refresh');
    const result = await this.db.tx(async (q) => {
      const row = await this.sessions.lockRefresh(q, sha256(claims.jti));
      if (!row || row.family_id !== claims.familyId || row.user_id !== claims.userId) return { kind: 'invalid' as const };
      if (row.used_at) {
        await this.sessions.revokeFamily(q, row.family_id, row.user_id, now, 'replay');
        return { kind: 'replay' as const };
      }
      if (row.family_revoked_at || row.expires_at <= now || row.family_expires_at <= now) return { kind: 'invalid' as const };
      // Legacy keeps its original access deadline; opt-in renews short access within the original family cap.
      const mode = row.retention_mode ?? 'legacy';
      const deadline = renewalDeadline({ mode, createdAt: row.family_created_at.getTime(), expiresAt: row.family_expires_at.getTime(), revoked: !!row.family_revoked_at }, now.getTime(), this.config.jwt.accessTtlSec * 1000);
      const accessDeadline = deadline === null ? now : new Date(deadline);
      if (accessDeadline <= now) return { kind: 'invalid' as const };
      const user = await this.users.findById(q, row.user_id);
      if (!user || user.approval_status !== 'approved') return { kind: 'invalid' as const };
      const next = await this.newRefresh(q, user.id, row.family_id, now, row.family_expires_at, mode);
      if (next.expiresAt <= now) return { kind: 'invalid' as const };
      await this.sessions.markUsed(q, row.id, now, next.id);
      const access = await this.tokens.signAccess(user.id, row.family_id, now, accessDeadline);
      return {
        kind: 'ok' as const,
        session: { retentionMode: mode, sessionExpiresAt: row.family_expires_at, accessToken: access.token, accessTokenExpiresAt: access.expiresAt, refreshToken: next.token, refreshTokenExpiresAt: next.expiresAt, user: publicUser(user) },
      };
    });
    if (result.kind === 'replay') throw unauthorized('refresh_reused');
    if (result.kind !== 'ok') throw unauthorized('invalid_refresh');
    return result.session;
  }

  /** Revokes the family of the presented refresh token (or of the access token's session). Always succeeds silently. */
  async logout(refreshToken: string | undefined, access: { userId: string; sessionId: string } | null): Promise<void> {
    const now = this.clock.now();
    const claims = refreshToken ? await this.tokens.verifyRefresh(refreshToken, now) : null;
    if (claims) await this.sessions.revokeFamily(this.db.pool, claims.familyId, claims.userId, now, 'logout');
    if (access) await this.sessions.revokeFamily(this.db.pool, access.sessionId, access.userId, now, 'logout');
  }

  async logoutAll(userId: string): Promise<number> {
    return this.sessions.revokeAllForUser(this.db.pool, userId, this.clock.now(), 'logout-all');
  }

  /** Used by the guard on every protected request: valid access token AND live session in the database. */
  async authenticate(accessToken: string): Promise<{ userId: string; sessionId: string } | null> {
    const now = this.clock.now();
    const claims = await this.tokens.verifyAccess(accessToken, now);
    if (!claims) return null;
    const live = await this.sessions.isFamilyActive(this.db.pool, claims.sessionId, claims.userId, now);
    if (!live) return null;
    const user=await this.users.findById(this.db.pool,claims.userId);
    return user?.approval_status === 'approved' ? claims : null;
  }

  private assertApproved(user:UserRow):void {
    if(user.approval_status!=='approved')throw new AppError(403,user.approval_status==='pending'?'membership_pending':'membership_rejected','Administrator approval is required');
  }
  private async assertAdmin(q:Queryable,id:string):Promise<void>{
    const r=await q.query("SELECT 1 FROM hanq.member_roles r JOIN hanq.users u ON u.id=r.user_id WHERE r.user_id=$1 AND r.role='ADMIN' AND u.approval_status='approved' FOR SHARE OF r,u",[id]);
    if(!r.rowCount)throw new AppError(403,'admin_required','Administrator access required');
  }
  async membershipRequests(actor:string,page:number){
    return this.db.tx(async q=>{
      await this.assertAdmin(q,actor);
      const r=await q.query("SELECT id,email_display AS email,display_name AS nickname,created_at,approval_status FROM hanq.users WHERE approval_status='pending' ORDER BY created_at,id LIMIT 25 OFFSET $1",[(page-1)*25]);
      const n=await q.query("SELECT count(*)::int total FROM hanq.users WHERE approval_status='pending'");
      return {items:r.rows,page,total:n.rows[0].total};
    });
  }
  async decideMembership(actor:string,id:string,decision:'approved'|'rejected'){
    return this.db.tx(async q=>{
      await this.assertAdmin(q,actor);
      const user=await this.users.findById(q,id,true);
      if(!user)throw new AppError(404,'not_found','Request not found');
      if(user.approval_status!=='pending'){
        if(user.approval_status===decision)return {status:decision,changed:false};
        throw new AppError(409,'membership_already_decided','Request already decided');
      }
      const role=await q.query('SELECT 1 FROM hanq.member_roles WHERE user_id=$1',[id]);
      if(role.rowCount)throw new AppError(409,'admin_membership_protected','Administrator membership cannot be changed here');
      const now=this.clock.now();
      await q.query('UPDATE hanq.users SET approval_status=$2,approval_decided_at=$3,approval_decided_by=$4,updated_at=$3 WHERE id=$1',[id,decision,now,actor]);
      if(decision==='approved'){
        await q.query("INSERT INTO hanq.growth_ledger(user_id,event_key,kind,amount,created_at) VALUES($1,'signup','signup',1000,$2) ON CONFLICT(user_id,event_key) DO NOTHING",[id,now]);
        await partnerState(q,id,'agumon',1000,now);await partnerState(q,id,'patamon',1000,now);
        await q.query("INSERT INTO hanq.member_access_logs(user_id,event,created_at) VALUES($1,'signup',$2)",[id,now]);
      }
      await q.query('INSERT INTO hanq.admin_audit(actor_id,action,target_id,created_at) VALUES($1,$2,$3,$4)',[actor,'membership.'+decision,id,now]);
      return {status:decision,changed:true};
    });
  }
}

import { CanActivate, createParamDecorator, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { AppConfig } from '../config/config';
import { AppError, unauthorized } from '../common/app-error';
import { APP_CONFIG } from '../common/tokens';
import { AuthService } from './auth.service';

export interface AuthContext {
  userId: string;
  sessionId: string;
}
type AuthedRequest = Request & { auth?: AuthContext };

/** Bearer access token → live session check. The subject always comes from the token, never from the body. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const h = req.headers.authorization;
    const m = typeof h === 'string' ? /^Bearer ([A-Za-z0-9_.-]{20,2048})$/.exec(h) : null;
    if (!m) throw unauthorized();
    const who = await this.auth.authenticate(m[1]);
    if (!who) throw unauthorized('invalid_token');
    req.auth = who;
    return true;
  }
}

/** Optional variant: attaches auth when a valid token is present, never rejects. */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const h = req.headers.authorization;
    const m = typeof h === 'string' ? /^Bearer ([A-Za-z0-9_.-]{20,2048})$/.exec(h) : null;
    if (m) req.auth = (await this.auth.authenticate(m[1])) ?? undefined;
    return true;
  }
}

export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const a = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!a) throw unauthorized();
  return a;
});

export const MaybeAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext | null => ctx.switchToHttp().getRequest<AuthedRequest>().auth ?? null);

/** Routes that read or set the refresh cookie: the Origin must be allow-listed AND the custom header present
 *  (a cross-site form or simple request cannot add it; a cross-origin fetch needs a CORS preflight we only grant to allowed origins). */
@Injectable()
export class CookieCsrfGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !this.config.cors.origins.includes(origin) || req.headers['x-hanq-csrf'] !== '1') {
      throw new AppError(403, 'csrf_rejected', 'Request origin not allowed');
    }
    return true;
  }
}

export const AUTH_RATE_LIMITED = 'hanq:auth-rate-limited';
/** Marks credential endpoints for the stricter per-IP "auth" throttler. */
export const AuthRateLimited = () => SetMetadata(AUTH_RATE_LIMITED, true);

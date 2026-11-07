import {SkipThrottle} from '@nestjs/throttler';
import {SiteGateRateLimit} from './site-gate-rate-limit';
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import type { AppConfig } from '../config/config';
import { AppError, unauthorized } from '../common/app-error';
import { APP_CONFIG } from '../common/tokens';
import { SigninDto, SignupDto } from './auth.dto';
import { AuthService, type IssuedSession } from './auth.service';
import { AuthRateLimited, CookieCsrfGuard, CurrentAuth, JwtAuthGuard, MaybeAuth, OptionalAuthGuard, type AuthContext } from './guards';

/** The refresh token travels only in an HttpOnly cookie scoped to /api/v1/auth. The access token is returned in the body
 *  (the browser keeps it in memory only). */
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private cookieOptions(expires?: Date): CookieOptions {
    const c = this.config.cookie;
    return { httpOnly: true, secure: c.secure, sameSite: c.sameSite, path: c.path, ...(expires ? { expires } : {}) };
  }

  private readonly siteRate=new SiteGateRateLimit();
  private siteCookieName(){return this.config.cookie.secure?'__Host-hanq_site':'hanq_site_dev';}
  private siteCookieOptions(expires?:Date):CookieOptions{return {httpOnly:true,secure:this.config.cookie.secure,sameSite:'lax',path:'/',...(expires?{expires}:{})};}
  @Get('site-check')
  @SkipThrottle({default:true,auth:true})
  @HttpCode(204)
  async siteCheck(@Req()req:Request):Promise<void>{
    const token=req.cookies?.[this.siteCookieName()];
    if(typeof token!=='string'||!/^[A-Za-z0-9_.-]{20,2048}$/.test(token))throw unauthorized();
    if(!this.siteRate.allow(token,Date.now()))throw new AppError(429,'site_check_rate_limited','Too many checks');
    if(!await this.auth.authenticate(token))throw unauthorized();
  }
  private respond(res: Response, s: IssuedSession) {
    res.cookie(this.siteCookieName(),s.accessToken,this.siteCookieOptions(s.accessTokenExpiresAt));
    res.cookie(this.config.cookie.name, s.refreshToken, this.cookieOptions(s.refreshTokenExpiresAt));
    return { retentionMode: s.retentionMode ?? 'legacy', sessionExpiresAt: s.sessionExpiresAt?.toISOString(), accessToken: s.accessToken, accessTokenExpiresAt: s.accessTokenExpiresAt.toISOString(), tokenType: 'Bearer', user: s.user };
  }

  private cookie(req: Request): string | undefined {
    const v = (req.cookies as Record<string, unknown> | undefined)?.[this.config.cookie.name];
    return typeof v === 'string' ? v : undefined;
  }

  @Post('signup')
  @AuthRateLimited()
  @UseGuards(CookieCsrfGuard)
  async signup(@Body() dto: SignupDto, @Res({ passthrough: true }) res: Response) {
    res.status(201);
    return this.auth.signup(dto);
  }

  @Post('signin')
  @HttpCode(200)
  @AuthRateLimited()
  @UseGuards(CookieCsrfGuard)
  async signin(@Body() dto: SigninDto, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.signin(dto));
  }

  @Post('refresh')
  @HttpCode(200)
  @AuthRateLimited()
  @UseGuards(CookieCsrfGuard)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      return this.respond(res, await this.auth.refresh(this.cookie(req)));
    } catch (e) {
      if (e instanceof AppError && e.getStatus() === 401) { res.clearCookie(this.config.cookie.name, this.cookieOptions()); res.clearCookie(this.siteCookieName(),this.siteCookieOptions()); }
      throw e;
    }
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(CookieCsrfGuard, OptionalAuthGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response, @MaybeAuth() who: AuthContext | null): Promise<void> {
    await this.auth.logout(this.cookie(req), who);
    res.clearCookie(this.config.cookie.name, this.cookieOptions()); res.clearCookie(this.siteCookieName(),this.siteCookieOptions());
  }

  @Post('logout-all')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async logoutAll(@CurrentAuth() who: AuthContext, @Res({ passthrough: true }) res: Response) {
    const revoked = await this.auth.logoutAll(who.userId);
    res.clearCookie(this.config.cookie.name, this.cookieOptions()); res.clearCookie(this.siteCookieName(),this.siteCookieOptions());
    return { revokedSessions: revoked };
  }
}

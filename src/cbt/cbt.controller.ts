import { Body, Controller, Get, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from '../common/app-error';
import { CurrentAuth, JwtAuthGuard, type AuthContext } from '../auth/guards';
import { CbtAnswerDto, CbtGoDto, CbtPauseDto, CbtSubmitDto, CreateCbtRunDto } from './cbt.dto';
import { CbtService } from './cbt.service';

function position(raw: string): number {
  if (!/^(0|[1-9]\d?)$/.test(raw) || Number(raw) > 49) throw new AppError(404, 'no_such_item', 'This run has no such position');
  return Number(raw);
}

function sendWebp(res: Response, buf: Buffer): void {
  res.status(200);
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Length', String(buf.length));
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(buf);
}

/** Every route (including images) requires a valid access token; the owner comes from the token only.
 *  Another user's run answers 404 exactly like a missing one. Ordinary signed-in members are allowed (no premium gate). */
@Controller('api/v1/cbt')
@UseGuards(JwtAuthGuard)
export class CbtController {
  constructor(private readonly cbt: CbtService) {}

  @Get('rounds')
  rounds() {
    return this.cbt.rounds();
  }

  @Get('rounds/:round')
  retryRound(@Param('round') raw:string){
    if(!/^7[0-9]$/.test(raw))throw new AppError(404,'round_not_found','No such round');
    return this.cbt.rounds(Number(raw));
  }

  @Get('stats')
  stats(@CurrentAuth() who: AuthContext) {
    return this.cbt.stats(who.userId);
  }

  @Post('runs')
  create(@CurrentAuth() who: AuthContext, @Body() dto: CreateCbtRunDto) {
    return this.cbt.create(who.userId, dto);
  }

  @Get('runs')
  list(@CurrentAuth() who: AuthContext) {
    return this.cbt.list(who.userId);
  }

  @Get('runs/:id')
  get(@CurrentAuth() who: AuthContext, @Param('id') id: string) {
    return this.cbt.get(who.userId, id);
  }

  @Post('runs/:id/start')
  @HttpCode(200)
  start(@CurrentAuth() who: AuthContext, @Param('id') id: string) {
    return this.cbt.start(who.userId, id);
  }

  @Post('runs/:id/answer')
  @HttpCode(200)
  answer(@CurrentAuth() who: AuthContext, @Param('id') id: string, @Body() dto: CbtAnswerDto) {
    return this.cbt.answer(who.userId, id, dto.position, dto.optionId);
  }

  @Post('runs/:id/go')
  @HttpCode(200)
  go(@CurrentAuth() who: AuthContext, @Param('id') id: string, @Body() dto: CbtGoDto) {
    return this.cbt.go(who.userId, id, dto.position);
  }

  @Post('runs/:id/submit')
  @HttpCode(200)
  submit(@CurrentAuth() who: AuthContext, @Param('id') id: string, @Body() dto: CbtSubmitDto) {
    return this.cbt.submit(who.userId, id, dto);
  }

  @Post('runs/:id/batch') @HttpCode(200)
  batch(@CurrentAuth() who: AuthContext, @Param('id') id: string) { return this.cbt.batch(who.userId,id); }
  @Post('runs/:id/pause') @HttpCode(200)
  pause(@CurrentAuth() who: AuthContext, @Param('id') id: string, @Body() dto: CbtPauseDto) { return this.cbt.pause(who.userId,id,false,dto); }
  @Post('runs/:id/resume') @HttpCode(200)
  resume(@CurrentAuth() who: AuthContext, @Param('id') id: string) { return this.cbt.pause(who.userId,id,true); }

  /** Binary WebP only (no JSON/base64/redirect), private and never cached. */
  @Get('runs/:id/questions/:position/image')
  async image(@CurrentAuth() who: AuthContext, @Param('id') id: string, @Param('position') pos: string, @Res() res: Response) {
    sendWebp(res, await this.cbt.image(who.userId, id, position(pos), 'question'));
  }

  @Get('runs/:id/questions/:position/common')
  async common(@CurrentAuth() who: AuthContext, @Param('id') id: string, @Param('position') pos: string, @Res() res: Response) {
    sendWebp(res, await this.cbt.image(who.userId, id, position(pos), 'common'));
  }
}

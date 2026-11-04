import { CanActivate, Controller, ExecutionContext, Get, Injectable, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards';
import { TextbookMemberGuard } from './textbook-member.guard';
import { JoseonScriptService } from './joseon-script.service';

/** Set private headers before authentication, including denied responses. */
@Injectable()
export class ScriptHeadersGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const res = ctx.switchToHttp().getResponse<Response>();
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    return true;
  }
}

@Controller('api/v1/textbook/scripts/joseon/:sourceSha256')
@UseGuards(ScriptHeadersGuard, JwtAuthGuard, TextbookMemberGuard)
export class JoseonScriptController {
  constructor(private readonly script: JoseonScriptService) {}
  @Get('bundle')
  async bundle(@Param('sourceSha256') source: string, @Res() res: Response) {
    res.type('application/json').send(await this.script.bundle(source));
  }
  @Get('figures/:name')
  async figure(@Param('sourceSha256') source: string, @Param('name') name: string, @Res() res: Response) {
    const bytes = await this.script.figure(source, name);
    res.type('image/png').send(bytes);
  }
}

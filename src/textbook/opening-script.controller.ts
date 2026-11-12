import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards';
import { TextbookMemberGuard } from './textbook-member.guard';
import { ScriptHeadersGuard } from './joseon-script.controller';
import { OpeningScriptService } from './opening-script.service';
import { OpeningStructureService } from './opening-structure.service';

@Controller('api/v1/textbook/scripts/opening/:sourceSha256')
@UseGuards(ScriptHeadersGuard, JwtAuthGuard, TextbookMemberGuard)
export class OpeningScriptController {
  constructor(private readonly script: OpeningScriptService, private readonly structureData: OpeningStructureService) {}
  private async deliver(res: Response, mime: string, read: (signal: AbortSignal) => Promise<Buffer>) {
    const abort = new AbortController();
    const closed = () => abort.abort();
    res.once('close', closed);
    try {
      const bytes = await read(abort.signal);
      if (!res.destroyed) res.type(mime).send(bytes);
    } catch (error) {
      if (!abort.signal.aborted) throw error;
    } finally { res.off('close', closed); }
  }
  @Get('bundle')
  async bundle(@Param('sourceSha256') source: string, @Res() res: Response) {
    await this.deliver(res, 'application/json', signal => this.script.bundle(source, signal));
  }
  @Get('structure')
  async structure(@Param('sourceSha256') source: string, @Res() res: Response) {
    await this.deliver(res, 'application/json', signal => this.structureData.get(source, signal));
  }
  @Get('figures/:name')
  async figure(@Param('sourceSha256') source: string, @Param('name') name: string, @Res() res: Response) {
    await this.deliver(res, 'image/png', signal => this.script.figure(source, name, signal));
  }
}

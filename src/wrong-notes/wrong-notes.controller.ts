import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AppError } from '../common/app-error';
import { CurrentAuth, JwtAuthGuard, type AuthContext } from '../auth/guards';
import { CreateReplayDto, CreateRunDto, ReplayAnswerDto, RunAnswerDto, WrongNotesQuery } from './wrong-notes.dto';
import { RunsService } from './runs.service';
import { WrongNotesService } from './wrong-notes.service';

/** Wrong-note list: signed-in owner. Replays and personal runs: signed-in owner WITH an active premium pass
 *  (checked in the services, in the same transaction as the action). */
@Controller('api/v1')
@UseGuards(JwtAuthGuard)
export class WrongNotesController {
  constructor(
    private readonly notes: WrongNotesService,
    private readonly runs: RunsService,
  ) {}

  @Get('wrong-notes')
  list(@CurrentAuth() who: AuthContext, @Query() q: WrongNotesQuery) {
    return this.notes.list(who.userId, q);
  }

  @Get('wrong-notes/parts')
  parts(@CurrentAuth() who: AuthContext) { return this.notes.parts(who.userId); }

  @Get('wrong-notes/focused-review')
  focusedReview(@CurrentAuth() who: AuthContext, @Query('era') era?:string) { return this.notes.focusedReview(who.userId,era); }

  @Post('wrong-notes/replays')
  createReplay(@CurrentAuth() who: AuthContext, @Body() dto: CreateReplayDto) {
    return this.notes.createReplay(who.userId, dto);
  }

  @Get('wrong-notes/replays')
  listReplays(@CurrentAuth() who: AuthContext) {
    return this.notes.listReplays(who.userId);
  }

  @Get('wrong-notes/replays/:id')
  getReplay(@CurrentAuth() who: AuthContext, @Param('id') id: string) {
    return this.notes.getReplay(who.userId, id);
  }

  @Post('wrong-notes/replays/:id/answers')
  @HttpCode(200)
  answerReplay(@CurrentAuth() who: AuthContext, @Param('id') id: string, @Body() dto: ReplayAnswerDto) {
    return this.notes.answerReplay(who.userId, id, dto);
  }

  @Post('wrong-notes/study')
  study(@CurrentAuth() who: AuthContext) { return this.runs.study(who.userId); }

  @Post('runs')
  createRun(@CurrentAuth() who: AuthContext, @Body() dto: CreateRunDto) {
    return this.runs.create(who.userId, dto);
  }

  @Get('runs')
  listRuns(@CurrentAuth() who: AuthContext) {
    return this.runs.list(who.userId);
  }

  @Get('runs/:id')
  getRun(@CurrentAuth() who: AuthContext, @Param('id') id: string) {
    return this.runs.get(who.userId, id);
  }

  @Post('runs/:id/start')
  @HttpCode(200)
  startRun(@CurrentAuth() who: AuthContext, @Param('id') id: string) {
    return this.runs.start(who.userId, id);
  }

  @Put('runs/:id/answers/:position')
  answerRun(@CurrentAuth() who: AuthContext, @Param('id') id: string, @Param('position') position: string, @Body() dto: RunAnswerDto) {
    if (!/^(0|[1-9]\d?)$/.test(position) || Number(position) > 49) throw new AppError(404, 'no_such_item', 'This run has no such position');
    return this.runs.answer(who.userId, id, Number(position), dto.optionId);
  }

  @Post('runs/:id/submit')
  @HttpCode(200)
  submitRun(@CurrentAuth() who: AuthContext, @Param('id') id: string) {
    return this.runs.submit(who.userId, id);
  }
}

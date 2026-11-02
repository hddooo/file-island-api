import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth, JwtAuthGuard, type AuthContext } from '../auth/guards';
import { ImportDto, ListQuery, QuizProgressDto, SubmitAttemptDto } from './attempts.dto';
import { AttemptsService } from './attempts.service';
import {MyRecordsService} from './my-records';
import { ImportService } from './import.service';

@Controller('api/v1')
@UseGuards(JwtAuthGuard)
export class AttemptsController {
  constructor(
    private readonly attempts: AttemptsService,
    private readonly records: MyRecordsService,
    private readonly imports: ImportService,
  ) {}

  /** Read-only despite POST: an exact scope can be larger than a safe URL. Never records a view. */
  @Post('quiz/progress')
  @HttpCode(200)
  quizProgress(@CurrentAuth() who: AuthContext, @Body() dto: QuizProgressDto) {
    return this.attempts.quizProgress(who.userId, dto.questions);
  }

  @Post('mock/progress')
  @HttpCode(200)
  mockProgress(@CurrentAuth()who:AuthContext,@Body()dto:QuizProgressDto){return this.attempts.quizProgress(who.userId,dto.questions,'mock');}

  @Post('attempts')
  submit(@CurrentAuth() who: AuthContext, @Body() dto: SubmitAttemptDto) {
    return this.attempts.submitPractice(who.userId, dto);
  }

  @Get('me/records')
  myRecords(@CurrentAuth() who: AuthContext, @Query('subject') subject?:string,@Query('source') source?:string,@Query('page') page?:string,@Query('snapshot') snapshot?:string){return this.records.list(who.userId,{subject,source,page,snapshot});}

  @Get('attempts')
  list(@CurrentAuth() who: AuthContext, @Query() q: ListQuery) {
    return this.attempts.list(who.userId, q.cursor, q.limit);
  }

  @Get('attempts/:id')
  detail(@CurrentAuth() who: AuthContext, @Param('id') id: string) {
    return this.attempts.detail(who.userId, id);
  }

  @Post('imports/local-attempts')
  importLocal(@CurrentAuth() who: AuthContext, @Body() dto: ImportDto) {
    return this.imports.importLocal(who.userId, dto.importKey, dto.entries, dto.scope === 'account' ? 'account' : 'browser');
  }
}

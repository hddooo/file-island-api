import { Body, Controller, Get, Header, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { CurrentAuth, JwtAuthGuard, type AuthContext } from '../auth/guards';
import { ScriptHeadersGuard } from './joseon-script.controller';
import { TextbookMemberGuard } from './textbook-member.guard';
import { queryGradingVersion, type GradingVersion } from './source-blank-progress';
import { SourceAttemptService, type FullSourceAttempt } from './source-attempt.service';

class FullSourceResponseDto {
  @IsString() @MaxLength(200) itemId: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(2000, { each: true }) values: string[];
}
class FullSourceAttemptDto implements FullSourceAttempt {
  @IsUUID('4') attemptId: string;
  @IsIn(['full']) mode: 'full';
  @IsIn(['completed']) status: 'completed';
  @IsString() @MaxLength(64) version: string;
  @IsIn([1, 2]) gradingVersion: GradingVersion;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => FullSourceResponseDto) responses: FullSourceResponseDto[];
}

@Controller(['api/v1/textbook/semantic/full-attempts', 'api/v1/textbook/revisions/:sourceRevision/semantic/full-attempts'])
@UseGuards(ScriptHeadersGuard, JwtAuthGuard, TextbookMemberGuard)
export class SourceAttemptController {
  constructor(private readonly attempts: SourceAttemptService) {}

  @Post(':id')
  @Header('Cache-Control', 'private, no-store')
  complete(@CurrentAuth() who: AuthContext, @Param('id') id: string, @Body() body: FullSourceAttemptDto, @Param('sourceRevision') revision?: string) {
    return this.attempts.complete(who.userId, id, body, revision);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentAuth() who: AuthContext, @Param('id') id: string, @Query('gradingVersion') version?: unknown, @Param('sourceRevision') revision?: string) {
    return this.attempts.list(who.userId, id, queryGradingVersion(version), revision);
  }
}

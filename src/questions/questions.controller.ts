import { Controller, Get, Param, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { QuestionsService } from './questions.service';

export class ListQuestionsQuery {
  @IsOptional() @IsIn(['quiz', 'mock']) kind?: 'quiz' | 'mock';
  @IsOptional() @IsString() @Matches(/^[a-z][a-z-]{1,30}$/) era?: string;
  @IsOptional() @IsString() after?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

/** Public, read-only: ordinary practice content stays free. Answers are never part of these responses. */
@Controller('api/v1/questions')
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Get()
  list(@Query() q: ListQuestionsQuery) {
    return this.questions.list(q);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.questions.get(id);
  }
}

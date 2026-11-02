import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator';

export const SUBMISSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/;
export const QUESTION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
export const VERSION = /^[A-Za-z0-9_.:-]{1,80}$/;
export const OPTION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;

/** Note: there is deliberately no `correct` field. Unknown fields are rejected (forbidNonWhitelisted). */
export class SubmitAttemptDto {
  @IsString() @Matches(SUBMISSION_ID) submissionId: string;
  @IsString() @Matches(QUESTION_ID) questionId: string;
  @IsString() @Matches(VERSION) version: string;
  @IsString() @Matches(OPTION_ID) optionId: string;
}

export class ListQuery {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class ImportEntryDto {
  @IsString() @Matches(/^a[0-9a-z]{6,40}$/) localId: string;
  @IsIn(['quiz', 'mock']) mode: 'quiz' | 'mock';
  @IsString() @Matches(QUESTION_ID) questionId: string;
  @IsString() @Matches(VERSION) contentVersion: string;
  @ValidateIf((_o, v) => v !== null) @IsString() @Matches(OPTION_ID) optionId: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(4_100_000_000_000) ts?: number;
}

export class ImportDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{32,64}$/) importKey: string;
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ImportEntryDto) entries: ImportEntryDto[];
  /** 'account' = automatic per-account sync (submission id from user + localId). Omitted = legacy manual import. */
  @IsOptional() @IsIn(['account']) scope?: 'account';
}

/** Exact front scope: core/sets and combined chapters keep their stable question/version pairs. */
export class QuizProgressQuestionDto {
  @IsString() @Matches(QUESTION_ID) questionId: string;
  @IsString() @Matches(VERSION) version: string;
}

export class QuizProgressDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000)
  @ValidateNested({ each: true }) @Type(() => QuizProgressQuestionDto)
  questions: QuizProgressQuestionDto[];
}

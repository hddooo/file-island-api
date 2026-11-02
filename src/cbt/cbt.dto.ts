import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { OPTION_ID, SUBMISSION_ID } from '../attempts/attempts.dto';

/** No user id anywhere in a body: the owner always comes from the access token. Unknown fields are rejected
 *  (global ValidationPipe: whitelist + forbidNonWhitelisted). */
export class CreateCbtRunDto {
  @IsOptional() @IsIn(['legacy','batch']) answerMode?: 'legacy' | 'batch';
  @IsInt() @Min(70) @Max(79) round: number;
  /** Client-generated key (e.g. a UUID) that makes create retries and double clicks return the same run. */
  @IsString() @Matches(SUBMISSION_ID) idempotencyKey: string;
}

export class CbtAnswerDto {
  @IsInt() @Min(0) @Max(49) position: number;
  /** An option id of that question, or null to clear the answer. Must be present. */
  @ValidateIf((_o, v) => v !== null) @IsString() @Matches(OPTION_ID) optionId: string | null;
}

export class CbtGoDto {
  @IsInt() @Min(0) @Max(49) position: number;
}

export class CbtSubmitDto {
  @IsOptional() @IsString() @Matches(SUBMISSION_ID) submissionKey?: string;
  @IsOptional() @IsArray() @ArrayMinSize(50) @ArrayMaxSize(50) @ValidateNested({each:true}) @Type(() => CbtAnswerDto) answers?: CbtAnswerDto[];
  @IsOptional() @IsInt() @Min(0) @Max(49) currentPosition?: number;
}

export class CbtPauseDto extends CbtSubmitDto {
  @IsOptional() @IsInt() @Min(0) checkpointVersion?: number;
}

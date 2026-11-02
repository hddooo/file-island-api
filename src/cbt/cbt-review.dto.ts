import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsIn, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { SUBMISSION_ID } from '../attempts/attempts.dto';
import { CbtAnswerDto } from './cbt.dto';

export class CbtStarDto {
 @IsString() @MaxLength(65536) signature: string;
 @IsInt() @Min(0) @Max(49) position: number;
 @IsBoolean() starred: boolean;
}
export class CbtStarImportDto {
 @IsString() @MaxLength(65536) signature: string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsBoolean({each:true}) flags: boolean[];
}
export class CreateCbtReviewDto {
 @IsOptional() @IsIn(['exam-wrong-only']) selection?: 'exam-wrong-only';
 @IsInt() @Min(70) @Max(79) round: number;
 @IsString() @Matches(SUBMISSION_ID) idempotencyKey: string;
}
export class CbtReviewAnswersDto {
 @IsString() @Matches(SUBMISSION_ID) submissionKey: string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({each:true}) @Type(()=>CbtAnswerDto) answers: CbtAnswerDto[];
 @IsInt() @Min(0) @Max(49) currentPosition: number;
 @IsOptional() @IsInt() @Min(0) checkpointVersion?: number;
}


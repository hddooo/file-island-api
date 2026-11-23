import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { SUBMISSION_ID } from '../attempts/attempts.dto';

export const UIGEUMBU_MAX_ITEMS = 700;

export class CreateUigeumbuSessionDto {
 @IsIn(['all','last-wrong']) scope: 'all'|'last-wrong';
 @IsString() @Matches(SUBMISSION_ID) idempotencyKey: string;
}
export class CreateUigeumbuReviewDto {
 @IsString() @Matches(SUBMISSION_ID) idempotencyKey: string;
}
export class UigeumbuAnswerDto {
 @IsInt() @Min(0) @Max(UIGEUMBU_MAX_ITEMS-1) position: number;
 @ValidateIf((_o,v)=>v!==null) @IsString() @MaxLength(200) optionId: string|null;
}
export class UigeumbuPositionDto {
 @IsInt() @Min(0) @Max(UIGEUMBU_MAX_ITEMS-1) currentPosition: number;
}
export class UigeumbuSubmitDto {
 @IsString() @Matches(SUBMISSION_ID) submissionKey: string;
}
export class UigeumbuStarDto {
 @IsInt() @Min(0) @Max(UIGEUMBU_MAX_ITEMS-1) position: number;
 @IsBoolean() starred: boolean;
 @IsOptional() @IsISO8601() resetAt?: string|null;
}

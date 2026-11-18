import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
export class RehearsalRowDto {
 @IsString() @MaxLength(120) questionId: string;
 @IsString() @MaxLength(80) version: string;
 @IsInt() @Min(70) @Max(80) exam: number;
 @IsInt() @Min(1) @Max(50) number: number;
 @IsIn(['empty','correct','wrong']) status: 'empty'|'correct'|'wrong';
}
/** Self-reported practice outcome, never authoritative grading. */
export class RehearsalResultDto {
 @IsInt() @Min(70) @Max(80) round: number;
 @IsInt() @Min(0) @Max(50) right: number;
 @IsInt() @Min(1) @Max(50) total: number;
 @IsBoolean() marked: boolean;
 @IsISO8601() at: string;
 @IsOptional() @IsISO8601() resetAt?: string|null;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({each:true}) @Type(()=>RehearsalRowDto) rows: RehearsalRowDto[];
}

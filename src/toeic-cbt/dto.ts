import { Type } from 'class-transformer';
import { IsISO8601, ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator';
const KEY=/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/;
export class CreateToeicRunDto {@IsUUID('4') collectionId:string;@IsString() @Matches(KEY) idempotencyKey:string;@IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @ArrayUnique() @IsInt({each:true}) @Min(1,{each:true}) @Max(7,{each:true}) parts?:number[];}
export class ToeicAnswerDto {@IsInt() @Min(0) @Max(199) position:number;@IsOptional() @IsIn(['A','B','C','D']) optionId:string|null;}
export class ToeicCheckpointDto {
 @IsInt() @Min(0) @Max(2147483646) revision:number;
 @IsInt() @Min(0) @Max(199) cursor:number;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({each:true}) @Type(()=>ToeicAnswerDto) answers:ToeicAnswerDto[];
 @IsBoolean() paused:boolean;
}
export class ToeicSubmitDto {
 @IsString() @Matches(KEY) submissionKey:string;
 @IsInt() @Min(0) @Max(2147483646) revision:number;
 @IsInt() @Min(0) @Max(199) cursor:number;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({each:true}) @Type(()=>ToeicAnswerDto) answers:ToeicAnswerDto[];
}
export class ToeicRevisionDto {@IsInt() @Min(0) @Max(2147483646) revision:number;}
export class ToeicPracticeAnswerDto {
 @IsOptional() @IsISO8601() resetAt?:string|null;
 @IsInt() @Min(1) @Max(200) number:number;
 @IsIn(['A','B','C','D']) optionId:string;
 @IsString() @Matches(KEY) requestKey:string;
}

export class ToeicPracticeGroupDto {
 @IsString() @Matches(/^[A-Za-z0-9_.:-]{1,120}$/) groupId:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @ValidateNested({each:true}) @Type(()=>ToeicPracticeAnswerDto) answers:ToeicPracticeAnswerDto[];
}

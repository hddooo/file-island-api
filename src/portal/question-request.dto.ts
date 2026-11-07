import {Type} from 'class-transformer';
import {ArrayMaxSize,IsArray,IsBoolean,IsIn,IsInt,IsOptional,IsString,IsUUID,Max,MaxLength,Min,ValidateNested} from 'class-validator';
export class QuestionChoiceDto { @IsIn(['A','B','C','D','1','2','3','4','5']) id:string; @IsString() @MaxLength(3000) text:string; }
export class SubmittedQuestionDto {
 @IsInt() @Min(1) @Max(200) number:number;
 @IsString() @MaxLength(10000) stem:string;
 @IsArray() @ArrayMaxSize(5) @ValidateNested({each:true}) @Type(()=>QuestionChoiceDto) choices:QuestionChoiceDto[];
 @IsIn(['A','B','C','D','1','2','3','4','5']) correctOptionId:string;
 @IsOptional() @IsString() @MaxLength(20000) passage?:string;
 @IsOptional() @IsUUID() imageAssetId?:string;
 @IsOptional() @IsUUID() audioAssetId?:string;
}
export class QuestionRequestDto {
 @IsUUID() requestId:string;
 @IsIn(['toeic','history']) subject:string;
 @IsOptional() @IsInt() @Min(1) @Max(7) part?:number;
 @IsString() @MaxLength(160) sourceLabel:string;
 @IsArray() @ArrayMaxSize(40) @ValidateNested({each:true}) @Type(()=>SubmittedQuestionDto) questions:SubmittedQuestionDto[];
 @IsOptional() @IsString() @MaxLength(4000) note?:string;
}
export class QuestionRequestUpdateDto extends QuestionRequestDto { @IsInt() @Min(1) expectedRevision:number; }
export class QuestionRequestRevisionDto { @IsInt() @Min(1) expectedRevision:number; }
export class ExplanationDto { @IsInt() @Min(1) @Max(200) number:number; @IsString() @MaxLength(4000) explanation:string; }
export class QuestionRequestReviewDto extends QuestionRequestRevisionDto {
 @IsIn(['needs_revision','content_reviewed','ready_for_publish']) status:string;
 @IsString() @MaxLength(4000) reviewNote:string;
 @IsOptional() @IsBoolean() sourceChecked?:boolean;
 @IsOptional() @IsBoolean() cleanImageChecked?:boolean;
 @IsOptional() @IsBoolean() audioChecked?:boolean;
 @IsOptional() @IsArray() @ArrayMaxSize(40) @ValidateNested({each:true}) @Type(()=>ExplanationDto) explanations?:ExplanationDto[];
}

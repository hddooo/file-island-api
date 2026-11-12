import {Type} from 'class-transformer';
import {Equals,Matches,ArrayMaxSize,IsArray,IsBoolean,IsIn,IsInt,IsOptional,IsString,IsUUID,Max,MaxLength,Min,ValidateNested} from 'class-validator';
export class QuestionChoiceDto { @IsIn(['A','B','C','D','1','2','3','4','5']) id:string; @IsString() @MaxLength(3000) text:string; }
export class CropBoxDto { @IsInt() @Min(0) @Max(20000) x0:number; @IsInt() @Min(0) @Max(20000) y0:number; @IsInt() @Min(1) @Max(20000) x1:number; @IsInt() @Min(1) @Max(20000) y1:number; }
export class CropProvenanceDto { @Equals('source_pixel_crop') kind:string; @Equals('decoded-image-exif-applied') coordinateSpace:string; @Matches(/^[a-f0-9]{64}$/) originalSha256:string; @Matches(/^[a-f0-9]{64}$/) outputSha256:string; @IsInt() @Min(1) @Max(20000) sourceWidth:number; @IsInt() @Min(1) @Max(20000) sourceHeight:number; @ValidateNested() @Type(()=>CropBoxDto) crop:CropBoxDto; @IsInt() @Min(1) @Max(20000) outputWidth:number; @IsInt() @Min(1) @Max(20000) outputHeight:number; @Equals('image/png') outputMediaType:string; @Equals(true) userConfirmed:boolean; @Equals(false) generatedContent:boolean; }
export class SubmittedQuestionDto {
 @IsOptional() @ValidateNested() @Type(()=>CropProvenanceDto) cropProvenance?:CropProvenanceDto;
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
 @IsOptional() @IsIn(['private','authenticated-members']) publicationAudience?:string;
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

export class PublicationMappingDto { @IsInt() @Min(1) @Max(200) number:number; @IsOptional() @IsUUID() cleanImageAssetId?:string; @IsOptional() @IsString() @MaxLength(60) groupId?:string; }
export class PublicationGroupDto { @IsString() @MaxLength(60) id:string; @IsArray() @ArrayMaxSize(40) @IsInt({each:true}) @Min(1,{each:true}) @Max(200,{each:true}) questionNumbers:number[]; @IsOptional() @IsUUID() audioAssetId?:string; @IsOptional() @IsString() @MaxLength(20000) passage?:string; }
export class HistoryClassificationDto { @IsString() @MaxLength(31) chapter:string; @IsString() @MaxLength(31) era:string; }
export class QuestionRequestPublishDto extends QuestionRequestRevisionDto {
 @IsIn(['authenticated-members']) audience:string;
 @IsArray() @ArrayMaxSize(40) @ValidateNested({each:true}) @Type(()=>PublicationMappingDto) mappings:PublicationMappingDto[];
 @IsArray() @ArrayMaxSize(40) @ValidateNested({each:true}) @Type(()=>PublicationGroupDto) groups:PublicationGroupDto[];
 @IsOptional() @ValidateNested() @Type(()=>HistoryClassificationDto) historyClassification?:HistoryClassificationDto;
}

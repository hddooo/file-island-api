import {IsString,MinLength,MaxLength,IsUUID,IsOptional,IsInt,Min,Max,IsIn} from 'class-validator';
import {Type} from 'class-transformer';
export class PageQuery{@IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(100000) page=1;@IsOptional() @IsString() @MaxLength(120) search='';}
export class LoginAnalyticsQuery{@IsOptional() @Type(()=>Number) @IsIn([7,30]) days=7;}
export class InquiryDto{@IsUUID() requestId:string;@IsString() @MinLength(1) @MaxLength(120) title:string;@IsString() @MinLength(1) @MaxLength(4000) body:string;}
export class MessageDto{@IsUUID() requestId:string;@IsString() @MinLength(1) @MaxLength(4000) body:string;}
export class AdminMemberDto{@IsString() @MinLength(1) @MaxLength(80) displayName:string;}
export class AdminXpDto{@IsUUID() requestId:string;@IsInt() @Min(-1000000) @Max(1000000) delta:number;@IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) expectedBalance:number;@IsString() @MinLength(1) @MaxLength(300) reason:string;}
export class AdminPartnerXpDto extends AdminXpDto{@IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) expectedPartnerXp:number;}

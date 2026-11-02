import { ArrayMaxSize, IsBoolean, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
export class NoteDto {
 @IsIn(['1','2','3-4','5-6','7','unclassified']) part: string;
 @IsString() @MinLength(1) @MaxLength(300) expression: string;
 @IsString() @MaxLength(6000) meaning: string;
 @IsString() @MaxLength(6000) structure: string;
 @IsString() @MaxLength(6000) example: string;
 @IsString() @MaxLength(6000) confusion: string;
 @IsString() @MaxLength(6000) sourceText: string;
 @IsString() @MaxLength(6000) sourceReference: string;
 @IsOptional() @IsString() @MaxLength(6000) translation?: string;
 @IsOptional() @IsString() @MaxLength(30) partOfSpeech?: string;
 @IsOptional() @IsArray() @ArrayMaxSize(3) @IsString({each:true}) @MaxLength(300,{each:true}) synonyms?: string[];
 @IsInt() @Min(0) revision: number;
}
export class MergeDto {
 @IsUUID('4') sourceId: string;
 @IsInt() @Min(1) sourceRevision: number;
 @IsInt() @Min(1) targetRevision: number;
}

export class ArchiveNoteDto { @IsBoolean() archived:boolean; }

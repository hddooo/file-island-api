import { ArrayMaxSize, ArrayUnique, Equals, IsArray, IsInt, IsString, Matches, Max, Min } from 'class-validator';
import { SUBMISSION_ID } from '../attempts/attempts.dto';
export class CreatePaperResultDto {
 @IsInt() @Min(70) @Max(80) examRound:number;
 @IsArray() @ArrayMaxSize(50) @ArrayUnique() @IsInt({each:true}) @Min(1,{each:true}) @Max(50,{each:true}) wrongNumbers:number[];
 @IsString() @Matches(SUBMISSION_ID) idempotencyKey:string;
 @Equals(true) completed:true;
}

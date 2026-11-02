import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min, ValidateIf } from 'class-validator';
import { OPTION_ID, SUBMISSION_ID } from '../attempts/attempts.dto';

export class WrongNotesQuery {
  @IsOptional() @IsIn(['unresolved', 'all']) status?: 'unresolved' | 'all';
  @IsOptional() @IsIn(['quiz', 'mock']) kind?: 'quiz' | 'mock';
  @IsOptional() @IsIn(['ancient','prehistory','gojoseon','samguk','nambuk','goryeo','joseon','joseon-early','joseon-late','opening','colonial','modern','islands','comprehensive']) era?: string;
}

export class CreateReplayDto {
  @IsIn(['unresolved', 'all']) list: 'unresolved' | 'all';
  @IsIn(['recent', 'random']) order: 'recent' | 'random';
  @IsOptional() @IsIn(['quiz', 'mock']) kind?: 'quiz' | 'mock';
  @IsOptional() @IsIn(['ancient','prehistory','gojoseon','samguk','nambuk','goryeo','joseon','joseon-early','joseon-late','opening','colonial','modern','islands','comprehensive']) era?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) size?: number;
}

export class ReplayAnswerDto {
  @IsString() @Matches(SUBMISSION_ID) submissionId: string;
  @IsInt() @Min(0) @Max(99) position: number;
  @IsString() @Matches(OPTION_ID) optionId: string;
}

export class CreateRunDto {
  @IsIn(['personal-mini', 'personal-formal']) product: 'personal-mini' | 'personal-formal';
  @IsIn(['unresolved', 'all']) scope: 'unresolved' | 'all';
  @IsIn(['recent', 'random']) order: 'recent' | 'random';
}

export class RunAnswerDto {
  @ValidateIf((_o, v) => v !== null) @IsString() @Matches(OPTION_ID) optionId: string | null;
}

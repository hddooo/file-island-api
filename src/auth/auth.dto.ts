import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Shape checks only; normalization and the password policy run in the service (one source of truth). */
export class SignupDto {
  @IsString() @MinLength(3) @MaxLength(254) email: string;
  @IsString() @MinLength(1) @MaxLength(256) password: string;
  @IsOptional() @IsString() @MaxLength(80) displayName?: string;
}

export class SigninDto {
  @IsOptional() @IsBoolean() rememberMe?: boolean;
  @IsString() @MinLength(3) @MaxLength(254) email: string;
  @IsString() @MinLength(1) @MaxLength(1024) password: string;
}

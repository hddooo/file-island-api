import { Body, Controller, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentAuth, JwtAuthGuard, type AuthContext } from '../auth/guards';
import { HongmungwanService, HONG_ERAS } from './hongmungwan.service';
class HongQuery { @IsOptional() @IsIn(HONG_ERAS) era?: string; }
class HongIdentity {
 @IsString() @MinLength(1) @MaxLength(120) questionId!: string;
 @IsString() @MinLength(1) @MaxLength(120) version!: string;
 @IsOptional() @IsString() @MaxLength(40) resetAt?: string | null;
}
class HongAnswer extends HongIdentity {
 @IsString() @MinLength(1) @MaxLength(120) submissionId!: string;
 @IsString() @MinLength(1) @MaxLength(120) optionId!: string;
 @IsOptional() @IsBoolean() reviewOnly?: boolean;
}
class HongStar extends HongIdentity { @IsBoolean() starred!: boolean; }
@Controller('api/v1/hongmungwan')
@UseGuards(JwtAuthGuard)
export class HongmungwanController {
 constructor(private readonly service: HongmungwanService) {}
 @Get() list(@CurrentAuth() who: AuthContext, @Query() query: HongQuery) { return this.service.list(who.userId, query.era); }
 @Post('answer') answer(@CurrentAuth() who: AuthContext, @Body() body: HongAnswer) { return this.service.answer(who.userId, body); }
 @Put('star') star(@CurrentAuth() who: AuthContext, @Body() body: HongStar) { return this.service.star(who.userId, body); }
}

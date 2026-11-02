import { Body, Controller, Get, HttpCode, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsUUID, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { GROWTH_HISTORY_MAX_LIMIT } from './growth-history';
import { AuthRateLimited, CurrentAuth, JwtAuthGuard, type AuthContext } from '../auth/guards';
import { ProfileService } from './profile.service';

export class UpdateProfileDto {
  @IsString() @MinLength(1) @MaxLength(80) displayName: string;
}

export class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(1024) currentPassword: string;
  @IsString() @MinLength(1) @MaxLength(256) newPassword: string;
}

export class GrowthHistoryQuery {
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{1,200}$/) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(GROWTH_HISTORY_MAX_LIMIT) limit?: number;
}

export class StudyActivityQuery {
 @IsOptional() @IsString() @Matches(/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/) month?:string;
}

export class EvolveDto { @IsIn(['agumon','patamon']) family:'agumon'|'patamon'; @IsInt() @Min(0) @Max(2147483647) revision:number; @IsUUID('4') requestId:string; }

export class ClaimEggDto { @IsIn(['gabumon','patamon']) family:'gabumon'|'patamon'; @IsUUID('4') requestId:string; @IsOptional() @IsInt() @Min(0) @Max(0) priceCoin?:number; }
export class PartnerActionDto { @IsUUID('4') id:string; @IsInt() @Min(0) @Max(2147483647) revision:number; @IsUUID('4') requestId:string; }

@Controller('api/v1/me')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  me(@CurrentAuth() who: AuthContext) {
    return this.profile.me(who.userId);
  }

  @Get('partners')
  partners(@CurrentAuth() who:AuthContext){return this.profile.partners(who.userId);}
  @Post('partners/claim') @HttpCode(200)
  claim(@CurrentAuth() who:AuthContext,@Body() dto:ClaimEggDto){return this.profile.partnerCommand(who.userId,dto.requestId,{command:'claim',family:dto.family,...(dto.priceCoin!==undefined?{priceCoin:dto.priceCoin}:{})});}
  @Post('partners/equip') @HttpCode(200)
  equip(@CurrentAuth() who:AuthContext,@Body() dto:PartnerActionDto){return this.profile.partnerCommand(who.userId,dto.requestId,{command:'equip',id:dto.id,revision:dto.revision});}
  @Post('partners/evolve') @HttpCode(200)
  evolvePartner(@CurrentAuth() who:AuthContext,@Body() dto:PartnerActionDto){return this.profile.partnerCommand(who.userId,dto.requestId,{command:'evolve',id:dto.id,revision:dto.revision});}

  @Post('evolve') @HttpCode(200)
  evolve(@CurrentAuth()who:AuthContext,@Body()dto:EvolveDto){return this.profile.evolve(who.userId,dto.family,dto.revision,dto.requestId);}

  /** Read-only growth-point history of the signed-in user (append-only ledger). Bounded pages, opaque keyset cursor. */
  @Get('study-activity')
  studyActivity(@CurrentAuth() who:AuthContext,@Query() q:StudyActivityQuery){return this.profile.studyActivity(who.userId,q.month);}

  @Get('growth-history')
  growthHistory(@CurrentAuth() who: AuthContext, @Query() q: GrowthHistoryQuery) {
    return this.profile.growthHistory(who.userId, q.cursor, q.limit);
  }

  /** Only displayName is accepted; any other field (email, id, premium …) is rejected by validation. */
  @Patch()
  update(@CurrentAuth() who: AuthContext, @Body() dto: UpdateProfileDto) {
    return this.profile.updateDisplayName(who.userId, dto.displayName);
  }

  @Post('password')
  @HttpCode(200)
  @AuthRateLimited()
  changePassword(@CurrentAuth() who: AuthContext, @Body() dto: ChangePasswordDto) {
    return this.profile.changePassword(who.userId, who.sessionId, dto.currentPassword, dto.newPassword);
  }
}

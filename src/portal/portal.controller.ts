import {Body,Controller,Get,Param,ParseUUIDPipe,Patch,Post,Query,UseGuards} from '@nestjs/common';
import {CurrentAuth,JwtAuthGuard,type AuthContext} from '../auth/guards';
import {PortalService} from './portal.service';
import {AdminXpDto,AdminPartnerXpDto,AdminMemberDto,InquiryDto,MessageDto,PageQuery,LoginAnalyticsQuery} from './portal.dto';
@Controller('api/v1') @UseGuards(JwtAuthGuard) export class PortalController{
 constructor(private readonly portal:PortalService){}
 @Get('ops') status(@CurrentAuth()a:AuthContext){return this.portal.status(a.userId);}
 @Get('ops/login-analytics') loginAnalytics(@CurrentAuth()a:AuthContext,@Query()q:LoginAnalyticsQuery){return this.portal.loginAnalytics(a.userId,q.days);}
 @Get('ops/members') members(@CurrentAuth()a:AuthContext,@Query()q:PageQuery){return this.portal.members(a.userId,q);}
 @Get('ops/members/:id') member(@CurrentAuth()a:AuthContext,@Param('id',ParseUUIDPipe)id:string,@Query()q:PageQuery){return this.portal.member(a.userId,id,q);}
 @Post('ops/members/:id/xp') adjustXp(@CurrentAuth()a:AuthContext,@Param('id',ParseUUIDPipe)id:string,@Body()d:AdminXpDto){return this.portal.adjustXp(a.userId,id,d);}
 @Get('ops/members/:id/partners') memberPartners(@CurrentAuth()a:AuthContext,@Param('id',ParseUUIDPipe)id:string){return this.portal.memberPartners(a.userId,id);}
 @Post('ops/members/:id/partners/:partnerId/xp') adjustPartnerXp(@CurrentAuth()a:AuthContext,@Param('id',ParseUUIDPipe)id:string,@Param('partnerId',ParseUUIDPipe)partnerId:string,@Body()d:AdminPartnerXpDto){return this.portal.adjustPartnerXp(a.userId,id,partnerId,d);}
 @Patch('ops/members/:id') edit(@CurrentAuth()a:AuthContext,@Param('id',ParseUUIDPipe)id:string,@Body()d:AdminMemberDto){return this.portal.edit(a.userId,id,d.displayName);}
 @Get('ops/inquiries') inbox(@CurrentAuth()a:AuthContext,@Query()q:PageQuery){return this.portal.list(a.userId,q,true);}
 @Get('ops/inquiries/:id') adminDetail(@CurrentAuth()a:AuthContext,@Param('id',ParseUUIDPipe)id:string){return this.portal.detail(a.userId,id,true);}
 @Post('ops/inquiries/:id/messages') answer(@CurrentAuth()a:AuthContext,@Param('id',ParseUUIDPipe)id:string,@Body()d:MessageDto){return this.portal.reply(a.userId,id,d,true);}
 @Get('inquiries') own(@CurrentAuth()a:AuthContext,@Query()q:PageQuery){return this.portal.list(a.userId,q);}
 @Post('inquiries') create(@CurrentAuth()a:AuthContext,@Body()d:InquiryDto){return this.portal.create(a.userId,d);}
 @Get('inquiries/:id') detail(@CurrentAuth()a:AuthContext,@Param('id',ParseUUIDPipe)id:string){return this.portal.detail(a.userId,id);}
 @Post('inquiries/:id/messages') reply(@CurrentAuth()a:AuthContext,@Param('id',ParseUUIDPipe)id:string,@Body()d:MessageDto){return this.portal.reply(a.userId,id,d);}
}

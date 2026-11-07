import {Body,Controller,Get,Post,Param,ParseUUIDPipe,Query,UseGuards} from '@nestjs/common';
import {IsIn,IsInt,IsOptional,Max,Min} from 'class-validator';
import {Type} from 'class-transformer';
import {CurrentAuth,JwtAuthGuard,type AuthContext} from './guards';
import {AuthService} from './auth.service';
class QueueQuery {@IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(100000) page=1;}
class DecisionDto {@IsIn(['approved','rejected']) decision:'approved'|'rejected';}
@Controller('api/v1/ops/membership-requests')
@UseGuards(JwtAuthGuard)
export class MemberApprovalController{
 constructor(private readonly auth:AuthService){}
 @Get() list(@CurrentAuth()a:AuthContext,@Query()q:QueueQuery){return this.auth.membershipRequests(a.userId,q.page);}
 @Post(':id/decision') decide(@CurrentAuth()a:AuthContext,@Param('id',ParseUUIDPipe)id:string,@Body()d:DecisionDto){return this.auth.decideMembership(a.userId,id,d.decision);}
}

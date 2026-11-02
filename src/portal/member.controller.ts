import {Body,Controller,Get,Post,Query,UseGuards,Inject} from '@nestjs/common';import {IsString,MaxLength,MinLength} from 'class-validator';import {DbService} from '../db/db.service';import {CLOCK,type Clock} from '../common/tokens';import {CurrentAuth,JwtAuthGuard,AuthRateLimited,type AuthContext} from '../auth/guards';import {normalizeDisplayName,normalizeEmail} from '../auth/credentials';import {attendance} from './member-state';
class NicknameQuery{@IsString() @MinLength(1) @MaxLength(80) nickname:string;}
class EmailQuery{@IsString() @MinLength(3) @MaxLength(254) email:string;}
@Controller('api/v1')export class MemberController{constructor(private readonly db:DbService,@Inject(CLOCK) private readonly clock:Clock){}
 @Get('auth/nickname') @AuthRateLimited() async nickname(@Query()q:NicknameQuery){const r=await this.db.pool.query('SELECT 1 FROM hanq.nickname_claims WHERE nickname_key=$1',[normalizeDisplayName(q.nickname).toLowerCase()]);return{available:!r.rowCount};}
 @Post('auth/email-availability') @AuthRateLimited() async email(@Body()q:EmailQuery){const email=normalizeEmail(q.email).normalized;const r=await this.db.pool.query('SELECT 1 FROM hanq.users WHERE email_normalized=$1',[email]);return{available:!r.rowCount};}
 @Post('attendance') @UseGuards(JwtAuthGuard) check(@CurrentAuth()a:AuthContext){return this.db.tx(q=>attendance(q,a.userId,()=>this.clock.now(),true));}
}

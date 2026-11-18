import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { CurrentAuth, JwtAuthGuard, type AuthContext } from '../auth/guards';
import { RehearsalResultDto } from './cbt-rehearsal.dto';
import { CbtRehearsalService } from './cbt-rehearsal.service';
@Controller('api/v1/cbt/rehearsal-results') @UseGuards(JwtAuthGuard)
export class CbtRehearsalController {
 constructor(private readonly service:CbtRehearsalService) {}
 @Get() list(@CurrentAuth() w:AuthContext){return this.service.list(w.userId);}
 @Put(':round') save(@CurrentAuth() w:AuthContext,@Param('round') round:string,@Body() d:RehearsalResultDto){return this.service.save(w.userId,round,d);}
}

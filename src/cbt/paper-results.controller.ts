import {Body,Controller,Get,Param,Post,Res,UseGuards} from '@nestjs/common';
import type {Response} from 'express';
import {CurrentAuth,JwtAuthGuard,type AuthContext} from '../auth/guards';
import {notFound} from '../common/app-error';
import {CreatePaperResultDto} from './paper-results.dto';
import {PaperResultsService} from './paper-results.service';
@Controller('api/v1/cbt/paper-results') @UseGuards(JwtAuthGuard)
export class PaperResultsController {
 constructor(private readonly service:PaperResultsService){}
 @Get() list(@CurrentAuth() who:AuthContext){return this.service.list(who.userId);}
 @Post() create(@CurrentAuth() who:AuthContext,@Body() dto:CreatePaperResultDto){return this.service.create(who.userId,dto);}
 @Get('notebook') notebook(@CurrentAuth() who:AuthContext){return this.service.notebook(who.userId);}
 @Get(':id') get(@CurrentAuth() who:AuthContext,@Param('id') id:string){return this.service.get(who.userId,id);}
 @Get(':id/questions/:position/:which') async image(@CurrentAuth() who:AuthContext,@Param('id') id:string,@Param('position') raw:string,@Param('which') which:string,@Res() res:Response){
  if(!/^(0|[1-4]?\d)$/.test(raw)||!['image','common'].includes(which))throw notFound();
  const bytes=await this.service.image(who.userId,id,Number(raw),which as 'image'|'common');
  res.status(200).set({'Content-Type':'image/webp','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Length':String(bytes.length)}).end(bytes);
 }
}

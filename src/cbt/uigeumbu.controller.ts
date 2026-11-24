import { Body, Controller, Get, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentAuth, JwtAuthGuard, type AuthContext } from '../auth/guards';
import { notFound } from '../common/app-error';
import { CreateUigeumbuReviewDto, CreateUigeumbuSessionDto, UIGEUMBU_MAX_ITEMS, UigeumbuAnswerDto, UigeumbuPositionDto, UigeumbuStarDto, UigeumbuStarResetDto, UigeumbuSubmitDto } from './uigeumbu.dto';
import { UigeumbuService } from './uigeumbu.service';

@Controller('api/v1/cbt/uigeumbu') @UseGuards(JwtAuthGuard)
export class UigeumbuController {
 constructor(private readonly service:UigeumbuService) {}
 @Get() summary(@CurrentAuth() w:AuthContext){return this.service.summary(w.userId);}
 @Post('stars/reset') @HttpCode(200) resetStars(@CurrentAuth() w:AuthContext,@Body() d:UigeumbuStarResetDto){return this.service.resetStars(w.userId,d);}
 @Post('sessions') create(@CurrentAuth() w:AuthContext,@Body() d:CreateUigeumbuSessionDto){return this.service.create(w.userId,d);}
 @Get('sessions/:id') get(@CurrentAuth() w:AuthContext,@Param('id') id:string){return this.service.get(w.userId,id);}
 @Post('sessions/:id/reviews') review(@CurrentAuth() w:AuthContext,@Param('id') id:string,@Body() d:CreateUigeumbuReviewDto){return this.service.createReview(w.userId,id,d);}
 @Post('sessions/:id/answer') @HttpCode(200) answer(@CurrentAuth() w:AuthContext,@Param('id') id:string,@Body() d:UigeumbuAnswerDto){return this.service.answer(w.userId,id,d);}
 @Post('sessions/:id/position') @HttpCode(200) position(@CurrentAuth() w:AuthContext,@Param('id') id:string,@Body() d:UigeumbuPositionDto){return this.service.position(w.userId,id,d);}
 @Post('sessions/:id/submit') @HttpCode(200) submit(@CurrentAuth() w:AuthContext,@Param('id') id:string,@Body() d:UigeumbuSubmitDto){return this.service.submit(w.userId,id,d);}
 @Post('sessions/:id/stars') @HttpCode(200) star(@CurrentAuth() w:AuthContext,@Param('id') id:string,@Body() d:UigeumbuStarDto){return this.service.star(w.userId,id,d);}
 @Get('sessions/:id/questions/:position/:which') async image(@CurrentAuth() w:AuthContext,@Param('id') id:string,@Param('position') p:string,@Param('which') which:string,@Res() res:Response){
  if(!/^(0|[1-9]\d{0,2})$/.test(p)||Number(p)>=UIGEUMBU_MAX_ITEMS||!['image','common'].includes(which))throw notFound();
  const bytes=await this.service.image(w.userId,id,Number(p),which==='image'?'question':'common');
  res.status(200).set({'Content-Type':'image/webp','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Length':String(bytes.length)}).end(bytes);
 }
}

import { Body, Controller, Get, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentAuth, JwtAuthGuard, type AuthContext } from '../auth/guards';
import { notFound } from '../common/app-error';
import { CbtReviewAnswersDto, CbtStarDto, CbtStarImportDto, CreateCbtReviewDto } from './cbt-review.dto';
import { CbtReviewService } from './cbt-review.service';

@Controller('api/v1/cbt') @UseGuards(JwtAuthGuard)
export class CbtReviewController {
 constructor(private readonly service:CbtReviewService) {}
 @Get('runs/:id/stars') stars(@CurrentAuth() w:AuthContext,@Param('id') id:string){return this.service.stars(w.userId,id,'exam');}
 @Post('runs/:id/stars') @HttpCode(200) save(@CurrentAuth() w:AuthContext,@Param('id') id:string,@Body() d:CbtStarDto){return this.service.saveStar(w.userId,id,'exam',d);}
 @Post('runs/:id/stars/import') @HttpCode(200) import(@CurrentAuth() w:AuthContext,@Param('id') id:string,@Body() d:CbtStarImportDto){return this.service.importStars(w.userId,id,'exam',d);}
 @Get('reviews/:id/stars') reviewStars(@CurrentAuth() w:AuthContext,@Param('id') id:string){return this.service.stars(w.userId,id,'review');}
 @Post('reviews/:id/stars') @HttpCode(200) reviewSave(@CurrentAuth() w:AuthContext,@Param('id') id:string,@Body() d:CbtStarDto){return this.service.saveStar(w.userId,id,'review',d);}
 @Post('reviews/:id/stars/import') @HttpCode(200) reviewImport(@CurrentAuth() w:AuthContext,@Param('id') id:string,@Body() d:CbtStarImportDto){return this.service.importStars(w.userId,id,'review',d);}
 @Get('notebook') notebook(@CurrentAuth() w:AuthContext){return this.service.notebook(w.userId);}
 @Post('reviews') create(@CurrentAuth() w:AuthContext,@Body() d:CreateCbtReviewDto){return this.service.create(w.userId,d);}
 @Get('reviews') list(@CurrentAuth() w:AuthContext){return this.service.list(w.userId);}
 @Get('reviews/:id') get(@CurrentAuth() w:AuthContext,@Param('id') id:string){return this.service.get(w.userId,id);}
 @Post('reviews/:id/start') @HttpCode(200) start(@CurrentAuth() w:AuthContext,@Param('id') id:string){return this.service.start(w.userId,id);}
 @Post('reviews/:id/pause') @HttpCode(200) pause(@CurrentAuth() w:AuthContext,@Param('id') id:string,@Body() d:CbtReviewAnswersDto){return this.service.checkpoint(w.userId,id,d);}
 @Post('reviews/:id/resume') @HttpCode(200) resume(@CurrentAuth() w:AuthContext,@Param('id') id:string){return this.service.resume(w.userId,id);}
 @Post('reviews/:id/submit') @HttpCode(200) submit(@CurrentAuth() w:AuthContext,@Param('id') id:string,@Body() d:CbtReviewAnswersDto){return this.service.submit(w.userId,id,d);}
 @Get('reviews/:id/questions/:position/:which') async image(@CurrentAuth() w:AuthContext,@Param('id') id:string,@Param('position') p:string,@Param('which') which:string,@Res() res:Response){
  if(!/^(0|[1-9]\d?)$/.test(p)||Number(p)>49||!['image','common'].includes(which))throw notFound();
  const bytes=await this.service.image(w.userId,id,Number(p),which==='image'?'question':'common');
  res.status(200).set({'Content-Type':'image/webp','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Length':String(bytes.length)}).end(bytes);
 }
}


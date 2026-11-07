import { Body,Header,Controller,Get,Module,Param,ParseUUIDPipe,Post,Put,UseGuards,Res,Query } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentAuth,JwtAuthGuard,type AuthContext } from '../auth/guards';
import { ToeicCbtService } from './service';
import { ToeicPracticeService } from './practice';
import { CreateToeicRunDto,ToeicCheckpointDto,ToeicRevisionDto,ToeicSubmitDto,ToeicPracticeAnswerDto,ToeicPracticeGroupDto } from './dto';
@Controller('api/v1/toeic-cbt') @UseGuards(JwtAuthGuard)
export class ToeicCbtController {
 constructor(private readonly cbt:ToeicCbtService,private readonly practice:ToeicPracticeService){}
 @Get('collections/:id/images/:key') async image(@CurrentAuth() a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Param('key') key:string,@Res() res:Response){const image=await this.cbt.image(a.userId,id,key);res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type',image.media_type);res.setHeader('X-Content-Type-Options','nosniff');res.send(image.bytes);}
 @Get('practice-history') practiceHistory(@CurrentAuth() a:AuthContext,@Query('cursor') cursor?:string){return this.practice.history(a.userId,cursor);}
 @Get('collections/:id/audio/:groupId') async audio(@CurrentAuth() a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Param('groupId') groupId:string,@Res() res:Response){const bytes=await this.practice.audioFile(a.userId,id,groupId);res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type','audio/mpeg');res.setHeader('X-Content-Type-Options','nosniff');res.send(bytes);}
 @Get('player') player(@CurrentAuth() a:AuthContext){return this.practice.playlist(a.userId);}
 @Get('practice') practiceList(@CurrentAuth() a:AuthContext){return this.practice.list(a.userId);}
 @Get('collections/:id/practice') questions(@CurrentAuth() a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'})) id:string){return this.practice.questions(a.userId,id);}
 @Get('collections/:id/practice-reviews') @Header('Cache-Control','private, no-store') reviews(@CurrentAuth() a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'})) id:string){return this.practice.reviews(a.userId,id);}
 @Post('collections/:id/answer') answer(@CurrentAuth() a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Body() d:ToeicPracticeAnswerDto){return this.practice.answer(a.userId,id,d);}
 @Post('collections/:id/group-answer') answerGroup(@CurrentAuth() a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Body() d:ToeicPracticeGroupDto){return this.practice.answerGroup(a.userId,id,d);}
 @Get('collections/:id/study') study(@CurrentAuth() a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'})) id:string){return this.cbt.study(a.userId,id);}
 @Get('collections') collections(@CurrentAuth() a:AuthContext){return this.cbt.collections(a.userId);}
 @Get('runs') runs(@CurrentAuth() a:AuthContext){return this.cbt.runs(a.userId);}
 @Post('runs') create(@CurrentAuth() a:AuthContext,@Body() d:CreateToeicRunDto){return this.cbt.create(a.userId,d);}
 @Get('runs/:id') get(@CurrentAuth() a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'})) id:string){return this.cbt.get(a.userId,id);}
 @Post('runs/:id/start') start(@CurrentAuth() a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'})) id:string){return this.cbt.start(a.userId,id);}
 @Put('runs/:id/checkpoint') checkpoint(@CurrentAuth() a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Body() d:ToeicCheckpointDto){return this.cbt.checkpoint(a.userId,id,d);}
 @Post('runs/:id/resume') resume(@CurrentAuth() a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Body() d:ToeicRevisionDto){return this.cbt.resume(a.userId,id,d.revision);}
 @Post('runs/:id/submit') submit(@CurrentAuth() a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Body() d:ToeicSubmitDto){return this.cbt.submit(a.userId,id,d);}
}
@Module({controllers:[ToeicCbtController],providers:[ToeicCbtService,ToeicPracticeService]})export class ToeicCbtModule{}

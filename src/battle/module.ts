import {Body,Controller,Get,Module,Param,Query,ParseIntPipe,ParseUUIDPipe,Post,Req,Res,UseGuards} from '@nestjs/common';
import {Type} from 'class-transformer';
import {ArrayMaxSize,IsArray,IsIn,IsInt,IsString,IsOptional,Matches,IsUUID,Max,MaxLength,Min,ValidateIf,ValidateNested} from 'class-validator';
import type {Request,Response} from 'express';
import {AppError} from '../common/app-error';
import {randomInt} from 'node:crypto';
import {AuthModule} from '../auth/auth.module';
import {CurrentAuth,JwtAuthGuard,type AuthContext} from '../auth/guards';
import {BattleStream} from './stream';
import {legacyLobbySessionId} from './legacy-session';
import {bundles} from './questions';
import {BattleService,BATTLE_RANDOM,BATTLE_BANK} from './service';
export class LobbySession { @ValidateIf((_object,value)=>value!==undefined) @IsUUID('4') sessionId?:string; }
export class EventsQuery extends LobbySession { @IsOptional() @IsIn(['site']) place?:'site'; }
export class SitePresence { @IsUUID('4') sessionId:string; @IsIn(['site','island']) place:'site'|'island'; }
export class EnterBattle extends LobbySession { @IsIn(['agumon','patamon']) family:'agumon'|'patamon'; }
export class PracticeBattle extends EnterBattle { @IsOptional() @IsIn(['history','toeic']) subject?:'history'|'toeic'; }
export class ChallengeBattle { @IsOptional() @IsUUID('4') requestId?:string; @IsUUID('4') opponent:string; @IsIn(['history','toeic']) subject:'history'|'toeic'; }
export class ReadyBattle { @IsInt() @Min(1) @Max(2147483647) round:number; @IsOptional() @IsString() @Matches(/^[a-f0-9]{64}$/) mediaHash?:string; }
export class BattleAnswer { @IsString() @MaxLength(120) id:string; @IsString() @MaxLength(120) optionId:string; }
export class WrongBattleAnswer { @IsUUID('4') matchId:string; @IsInt() @Min(1) @Max(2147483647) round:number; @IsString() @MaxLength(120) itemId:string; @IsString() @MaxLength(120) optionId:string; @IsUUID('4') requestKey:string; }
export class SubmitBattle extends ReadyBattle { @IsArray() @ArrayMaxSize(10) @ValidateNested({each:true}) @Type(()=>BattleAnswer) answers:BattleAnswer[]; }
@Controller('api/v1/battle') @UseGuards(JwtAuthGuard)
export class BattleController {
 constructor(private readonly service:BattleService,private readonly stream:BattleStream){}
 @Get('events') events(@CurrentAuth()a:AuthContext,@Query()d:EventsQuery,@Req()req:Request,@Res()res:Response){if(d.place==='site'){if(!d.sessionId)throw new AppError(400,'battle_session_required','탭 식별자가 필요해요.');this.stream.openSite(a.userId,req.headers.authorization!.slice(7),req,res,d.sessionId);return;}this.stream.open(a.userId,req.headers.authorization!.slice(7),req,res,d.sessionId,d.sessionId?undefined:legacyLobbySessionId(a));}
 // Site-wide presence and invitation inbox: any signed-in page, not only the ice island.
 @Post('presence') presence(@CurrentAuth()a:AuthContext,@Body()d:SitePresence){return this.service.presence(a.userId,d.sessionId,d.place);}
 @Get('invitations') invitations(@CurrentAuth()a:AuthContext){return this.service.invitationState(a.userId);}
 @Get('wrongnotes') wrongnotes(@CurrentAuth()a:AuthContext){return this.service.wrongnotes(a.userId);}
 @Post('wrongnotes/answer') wrongAnswer(@CurrentAuth()a:AuthContext,@Body()d:WrongBattleAnswer){return this.service.wrongAnswer(a.userId,d);}
 @Get('history') history(@CurrentAuth()a:AuthContext,@Query('cursor')cursor?:string){if(cursor&&!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(cursor))return Promise.reject(new AppError(400,'invalid_cursor','기록 위치를 확인해 주세요.'));return this.service.history(a.userId,cursor);}
 @Get('history/:id') review(@CurrentAuth()a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'}))id:string){return this.service.review(a.userId,id);}
 @Get('history/:id/audio/:round') async reviewAudio(@CurrentAuth()a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'}))id:string,@Param('round',ParseIntPipe)round:number,@Res()res:Response){const bytes=await this.service.reviewAudio(a.userId,id,round);res.setHeader('Content-Type','audio/mpeg');res.setHeader('Cache-Control','private, no-store');res.send(bytes);}
 @Post('enter') enter(@CurrentAuth()a:AuthContext,@Body()d:EnterBattle){return this.service.enter(a.userId,d.family,d.sessionId||legacyLobbySessionId(a));}
 @Post('practice') practice(@CurrentAuth()a:AuthContext,@Body()d:PracticeBattle){return this.service.practice(a.userId,d.family,d.subject||'toeic');}
 @Get('lobby') lobby(@CurrentAuth()a:AuthContext,@Query()d:LobbySession){return this.service.lobby(a.userId,d.sessionId||legacyLobbySessionId(a),!d.sessionId);}
 @Post('leave') leave(@CurrentAuth()a:AuthContext,@Body()d:LobbySession){return d.sessionId?this.service.leave(a.userId,d.sessionId):{left:true,legacyLeaseExpiresInMs:25000};}
 @Post('suspend') suspend(@CurrentAuth()a:AuthContext,@Body()d:LobbySession){return d.sessionId?this.service.suspend(a.userId,d.sessionId):{left:true,legacyLeaseExpiresInMs:25000};}
 @Post('challenges') async challenge(@CurrentAuth()a:AuthContext,@Body()d:ChallengeBattle,@Res({passthrough:true})res:Response){const result=await this.service.challenge(a.userId,d.opponent,d.subject,d.requestId);res.status(result.challengeCreated?201:200);return result;}
 @Get('matches/:id') poll(@CurrentAuth()a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'}))id:string){return this.service.act(a.userId,id,'poll');}
 @Post('matches/:id/accept') accept(@CurrentAuth()a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'}))id:string){return this.service.act(a.userId,id,'accept');}
 @Post('matches/:id/decline') decline(@CurrentAuth()a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'}))id:string){return this.service.act(a.userId,id,'decline');}
 @Post('matches/:id/ready') ready(@CurrentAuth()a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'}))id:string,@Body()d:ReadyBattle){return this.service.act(a.userId,id,'ready',d);}
 @Post('matches/:id/answers') answers(@CurrentAuth()a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'}))id:string,@Body()d:SubmitBattle){return this.service.act(a.userId,id,'answer',d);}
 @Post('matches/:id/exit') exit(@CurrentAuth()a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'}))id:string){return this.service.act(a.userId,id,'exit');}
 @Post('matches/:id/forfeit') forfeit(@CurrentAuth()a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'}))id:string){return this.service.act(a.userId,id,'forfeit');}
 @Get('matches/:id/audio/:round') async audio(@CurrentAuth()a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'}))id:string,@Param('round',ParseIntPipe)round:number,@Res()res:Response){const bytes=await this.service.audio(a.userId,id,round);res.setHeader('Content-Type','audio/mpeg');res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.send(bytes);}
}
@Module({imports:[AuthModule],controllers:[BattleController],providers:[BattleService,BattleStream,{provide:BATTLE_BANK,useValue:bundles},{provide:BATTLE_RANDOM,useValue:()=>randomInt(0,1_000_000)/1_000_000}]})
export class BattleModule{}

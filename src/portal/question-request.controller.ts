import {Body,Controller,Get,Param,ParseUUIDPipe,Patch,Post,Query,Req,Res,UseGuards} from '@nestjs/common';
import type {Request,Response} from 'express';
import {CurrentAuth,JwtAuthGuard,type AuthContext} from '../auth/guards';
import {AppError} from '../common/app-error';
import {QuestionRequestDto,QuestionRequestUpdateDto,QuestionRequestReviewDto,QuestionRequestRevisionDto} from './question-request.dto';
import {PageQuery} from './portal.dto';
import {QuestionRequestService} from './question-request.service';
import {AUDIO_LIMIT,IMAGE_LIMIT,ASSET_PURPOSES} from './question-request-media';
async function upload(service:QuestionRequestService,actor:string,id:string,req:Request,admin=false){
 const purpose=String(req.query.purpose||''),mediaType=String(req.query.mediaType||''),assetId=String(req.query.assetId||''),revision=Number(req.query.expectedRevision);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assetId)||!Number.isSafeInteger(revision)||revision<1||!ASSET_PURPOSES.includes(purpose)||req.headers['content-type']!=='application/octet-stream')throw new AppError(400,'invalid_upload','Invalid upload parameters');
 await service.authorizeUpload(actor,id,admin);
 const limit=purpose==='audio'?AUDIO_LIMIT:IMAGE_LIMIT,length=Number(req.headers['content-length']);if(Number.isFinite(length)&&length>limit)throw new AppError(413,'asset_too_large','Asset size exceeds limit');
 const chunks:Buffer[]=[];let size=0;for await(const chunk of req){const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=buffer.length;if(size>limit)throw new AppError(413,'asset_too_large','Asset size exceeds limit');chunks.push(buffer);}
 return service.upload(actor,id,assetId,revision,purpose,mediaType,Buffer.concat(chunks),admin);
}
function sendAsset(res:Response,asset:{media_type:string;bytes:Buffer}){res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type',asset.media_type);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");res.send(asset.bytes);}
@Controller('api/v1/question-requests') @UseGuards(JwtAuthGuard)
export class OwnQuestionRequestController {
 constructor(private readonly service:QuestionRequestService){}
 @Get() list(@CurrentAuth()a:AuthContext,@Query()p:PageQuery){return this.service.list(a.userId,p);}
 @Post() create(@CurrentAuth()a:AuthContext,@Body()d:QuestionRequestDto){return this.service.create(a.userId,d);}
 @Get(':id') detail(@CurrentAuth()a:AuthContext,@Param('id',ParseUUIDPipe)id:string){return this.service.detail(a.userId,id);}
 @Patch(':id') update(@CurrentAuth()a:AuthContext,@Param('id',ParseUUIDPipe)id:string,@Body()d:QuestionRequestUpdateDto){return this.service.update(a.userId,id,d);}
 @Post(':id/submit') submit(@CurrentAuth()a:AuthContext,@Param('id',ParseUUIDPipe)id:string,@Body()d:QuestionRequestRevisionDto){return this.service.submit(a.userId,id,d.expectedRevision);}
 @Post(':id/assets') upload(@CurrentAuth()a:AuthContext,@Param('id',ParseUUIDPipe)id:string,@Req()req:Request){return upload(this.service,a.userId,id,req);}
 @Get(':id/assets/:assetId') async asset(@CurrentAuth()a:AuthContext,@Param('id',ParseUUIDPipe)id:string,@Param('assetId',ParseUUIDPipe)assetId:string,@Res()res:Response){sendAsset(res,await this.service.asset(a.userId,id,assetId));}
}
@Controller('api/v1/ops/question-requests') @UseGuards(JwtAuthGuard)
export class QuestionRequestController {
 constructor(private readonly service:QuestionRequestService){}
 @Get() list(@CurrentAuth()a:AuthContext,@Query()p:PageQuery){return this.service.list(a.userId,p,true);}
 @Get(':id') detail(@CurrentAuth()a:AuthContext,@Param('id',ParseUUIDPipe)id:string){return this.service.detail(a.userId,id,true);}
 @Patch(':id') review(@CurrentAuth()a:AuthContext,@Param('id',ParseUUIDPipe)id:string,@Body()d:QuestionRequestReviewDto){return this.service.review(a.userId,id,d);}
 @Post(':id/assets') upload(@CurrentAuth()a:AuthContext,@Param('id',ParseUUIDPipe)id:string,@Req()req:Request){return upload(this.service,a.userId,id,req,true);}
 @Get(':id/assets/:assetId') async asset(@CurrentAuth()a:AuthContext,@Param('id',ParseUUIDPipe)id:string,@Param('assetId',ParseUUIDPipe)assetId:string,@Res()res:Response){sendAsset(res,await this.service.asset(a.userId,id,assetId,true));}
}

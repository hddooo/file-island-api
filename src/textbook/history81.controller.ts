import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { CurrentAuth, type AuthContext, JwtAuthGuard } from '../auth/guards';
import { ScriptHeadersGuard } from './joseon-script.controller';
import { TextbookMemberGuard } from './textbook-member.guard';
import { History81Service, type History81Batch } from './history81.service';
class Update81 {
 @IsString() @MaxLength(200) itemId:string;
 @IsArray() @ArrayMaxSize(30) @IsString({each:true}) @MaxLength(2000,{each:true}) values:string[];
 @IsBoolean() submitted:boolean;
 @IsOptional() @IsArray() @ArrayMaxSize(30) @IsBoolean({each:true}) checkedSlots?:boolean[];
}
export class Batch81 implements History81Batch {
 @IsString() @MaxLength(64) version:string;
 @IsInt() @Min(0) @Max(1000000) revision:number;
 @IsUUID('4') mutationId:string;
 @IsInt() @Min(0) @Max(199) cursor:number;
 @IsIn(['active','paused']) status:'active'|'paused';
 @IsArray() @ArrayMaxSize(200) @ValidateNested({each:true}) @Type(()=>Update81) updates:Update81[];
 @ValidateIf((_object,value)=>value!==undefined) @IsArray() @ArrayMaxSize(172) @ArrayUnique() @IsString({each:true}) @MaxLength(200,{each:true}) selectedReviewQuestionIds?:string[];
}
@Controller('api/v1/textbook/revisions/:revision/semantic')
@UseGuards(ScriptHeadersGuard,JwtAuthGuard,TextbookMemberGuard)
export class History81Controller {
 constructor(private readonly history:History81Service){}
 @Get('quizzes/:era') quiz(@Param('revision') revision:string,@Param('era') era:string){return this.history.quiz(revision,era);}
 @Get('workspaces/:era') get(@CurrentAuth() who:AuthContext,@Param('revision') revision:string,@Param('era') era:string){return this.history.get(who.userId,revision,era);}
 @Put('workspaces/:era') save(@CurrentAuth() who:AuthContext,@Param('revision') revision:string,@Param('era') era:string,@Body() body:Batch81){return this.history.save(who.userId,revision,era,body);}
}

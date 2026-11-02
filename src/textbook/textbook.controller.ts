import { Body, Controller, Get, Header, Param, Put, Res, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsString, IsUUID, Max, MaxLength, Min, ArrayMaxSize, IsOptional, IsBoolean, ValidateNested } from 'class-validator';
import { SourceBlankProgressService, type ProgressMutation, type SourceBatch } from './source-blank-progress';
import type { Response } from 'express';
import { CurrentAuth, type AuthContext, JwtAuthGuard } from '../auth/guards';
import { TextbookMemberGuard } from './textbook-member.guard';
import { TextbookService } from './textbook.service';

class SourceProgressDto implements ProgressMutation {
 @IsString() @MaxLength(64) version: string;
 @IsInt() @Min(0) @Max(1000000) revision: number;
 @IsUUID('4') mutationId: string;
 @IsIn(['draft','answer','pause']) action: 'draft' | 'answer' | 'pause';
 @IsInt() @Min(0) @Max(200) position: number;
 @IsArray() @ArrayMaxSize(30) @IsString({each:true}) @MaxLength(2000,{each:true}) values: string[];
}

class SourceBatchUpdateDto {
 @IsString() @MaxLength(200) itemId: string;
 @IsArray() @ArrayMaxSize(30) @IsString({each:true}) @MaxLength(2000,{each:true}) values: string[];
 @IsBoolean() submitted: boolean;
 @IsOptional() @IsArray() @ArrayMaxSize(30) @IsBoolean({each:true}) checkedSlots?: boolean[];
}
class SourceBatchDto implements SourceBatch {
 @IsString() @MaxLength(64) version: string;
 @IsInt() @Min(0) @Max(1000000) revision: number;
 @IsUUID('4') mutationId: string;
 @IsInt() @Min(0) @Max(199) cursor: number;
 @IsIn(['active','paused']) status: 'active' | 'paused';
 @IsArray() @ArrayMaxSize(200) @ValidateNested({each:true}) @Type(()=>SourceBatchUpdateDto) updates: SourceBatchUpdateDto[];
}

@Controller('api/v1/textbook')
@UseGuards(JwtAuthGuard, TextbookMemberGuard)
export class TextbookController {
  constructor(private readonly textbook: TextbookService, private readonly sourceProgress: SourceBlankProgressService) {}

  @Get('semantic/workspaces/:id')
  @Header('Cache-Control','private, no-store')
  sourceWorkspaceGet(@CurrentAuth() who: AuthContext,@Param('id') id: string){return this.sourceProgress.getWorkspace(who.userId,id);}

  @Put('semantic/workspaces/:id')
  @Header('Cache-Control','private, no-store')
  sourceWorkspaceSave(@CurrentAuth() who: AuthContext,@Param('id') id: string,@Body() dto: SourceBatchDto){return this.sourceProgress.saveWorkspace(who.userId,id,dto);}

  @Get('semantic/progress/:id')
  @Header('Cache-Control', 'private, no-store')
  sourceProgressGet(@CurrentAuth() who: AuthContext, @Param('id') id: string) { return this.sourceProgress.get(who.userId,id); }

  @Put('semantic/progress/:id')
  @Header('Cache-Control', 'private, no-store')
  sourceProgressSave(@CurrentAuth() who: AuthContext, @Param('id') id: string, @Body() dto: SourceProgressDto) { return this.sourceProgress.save(who.userId,id,dto); }

  @Get('semantic/manifest')
  @Header('Cache-Control', 'private, no-store')
  semanticManifest() { return this.textbook.semanticManifest(); }

  @Get('semantic/quizzes/:id')
  @Header('Cache-Control', 'private, no-store')
  semanticQuiz(@Param('id') id: string) { return this.textbook.semanticQuiz(id); }

  @Get('semantic/choices/:id')
  @Header('Cache-Control', 'private, no-store')
  semanticChoices(@Param('id') id: string) { return this.textbook.semanticChoices(id); }

  @Get('semantic/pages/:page')
  @Header('Cache-Control', 'private, no-store')
  semanticPage(@Param('page') page: string) { return this.textbook.semanticPage(page); }

  @Get('semantic/figures/:id')
  @Header('Cache-Control', 'private, no-store')
  async semanticFigure(@Param('id') id: string, @Res() response: Response) {
    const { data, mime } = await this.textbook.semanticFigure(id);
    response.setHeader('Content-Type', mime);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    response.send(data);
  }

  @Get('manifest')
  @Header('Cache-Control', 'private, no-store')
  manifest() { return this.textbook.manifest(); }

  @Get('pages/:page')
  @Header('Cache-Control', 'private, no-store')
  page(@Param('page') page: string) { return this.textbook.page(page); }

  @Get('pages/:page/enhanced')
  @Header('Cache-Control', 'private, no-store')
  async enhanced(@Param('page') page: string, @Res() response: Response) {
    const image = await this.textbook.image(page, true);
    response.setHeader('Content-Type', 'image/png');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    response.send(image);
  }

  @Get('pages/:page/image')
  @Header('Cache-Control', 'private, no-store')
  async image(@Param('page') page: string, @Res() response: Response) {
    const image = await this.textbook.image(page);
    response.setHeader('Content-Type', 'image/png');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    response.send(image);
  }
}

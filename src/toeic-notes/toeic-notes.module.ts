import {WeaknessPracticeController,WeaknessPracticeService,VOCABULARY_MINI_RELEASED} from './weakness-practice';
import { WordChecksController,WordChecksService } from './word-checks';
import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CurrentAuth, JwtAuthGuard, type AuthContext } from '../auth/guards';
import { NoteDto, MergeDto, ArchiveNoteDto } from './toeic-notes.dto';
import { ToeicRecallController, ToeicRecallService } from './toeic-recall';
import { ToeicNotesService } from './toeic-notes.service';
@Controller('api/v1/toeic-notes')
@UseGuards(JwtAuthGuard)
export class ToeicNotesController {
 constructor(private readonly notes: ToeicNotesService) {}
 @Get() list(@CurrentAuth() a:AuthContext) {return this.notes.list(a.userId);}
 @Put(':id/archive') archive(@CurrentAuth() a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Body() d:ArchiveNoteDto) {return this.notes.archive(a.userId,id,d.archived);}
 @Put(':id') save(@CurrentAuth() a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Body() d:NoteDto) {return this.notes.save(a.userId,id,d);}
 @Post(':id/merge') merge(@CurrentAuth() a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Body() d:MergeDto) {return this.notes.merge(a.userId,id,d);}
}
@Module({imports:[AuthModule],controllers:[WeaknessPracticeController,ToeicNotesController,ToeicRecallController,WordChecksController],providers:[{provide:VOCABULARY_MINI_RELEASED,useValue:true},WeaknessPracticeService,ToeicNotesService,ToeicRecallService,WordChecksService]})
export class ToeicNotesModule {}

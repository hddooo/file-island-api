import { Body, Controller, Get, Injectable, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { CurrentAuth, JwtAuthGuard, type AuthContext } from '../auth/guards';
import { AppError } from '../common/app-error';
import { lockOwner } from '../common/owner-lock';
import { DbService } from '../db/db.service';
export class RecallDto {
 @IsInt() @Min(1) @Max(2147483647) noteRevision:number;
 @IsInt() @Min(0) @Max(2147483646) revision:number;
 @IsString() @MaxLength(6000) answer:string;
 @IsBoolean() revealed:boolean;
 @IsIn(['','known','review']) evaluation:string;
}
export class RecallViewDto {
 @IsIn(['','1','2','3-4','5-6','7','unclassified']) part:string;
 @IsInt() @Min(0) @Max(2147483647) batch:number;
}
interface ProgressRow {note_id:string;note_revision:number;answer:string;revealed:boolean;evaluation:string;revision:number;}
function publicProgress(p:ProgressRow){return{noteId:p.note_id,noteRevision:p.note_revision,answer:p.answer,revealed:p.revealed,evaluation:p.evaluation,revision:p.revision};}
@Injectable()
export class ToeicRecallService {
 constructor(private readonly db:DbService){}
 async read(owner:string){
  const progress=await this.db.pool.query<ProgressRow>(`SELECT p.* FROM hanq.toeic_recall_progress p JOIN hanq.toeic_notes n ON n.user_id=p.user_id AND n.id=p.note_id AND n.revision=p.note_revision WHERE p.user_id=$1 AND n.archived_at IS NULL`,[owner]);
  const view=await this.db.pool.query<{part:string;batch:number}>('SELECT part,batch FROM hanq.toeic_recall_view WHERE user_id=$1',[owner]);
  return {progress:progress.rows.map(publicProgress),view:view.rows[0]||{part:'',batch:0}};
 }
 async view(owner:string,d:RecallViewDto){await this.db.pool.query('INSERT INTO hanq.toeic_recall_view(user_id,part,batch) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET part=EXCLUDED.part,batch=EXCLUDED.batch',[owner,d.part,d.batch]);return{view:d};}
 async save(owner:string,id:string,d:RecallDto){
  if(d.revealed&&!d.answer.trim()||d.evaluation&&!d.revealed)throw new AppError(400,'invalid_recall','Enter an answer before revealing and self-evaluating');
  return this.db.tx(async q=>{
   await lockOwner(q,owner);
   const note=(await q.query<{revision:number}>('SELECT revision FROM hanq.toeic_notes WHERE user_id=$1 AND id=$2',[owner,id])).rows[0];
   if(!note)throw new AppError(404,'note_not_found','Note not found');
   if(note.revision!==d.noteRevision)throw new AppError(409,'note_conflict','The source note changed; reload before practicing');
   const old=(await q.query<ProgressRow>('SELECT * FROM hanq.toeic_recall_progress WHERE user_id=$1 AND note_id=$2',[owner,id])).rows[0];
   const current=old&&old.note_revision===d.noteRevision?old:null;
   // Exact retries after a lost response are safe; concurrent different edits still conflict.
   if(current&&current.revision===d.revision+1&&current.answer===d.answer&&current.revealed===d.revealed&&current.evaluation===d.evaluation)return{progress:publicProgress(current)};
   if((current?.revision||0)!==d.revision)throw new AppError(409,'recall_conflict','Progress changed in another tab; reload to compare');
   const saved=await q.query<ProgressRow>(`INSERT INTO hanq.toeic_recall_progress(user_id,note_id,note_revision,answer,revealed,evaluation,revision) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(user_id,note_id) DO UPDATE SET note_revision=EXCLUDED.note_revision,answer=EXCLUDED.answer,revealed=EXCLUDED.revealed,evaluation=EXCLUDED.evaluation,revision=EXCLUDED.revision,updated_at=now() RETURNING *`,[owner,id,d.noteRevision,d.answer,d.revealed,d.evaluation,d.revision+1]);
   return{progress:publicProgress(saved.rows[0])};
  });
 }
}
@Controller('api/v1/toeic-recall')
@UseGuards(JwtAuthGuard)
export class ToeicRecallController {
 constructor(private readonly recall:ToeicRecallService){}
 @Get() read(@CurrentAuth() a:AuthContext){return this.recall.read(a.userId);}
 @Put('view') view(@CurrentAuth() a:AuthContext,@Body() d:RecallViewDto){return this.recall.view(a.userId,d);}
 @Put(':id') save(@CurrentAuth() a:AuthContext,@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Body() d:RecallDto){return this.recall.save(a.userId,id,d);}
}

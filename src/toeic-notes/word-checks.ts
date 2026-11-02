import { Body,Controller,Get,Injectable,Put,UseGuards } from '@nestjs/common';
import { ArrayMaxSize,ArrayUnique,IsArray,IsBoolean,IsInt,IsString,Matches,MaxLength,Min } from 'class-validator';
import { JwtAuthGuard,CurrentAuth,type AuthContext } from '../auth/guards';
import { DbService } from '../db/db.service';
import { lockOwner } from '../common/owner-lock';
import { AppError } from '../common/app-error';
export class WordChecksDto {
 @IsArray() @ArrayMaxSize(10000) @ArrayUnique() @IsString({each:true}) @MaxLength(200,{each:true}) @Matches(/^[a-zA-Z0-9:_%.()~-]{1,200}$/,{each:true}) ids!:string[];
 @IsInt() @Min(0) revision!:number;
 @IsBoolean() importLegacy!:boolean;
}
interface Row {ids:string[];revision:number;legacy_imported:boolean}
export const publicChecks=(r?:Row)=>({ids:r?.ids||[],revision:r?.revision||0,legacyImported:r?.legacy_imported||false});
@Injectable()
export class WordChecksService {
 constructor(private readonly db:DbService){}
 async get(userId:string){return publicChecks((await this.db.pool.query<Row>('SELECT ids,revision,legacy_imported FROM hanq.toeic_word_checks WHERE user_id=$1',[userId])).rows[0]);}
 async save(userId:string,d:WordChecksDto){return this.db.tx(async q=>{await lockOwner(q,userId);const old=(await q.query<Row>('SELECT ids,revision,legacy_imported FROM hanq.toeic_word_checks WHERE user_id=$1',[userId])).rows[0];if((old?.revision||0)!==d.revision||d.importLegacy&&(old?.legacy_imported||!!old?.revision))throw new AppError(409,'word_checks_conflict','Reload checks before applying changes');const r=await q.query<Row>(`INSERT INTO hanq.toeic_word_checks(user_id,ids,revision,legacy_imported) VALUES($1,$2::jsonb,1,true) ON CONFLICT(user_id) DO UPDATE SET ids=EXCLUDED.ids,revision=toeic_word_checks.revision+1,legacy_imported=true,updated_at=now() RETURNING ids,revision,legacy_imported`,[userId,JSON.stringify(d.ids)]);return publicChecks(r.rows[0]);});}
}
@Controller('api/v1/toeic-word-checks') @UseGuards(JwtAuthGuard)
export class WordChecksController {
 constructor(private readonly checks:WordChecksService){}
 @Get() get(@CurrentAuth() a:AuthContext){return this.checks.get(a.userId);}
 @Put() put(@CurrentAuth() a:AuthContext,@Body() d:WordChecksDto){return this.checks.save(a.userId,d);}
}

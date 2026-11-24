import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentAuth, JwtAuthGuard, type AuthContext } from '../auth/guards';
import { notFound } from '../common/app-error';
import { DbService } from '../db/db.service';
import { isCbtRoundParam } from './cbt-policy';

/** Study-grounded explanations for one official round. Private study content: signed-in members only, read-only. */
@Controller('api/v1/cbt/study-explanations') @UseGuards(JwtAuthGuard)
export class StudyExplanationsController {
 constructor(private readonly db:DbService) {}
 @Get(':round') async round(@CurrentAuth() _w:AuthContext,@Param('round') round:string){
  if(!isCbtRoundParam(round))throw notFound();
  const rows=(await this.db.pool.query<{payload:Record<string,unknown>}>('SELECT payload FROM hanq.cbt_study_explanations WHERE exam_round=$1 ORDER BY exam_number',[Number(round)])).rows;
  return {round:Number(round),items:rows.map(r=>r.payload)};
 }
}

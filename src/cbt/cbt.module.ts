import { Module } from '@nestjs/common';
import { CbtAssetsService } from './cbt-assets.service';
import { CbtController } from './cbt.controller';
import { CbtRepository } from './cbt.repository';
import { CbtService } from './cbt.service';
import { CbtReviewController } from './cbt-review.controller';
import { CbtReviewService } from './cbt-review.service';
import { UigeumbuController } from './uigeumbu.controller';
import { StudyExplanationsController } from './study-explanations.controller';
import { UigeumbuService } from './uigeumbu.service';

/** Authenticated official-round CBT. Separate from WrongNotesModule (its personal runs and study sessions are untouched);
 *  CBT grading only appends ordinary attempts, which the existing wrong notes already derive from. */
@Module({ controllers: [CbtController, CbtReviewController, UigeumbuController, StudyExplanationsController], providers: [CbtService, CbtRepository, CbtAssetsService, CbtReviewService, UigeumbuService] })
export class CbtModule {}

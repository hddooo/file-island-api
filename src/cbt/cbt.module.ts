import {PaperResultsService} from './paper-results.service';
import {PaperResultsController} from './paper-results.controller';
import { Module } from '@nestjs/common';
import { CbtAssetsService } from './cbt-assets.service';
import { CbtController } from './cbt.controller';
import { CbtRepository } from './cbt.repository';
import { CbtService } from './cbt.service';
import { CbtReviewController } from './cbt-review.controller';
import { CbtReviewService } from './cbt-review.service';

/** Authenticated official-round CBT. Separate from WrongNotesModule (its personal runs and study sessions are untouched);
 *  CBT grading only appends ordinary attempts, which the existing wrong notes already derive from. */
@Module({ controllers: [CbtController, CbtReviewController, PaperResultsController], providers: [CbtService, CbtRepository, CbtAssetsService, CbtReviewService, PaperResultsService] })
export class CbtModule {}

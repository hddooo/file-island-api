import { HongmungwanController } from './hongmungwan.controller';
import { HongmungwanService } from './hongmungwan.service';
import { CoreReviewsController } from './core-reviews.controller';
import { Module } from '@nestjs/common';
import { RunsRepository } from './runs.repository';
import { RunsService } from './runs.service';
import { WrongNotesController } from './wrong-notes.controller';
import { WrongNotesRepository } from './wrong-notes.repository';
import { WrongNotesService } from './wrong-notes.service';

@Module({ controllers: [HongmungwanController, WrongNotesController, CoreReviewsController], providers: [HongmungwanService, WrongNotesService, WrongNotesRepository, RunsService, RunsRepository] })
export class WrongNotesModule {}

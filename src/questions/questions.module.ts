import { Global, Module } from '@nestjs/common';
import { QuestionsController } from './questions.controller';
import { QuestionsRepository } from './questions.repository';
import { QuestionsService } from './questions.service';

@Global()
@Module({ controllers: [QuestionsController], providers: [QuestionsService, QuestionsRepository], exports: [QuestionsService, QuestionsRepository] })
export class QuestionsModule {}

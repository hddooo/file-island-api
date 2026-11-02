import {MyRecordsService} from './my-records';
import { Global, Module } from '@nestjs/common';
import { AttemptsController } from './attempts.controller';
import { AttemptsRepository } from './attempts.repository';
import { AttemptsService } from './attempts.service';
import { ImportService } from './import.service';

@Global()
@Module({ controllers: [AttemptsController], providers: [MyRecordsService, AttemptsService, AttemptsRepository, ImportService], exports: [AttemptsService, AttemptsRepository] })
export class AttemptsModule {}

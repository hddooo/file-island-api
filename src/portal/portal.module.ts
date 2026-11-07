import {QuestionRequestPublicationService} from './question-request-publication.service';
import {QuestionRequestController,OwnQuestionRequestController,PublishedQuestionController} from './question-request.controller';
import {QuestionRequestService} from './question-request.service';
import {Module} from '@nestjs/common';
import {AuthModule} from '../auth/auth.module';
import {PortalController} from './portal.controller';
import {PortalService} from './portal.service';
@Module({imports:[AuthModule],controllers:[PortalController,QuestionRequestController,OwnQuestionRequestController,PublishedQuestionController],providers:[PortalService,QuestionRequestService,QuestionRequestPublicationService]})export class PortalModule{}

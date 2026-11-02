import {HallController,HallService} from './hall-of-fame';
import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({ controllers: [ProfileController,HallController], providers: [ProfileService,HallService] })
export class ProfileModule {}

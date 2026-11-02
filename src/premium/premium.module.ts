import { Global, Module } from '@nestjs/common';
import { PremiumRepository } from './premium.repository';
import { PremiumService } from './premium.service';

@Global()
@Module({ providers: [PremiumService, PremiumRepository], exports: [PremiumService] })
export class PremiumModule {}

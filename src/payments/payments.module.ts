import { Module } from '@nestjs/common';
import { PremiumController } from '../premium/premium.controller';
import { PremiumModule } from '../premium/premium.module';
import { PaymentsController } from './payments.controller';
import { PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';

/** PremiumController is registered here because its public "plan" endpoint reports checkout availability (payments)
 *  while payments depend on PremiumService — this keeps the module graph acyclic. */
@Module({
  imports: [PremiumModule],
  controllers: [PaymentsController, PremiumController],
  providers: [PaymentsService, PaymentsRepository],
})
export class PaymentsModule {}

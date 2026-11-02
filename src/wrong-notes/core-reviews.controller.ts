import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { AppError } from '../common/app-error';
import { CORE_REVIEWS } from './core-review-content';

/** The same curated learning material for every authenticated member, independent of premium or personal history. */
@Controller('api/v1/reviews')
@UseGuards(JwtAuthGuard)
export class CoreReviewsController {
 @Get('core')
 core(@Query('era') era?:string) {
  if(!era||!['ancient','goryeo','joseon','opening','colonial','modern'].includes(era))throw new AppError(400,'invalid_review_era','Unsupported review era');
  if(era==='ancient'||era==='goryeo')return CORE_REVIEWS[era];
  return {era,source:'common-core',ready:true};
 }
}

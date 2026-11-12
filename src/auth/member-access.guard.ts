import {ExecutionContext, Injectable} from '@nestjs/common';
import {JwtAuthGuard} from './guards';
/** Fail closed for all application APIs; exemptions are exact controller handlers, not client paths. */
@Injectable()
export class MemberAccessGuard extends JwtAuthGuard {
 override async canActivate(ctx:ExecutionContext):Promise<boolean>{
  const key=ctx.getClass().name+'.'+ctx.getHandler().name;
  const publicHandlers=new Set([
   'AuthController.signup','AuthController.signin','AuthController.refresh','AuthController.logout','AuthController.siteCheck',
   'MemberController.nickname','MemberController.email','PremiumController.plan',
   'HealthController.health','HealthController.stream','PaymentsController.webhook',
  ]);
  if(publicHandlers.has(key))return true;
  return super.canActivate(ctx);
 }
}

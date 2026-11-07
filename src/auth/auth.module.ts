import {APP_GUARD} from '@nestjs/core';
import {MemberAccessGuard} from './member-access.guard';
import {MemberApprovalController} from './member-approval.controller';
import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CookieCsrfGuard, JwtAuthGuard, OptionalAuthGuard } from './guards';
import { LoginThrottleRepository } from './login-throttle.repository';
import { PasswordService } from './password.service';
import { SessionsRepository } from './sessions.repository';
import { TokenService } from './token.service';
import { UsersRepository } from './users.repository';

/** Global so every domain can use JwtAuthGuard without re-importing. */
@Global()
@Module({
  controllers: [AuthController, MemberApprovalController],
  providers: [{provide: APP_GUARD, useClass: MemberAccessGuard}, AuthService, TokenService, PasswordService, UsersRepository, SessionsRepository, LoginThrottleRepository, JwtAuthGuard, OptionalAuthGuard, CookieCsrfGuard],
  exports: [AuthService, TokenService, PasswordService, UsersRepository, SessionsRepository, JwtAuthGuard, OptionalAuthGuard, CookieCsrfGuard],
})
export class AuthModule {}

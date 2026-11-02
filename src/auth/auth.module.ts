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
  controllers: [AuthController],
  providers: [AuthService, TokenService, PasswordService, UsersRepository, SessionsRepository, LoginThrottleRepository, JwtAuthGuard, OptionalAuthGuard, CookieCsrfGuard],
  exports: [AuthService, TokenService, PasswordService, UsersRepository, SessionsRepository, JwtAuthGuard, OptionalAuthGuard, CookieCsrfGuard],
})
export class AuthModule {}

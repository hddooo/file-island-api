import {BattleModule} from './battle/module';
import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { AppConfig } from './config/config';
import { APP_CONFIG, CLOCK, systemClock, type Clock } from './common/tokens';
import { TextbookModule } from './textbook/textbook.module';
import { AttemptsModule } from './attempts/attempts.module';
import { AuthModule } from './auth/auth.module';
import { CbtModule } from './cbt/cbt.module';
import { AUTH_RATE_LIMITED } from './auth/guards';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import {PortalModule} from './portal/portal.module';
import { MemberModule } from './portal/member.module';
import { PaymentsModule } from './payments/payments.module';
import { PremiumModule } from './premium/premium.module';
import { ProfileModule } from './profile/profile.module';
import { QuestionsModule } from './questions/questions.module';
import { ToeicCbtModule } from './toeic-cbt/module';
import { ToeicNotesModule } from './toeic-notes/toeic-notes.module';
import { WrongNotesModule } from './wrong-notes/wrong-notes.module';

@Global()
@Module({})
class CoreModule {
  static forRoot(config: AppConfig, clock: Clock): DynamicModule {
    return {
      module: CoreModule,
      providers: [{ provide: APP_CONFIG, useValue: config }, { provide: CLOCK, useValue: clock }],
      exports: [APP_CONFIG, CLOCK],
    };
  }
}

@Module({})
export class AppModule {
  static forRoot(opts: { config: AppConfig; clock?: Clock }): DynamicModule {
    const { config } = opts;
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(config, opts.clock ?? systemClock),
        // Per-IP limits (in-memory per instance): a general one for every route and a strict one for credential routes.
        // Failed sign-ins are additionally limited per account in PostgreSQL (shared by all instances).
        ThrottlerModule.forRoot({
          throttlers: [
            { name: 'default', ttl: 60_000, limit: config.rateLimit.perMinute },
            { name: 'auth', ttl: 60_000, limit: config.rateLimit.authPerMinute, skipIf: (ctx) => !Reflect.getMetadata(AUTH_RATE_LIMITED, ctx.getHandler()) },
          ],
        }),
        DbModule,
        AuthModule,
        PremiumModule,
        QuestionsModule,
        BattleModule,
        AttemptsModule,
        ProfileModule,
        WrongNotesModule,
        ToeicNotesModule,
        ToeicCbtModule,
        CbtModule,
        TextbookModule,
        PaymentsModule,MemberModule,PortalModule,
      ],
      controllers: [HealthController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    };
  }
}


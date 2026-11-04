/** Isolated API/FE QA only. Never imports AppModule, configuration, database or startup/migrations. */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { AuthService } from '../../src/auth/auth.service';
import { JwtAuthGuard } from '../../src/auth/guards';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter';
import { JoseonScriptController, ScriptHeadersGuard } from '../../src/textbook/joseon-script.controller';
import { JOSEON_SCRIPT_ROOT, JoseonScriptService } from '../../src/textbook/joseon-script.service';
import { TextbookMemberGuard } from '../../src/textbook/textbook-member.guard';

async function main() {
  if (process.env.NODE_ENV !== 'test' || process.argv[2] !== '--isolated-fixture') throw new Error('Requires explicit isolated test mode');
  const root = process.argv[3];
  if (!root) throw new Error('Private fixture directory required');
  const module = await Test.createTestingModule({ controllers: [JoseonScriptController], providers: [JoseonScriptService,
    ScriptHeadersGuard, JwtAuthGuard, TextbookMemberGuard, { provide: JOSEON_SCRIPT_ROOT, useValue: root },
    { provide: AuthService, useValue: { authenticate: async (token: string) => token === 'synthetic-joseon-session-123456789' ?
      { userId: 'synthetic-joseon-user', sessionId: 'synthetic-joseon-session' } : null } },
  ] }).compile();
  const app = module.createNestApplication({ logger: false });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({ origin: /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/, methods: ['GET'], allowedHeaders: ['Authorization'] });
  // Docker must publish this test listener on host 127.0.0.1 only. No production secrets/mounts.
  await app.listen(18081, '0.0.0.0');
  console.log('Isolated synthetic-session Script fixture listening on 18081; not real-account proof');
}
void main();

import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { loadConfig, type AppConfig } from './config/config';
import { runServer, StartupError } from './startup';

async function main() {
  const log = new Logger('HanQ');
  let config: AppConfig;
  try {
    config = loadConfig(process.env);
  } catch (e) {
    // Fail closed. The message names the variable, never its value.
    console.error(`[config] ${(e as Error).message}`);
    process.exit(1);
  }
  for (const w of config.warnings) log.warn(w);
  // Migrations first (existing migrator + advisory lock), then the app, then the listener — see src/startup.ts.
  await runServer(config, (line) => log.log(line));
  log.log(`listening on port ${config.port} (${config.env}); payment provider: ${config.payment.provider}`);
}

main().catch((e: Error & { code?: string }) => {
  // StartupError carries only a secret-free reason (class + driver code, or the migrator's file-name message).
  console.error(e instanceof StartupError ? `[startup] ${e.message}` : `[startup] ${e.name}${e.code ? ' code=' + e.code : ''}`);
  process.exit(1);
});

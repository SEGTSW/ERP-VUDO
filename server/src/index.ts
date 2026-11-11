import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { logger } from './logger.js';
import { migrate } from './migrate.js';
import { purgeExpiredSessions } from './auth/sessions.js';

async function main() {
  await migrate(pool, (m) => logger.info(m));

  const server = createApp().listen(config.port, () => {
    logger.info(`VUDO ERP API: http://localhost:${config.port} (${config.env})`);
  });

  const purge = setInterval(() => purgeExpiredSessions(pool).catch((err) => logger.error({ err }, 'purge sessions')), 3_600_000);
  purge.unref();

  const shutdown = (sig: string) => {
    logger.info(`${sig}: зупинка сервера`);
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Сервер не запустився');
  process.exit(1);
});

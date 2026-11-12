import express, { Router } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { pool } from './db.js';
import { HttpError, errorHandler } from './errors.js';
import { requireAppHeader, requireAuth } from './auth/middleware.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { profileRouter } from './routes/profile.js';
import { settingsRouter } from './routes/settings.js';
import { logRouter } from './routes/log.js';
import { clientsRouter } from './routes/clients.js';
import { ordersRouter } from './routes/orders.js';
import { filesRouter } from './routes/files.js';
import { planRouter } from './routes/plan.js';
import { issuesRouter } from './routes/issues.js';
import { stockRouter } from './routes/stock.js';
import { financeRouter } from './routes/finance.js';
import { moneyRouter } from './routes/money.js';
import { statsRouter } from './routes/stats.js';
import { timeRouter } from './routes/time.js';

function clientDist(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const p of [path.resolve(here, '../../client/dist'), path.resolve(here, '../client/dist')]) {
    if (existsSync(path.join(p, 'index.html'))) return p;
  }
  return null;
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.cookieSecure ? [] : null,
        },
      },
      // HSTS вмикається лише за HTTPS
      strictTransportSecurity: config.cookieSecure,
    }),
  );

  const api = Router();
  api.use(express.json({ limit: '1mb' }));
  api.use(cookieParser());
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use(requireAppHeader);

  api.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });

  api.use('/auth', authRouter);
  api.use(requireAuth);
  api.use(usersRouter);
  api.use(profileRouter);
  api.use(settingsRouter);
  api.use(logRouter);
  api.use(clientsRouter);
  api.use(ordersRouter);
  api.use(filesRouter);
  api.use(planRouter);
  api.use(issuesRouter);
  api.use(stockRouter);
  api.use(financeRouter);
  api.use(moneyRouter);
  api.use(statsRouter);
  api.use(timeRouter);
  api.use(() => {
    throw new HttpError(404, 'Невідомий запит.');
  });

  app.use('/api', api);

  // Зібраний інтерфейс (production): статика + усі інші шляхи віддають index.html.
  const dist = clientDist();
  if (dist) {
    app.use(express.static(dist, { index: false, maxAge: '1y', immutable: true }));
    app.get('/{*path}', (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}

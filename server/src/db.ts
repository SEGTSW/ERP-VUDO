import pg from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';

// bigint (id, count) повертаємо як number: значення в межах Number.MAX_SAFE_INTEGER.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
// numeric (гроші) — теж number; суми зберігаються з 2 знаками після коми.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
// bigint[] (installer_ids тощо) — масив чисел, а не рядків (інакше '3' !== 3 у порівняннях).
pg.types.setTypeParser(1016 as never, (v: string) => (v === '{}' ? [] : v.slice(1, -1).split(',').map(Number)));
// date — рядком РРРР-ММ-ДД, без перетворення часового поясу.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => logger.error({ err }, 'Помилка з’єднання з БД'));

export type Db = pg.Pool | pg.PoolClient;

/** Виконує fn у транзакції; при помилці — відкат. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

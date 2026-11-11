import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

/** Папка migrations поруч із src/ (dev) або dist/ (збірка). */
function migrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const p of [path.resolve(here, '../migrations'), path.resolve(here, '../../migrations')]) {
    if (existsSync(p)) return p;
  }
  throw new Error('Не знайдено папку migrations');
}

/**
 * Застосовує нові SQL-міграції по порядку, кожну у власній транзакції.
 * Advisory-lock не дає двом процесам мігрувати одночасно.
 */
export async function migrate(pool: pg.Pool, log: (msg: string) => void = () => {}): Promise<string[]> {
  const c = await pool.connect();
  const applied: string[] = [];
  try {
    await c.query('SELECT pg_advisory_lock(727001)');
    await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await c.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const dir = migrationsDir();
    const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(path.join(dir, f), 'utf8');
      try {
        await c.query('BEGIN');
        await c.query(sql);
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`Міграція ${f} не застосована: ${(e as Error).message}`);
      }
      applied.push(f);
      log(`Застосовано міграцію ${f}`);
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    c.release();
  }
  return applied;
}

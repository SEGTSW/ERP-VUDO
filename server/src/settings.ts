import { DEFAULT_SETTINGS, STATUSES, type MainStatus, type Settings } from '@vudo/shared';
import { z } from 'zod';
import type { Db } from './db.js';

const KEY = 'main';

const pct = (max = 100) => z.number().min(0).max(max);

export const settingsSchema = z.object({
  avansPct: pct(),
  markupPct: pct(500),
  designerPct: pct(),
  opexPct: pct(),
  opexMode: z.enum(['auto', 'fixed']),
  mgrPct: pct().nullable(),
  norms: z.partialRecord(z.enum(STATUSES), z.number().int().min(1).max(365)),
});

/** Поточні налаштування (відсутні ключі — значення за замовчуванням). */
export async function getSettings(db: Db, opts: { lock?: boolean } = {}): Promise<Settings> {
  if (opts.lock) {
    // Рядок має існувати, щоб його можна було заблокувати від паралельних змін.
    await db.query(`INSERT INTO settings (key, value) VALUES ($1, '{}') ON CONFLICT (key) DO NOTHING`, [KEY]);
  }
  const r = await db.query<{ value: Partial<Settings> }>(
    `SELECT value FROM settings WHERE key = $1${opts.lock ? ' FOR UPDATE' : ''}`,
    [KEY],
  );
  const stored = r.rows[0]?.value ?? {};
  return { ...DEFAULT_SETTINGS, ...stored, norms: stored.norms ?? DEFAULT_SETTINGS.norms };
}

export async function saveSettings(db: Db, s: Settings, userId: number): Promise<void> {
  settingsSchema.parse(s);
  await db.query(
    `INSERT INTO settings (key, value, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [KEY, JSON.stringify(s), userId],
  );
}

export const normOf = (s: Settings, st: string): number | undefined => s.norms[st as MainStatus];

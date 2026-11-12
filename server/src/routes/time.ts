/** 12В Табель — ведуть власник і менеджер; виконавцям сервер ці дані не віддає. У журнал не пишеться. */
import { Router } from 'express';
import { z } from 'zod';
import { kyivToday, monthDays, parseTimeValue } from '@vudo/shared';
import { pool, tx } from '../db.js';
import { badRequest } from '../errors.js';
import { me, requireSection } from '../auth/middleware.js';

export const timeRouter = Router();
timeRouter.use('/time', requireSection('time'));

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Неправильний місяць.');

timeRouter.get('/time', async (req, res) => {
  const month = monthSchema.default(kyivToday().slice(0, 7)).parse(req.query.month);
  const entries = await pool.query<{ userId: number; date: string; value: string }>(
    `SELECT user_id AS "userId", date, value FROM timesheet WHERE to_char(date, 'YYYY-MM') = $1`,
    [month],
  );
  // Працівники: усі активні + вимкнені, у яких є записи за цей місяць
  const withRows = [...new Set(entries.rows.map((e) => e.userId))];
  const users = await pool.query<{ id: number; name: string; roles: string[]; disabled: boolean }>(
    `SELECT id, name, roles, disabled FROM users WHERE NOT disabled OR id = ANY($1) ORDER BY name`,
    [withRows],
  );
  const values: Record<number, Record<string, string>> = {};
  for (const e of entries.rows) (values[e.userId] ??= {})[e.date] = e.value;
  res.json({ month, today: kyivToday(), days: monthDays(month), users: users.rows, values });
});

timeRouter.put('/time', async (req, res) => {
  const b = z.object({ userId: z.number().int().positive(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), value: z.string().max(10) }).parse(req.body);
  const v = parseTimeValue(b.value);
  if (v == null) throw badRequest('Години (0–24) або В, Л, ВП, П.');
  const u = me(req);
  if (v === '') await pool.query('DELETE FROM timesheet WHERE user_id = $1 AND date = $2', [b.userId, b.date]);
  else {
    await pool.query(
      `INSERT INTO timesheet (user_id, date, value, updated_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, date) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [b.userId, b.date, v, u.id],
    );
  }
  res.json({ value: v });
});

/** «Заповнити порожні будні по 8 год» — для активних працівників; уже внесене не чіпає. */
timeRouter.post('/time/fill', async (req, res) => {
  const month = monthSchema.parse(req.body?.month);
  const u = me(req);
  const days = monthDays(month).filter((d) => !d.weekend).map((d) => d.date);
  const r = await tx(async (c) =>
    c.query(
      `INSERT INTO timesheet (user_id, date, value, updated_by)
       SELECT u.id, d::date, '8', $2 FROM users u CROSS JOIN unnest($1::date[]) d WHERE NOT u.disabled
       ON CONFLICT (user_id, date) DO NOTHING`,
      [days, u.id],
    ),
  );
  res.json({ filled: r.rowCount ?? 0 });
});

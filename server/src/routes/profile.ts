import { Router } from 'express';
import { z } from 'zod';
import { MSG, PASSWORD_MIN, canSee, type Section } from '@vudo/shared';
import { pool, tx } from '../db.js';
import { HttpError, badRequest } from '../errors.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { destroyUserSessions } from '../auth/sessions.js';
import { me } from '../auth/middleware.js';
import { diffLine, writeLog } from '../audit.js';
import { getUser } from '../users.js';
import { sessionPayload } from './auth.js';

const profileSchema = z.object({
  phone: z.string().trim().max(40).transform((v) => v || null).optional(),
  theme: z.enum(['light', 'dark']).nullable().optional(),
  startSection: z.string().max(30).nullable().optional(),
  ordersRows: z.union([z.literal(25), z.literal(50), z.literal(100)]).nullable().optional(),
});

const passwordSchema = z.object({
  current: z.string().max(200),
  next: z.string().min(PASSWORD_MIN, `Новий пароль: щонайменше ${PASSWORD_MIN} символів.`).max(200),
});

export const profileRouter = Router();

/** «Мій профіль»: телефон, тема, розділ після входу, рядків у списку. Зберігається для конкретного користувача. */
profileRouter.patch('/profile', async (req, res) => {
  const b = profileSchema.parse(req.body);
  const u = me(req);
  if (b.startSection != null && (b.startSection === 'settings' || !canSee(u, b.startSection as Section))) {
    throw badRequest('Цей розділ недоступний для вашої ролі.', 'startSection');
  }
  const user = await tx(async (c) => {
    await c.query(
      `UPDATE users SET
         phone = CASE WHEN $2 THEN $3 ELSE phone END,
         theme = CASE WHEN $4 THEN $5 ELSE theme END,
         start_section = CASE WHEN $6 THEN $7 ELSE start_section END,
         orders_rows = CASE WHEN $8 THEN $9 ELSE orders_rows END
       WHERE id = $1`,
      [
        u.id,
        b.phone !== undefined, b.phone ?? null,
        b.theme !== undefined, b.theme ?? null,
        b.startSection !== undefined, b.startSection ?? null,
        b.ordersRows !== undefined, b.ordersRows ?? null,
      ],
    );
    const line = b.phone !== undefined ? diffLine('телефон', u.phone, b.phone) : null;
    if (line) await writeLog(c, { userId: u.id, folder: 'other', text: `Користувач «${u.name}»: ${line}` });
    return (await getUser(c, u.id))!;
  });
  res.json(sessionPayload(user));
});

/** Зміна власного пароля: поточний + новий. Інші сесії користувача завершуються. */
profileRouter.post('/profile/password', async (req, res) => {
  const b = passwordSchema.parse(req.body);
  const u = me(req);
  const r = await pool.query<{ hash: string }>('SELECT password_hash AS hash FROM users WHERE id = $1', [u.id]);
  if (!(await verifyPassword(r.rows[0]!.hash, b.current))) throw new HttpError(400, MSG.pwWrongCurrent, 'current');
  if (b.next === b.current) throw badRequest(MSG.pwSame, 'next');
  const hash = await hashPassword(b.next);
  await tx(async (c) => {
    await c.query('UPDATE users SET password_hash = $2 WHERE id = $1', [u.id, hash]);
    await destroyUserSessions(c, u.id, req.sessionToken);
    await writeLog(c, { userId: u.id, folder: 'other', text: `Користувач «${u.name}»: пароль змінено` });
  });
  res.json({ ok: true });
});

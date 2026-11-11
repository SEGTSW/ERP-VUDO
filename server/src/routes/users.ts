import { Router } from 'express';
import { z } from 'zod';
import type pg from 'pg';
import { LOGIN_RE, MSG, PASSWORD_MIN, ROLES, normalizeLogin, type Role } from '@vudo/shared';
import { pool, tx } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { hashPassword } from '../auth/password.js';
import { destroyUserSessions } from '../auth/sessions.js';
import { me, requireOffice } from '../auth/middleware.js';
import { diffLine, writeLog } from '../audit.js';
import { USER_COLS, activeAdminCount, getUser, type User } from '../users.js';

const name = z.string().trim().min(1, MSG.nameRequired).max(120);
const login = z
  .string()
  .transform(normalizeLogin)
  .refine((v) => LOGIN_RE.test(v), MSG.loginRule);
const phone = z.string().trim().max(40).transform((v) => v || null);
const roles = z
  .array(z.enum(ROLES))
  .min(1, MSG.rolesRequired)
  .transform((r) => ROLES.filter((x) => r.includes(x)));
const password = z.string().min(PASSWORD_MIN, MSG.passwordRule).max(200);

const createSchema = z.object({ name, login, phone: phone.optional(), password, roles });
const updateSchema = z.object({
  name: name.optional(),
  login: login.optional(),
  phone: phone.optional(),
  password: z.union([z.literal(''), password]).optional(),
  roles: roles.optional(),
  disabled: z.boolean().optional(),
});

const isUniqueViolation = (e: unknown) => (e as { code?: string }).code === '23505';

/** Серіалізує зміни, що впливають на кількість активних адмінів. */
const lockAdmins = (c: pg.PoolClient) =>
  c.query(`SELECT id FROM users WHERE 'Адмін' = ANY(roles) AND NOT disabled FOR UPDATE`);

export const usersRouter = Router();

/** Список людей для вибору (менеджер, замірник, відповідальний…) — усім авторизованим. */
usersRouter.get('/people', async (_req, res) => {
  const r = await pool.query(`SELECT id, name, roles, phone, disabled FROM users ORDER BY name`);
  res.json(r.rows);
});

/** Користувачі (Налаштування → Користувачі) — Адмін і Менеджер. */
usersRouter.get('/users', requireOffice, async (_req, res) => {
  const r = await pool.query<User>(`SELECT ${USER_COLS} FROM users u ORDER BY u.id`);
  res.json(r.rows);
});

usersRouter.post('/users', requireOffice, async (req, res) => {
  const b = createSchema.parse(req.body);
  const author = me(req);
  const hash = await hashPassword(b.password);
  try {
    const created = await tx(async (c) => {
      const r = await c.query<{ id: number }>(
        `INSERT INTO users (name, login, phone, password_hash, roles, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [b.name, b.login, b.phone ?? null, hash, b.roles, author.id],
      );
      const id = r.rows[0]!.id;
      await writeLog(c, { userId: author.id, folder: 'other', text: `Новий користувач «${b.name}», ролі: ${b.roles.join(', ')}` });
      // Новий працівник не отримує всю попередню історію як «нові» повідомлення.
      await c.query(
        `INSERT INTO log_reads (user_id, folder, last_id) SELECT $1, '*', COALESCE(max(id), 0) FROM audit_log`,
        [id],
      );
      return (await getUser(c, id))!;
    });
    res.status(201).json(created);
  } catch (e) {
    if (isUniqueViolation(e)) throw badRequest(MSG.loginTaken, 'login');
    throw e;
  }
});

usersRouter.patch('/users/:id', requireOffice, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) throw notFound();
  const b = updateSchema.parse(req.body);
  const author = me(req);
  const hash = b.password ? await hashPassword(b.password) : null;

  try {
    const updated = await tx(async (c) => {
      await lockAdmins(c);
      const u = await getUser(c, id);
      if (!u) throw notFound('Користувача не знайдено.');

      const next = {
        name: b.name ?? u.name,
        login: b.login ?? u.login,
        phone: b.phone !== undefined ? b.phone : u.phone,
        roles: (b.roles ?? u.roles) as Role[],
        disabled: b.disabled ?? u.disabled,
      };

      if (next.disabled && !u.disabled && u.id === author.id) throw badRequest(MSG.selfOff);
      const wasActiveAdmin = !u.disabled && u.roles.includes('Адмін');
      const staysActiveAdmin = !next.disabled && next.roles.includes('Адмін');
      if (wasActiveAdmin && !staysActiveAdmin && (await activeAdminCount(c, u.id)) === 0) {
        throw badRequest(next.disabled ? MSG.lastAdminOff : MSG.lastAdminRole);
      }

      await c.query(
        `UPDATE users SET name = $2, login = $3, phone = $4, roles = $5, disabled = $6,
                password_hash = COALESCE($7, password_hash)
          WHERE id = $1`,
        [id, next.name, next.login, next.phone, next.roles, next.disabled, hash],
      );

      const changes = [
        diffLine("ім'я", u.name, next.name),
        diffLine('логін', u.login, next.login),
        diffLine('телефон', u.phone, next.phone),
        diffLine('ролі', u.roles.join(', '), next.roles.join(', ')),
        hash ? 'пароль змінено' : null,
      ].filter(Boolean);
      if (changes.length) {
        await writeLog(c, { userId: author.id, folder: 'other', text: `Користувач «${next.name}»: ${changes.join('; ')}` });
      }
      if (next.disabled !== u.disabled) {
        await writeLog(c, {
          userId: author.id,
          folder: 'other',
          text: `Користувач «${next.name}»: ${next.disabled ? 'доступ вимкнено' : 'доступ увімкнено'}`,
        });
      }
      // Вимкнений користувач виходить з усіх пристроїв; після зміни пароля — теж (крім себе).
      if (next.disabled) await destroyUserSessions(c, id);
      else if (hash) await destroyUserSessions(c, id, id === author.id ? req.sessionToken : undefined);

      return (await getUser(c, id))!;
    });
    res.json(updated);
  } catch (e) {
    if (isUniqueViolation(e)) throw badRequest(MSG.loginTaken, 'login');
    throw e;
  }
});

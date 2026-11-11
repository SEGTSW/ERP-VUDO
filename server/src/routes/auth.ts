import { Router, type Request } from 'express';
import { z } from 'zod';
import { MSG, moneyAccess, navFor, normalizeLogin, startSection } from '@vudo/shared';
import { pool } from '../db.js';
import { HttpError } from '../errors.js';
import { burnVerify, verifyPassword } from '../auth/password.js';
import { loginBlocked, loginFailed, loginSucceeded } from '../auth/rateLimit.js';
import {
  COOKIE,
  clearSessionCookie,
  createSession,
  destroySession,
  setSessionCookie,
} from '../auth/sessions.js';
import { me, requireAuth } from '../auth/middleware.js';
import { USER_COLS, type User } from '../users.js';

/** Дані сесії для інтерфейсу: користувач, меню і стартовий розділ. */
export function sessionPayload(u: User) {
  return {
    user: u,
    nav: navFor(u),
    start: startSection(u),
    money: moneyAccess(u),
  };
}

const loginSchema = z.object({
  login: z.string().max(100),
  password: z.string().max(200),
});

export const authRouter = Router();

authRouter.post('/login', async (req: Request, res) => {
  const body = loginSchema.parse(req.body);
  const login = normalizeLogin(body.login);
  const ip = req.ip ?? '';
  if (loginBlocked(ip, login)) {
    throw new HttpError(429, 'Забагато невдалих спроб. Спробуйте через 15 хвилин.');
  }
  const r = await pool.query<User & { hash: string }>(
    `SELECT ${USER_COLS}, u.password_hash AS hash FROM users u WHERE u.login = $1`,
    [login],
  );
  const row = r.rows[0];
  if (!row) {
    await burnVerify(body.password);
    loginFailed(ip, login);
    throw new HttpError(401, MSG.badCredentials);
  }
  if (!(await verifyPassword(row.hash, body.password))) {
    loginFailed(ip, login);
    throw new HttpError(401, MSG.badCredentials);
  }
  if (row.disabled) throw new HttpError(403, MSG.disabled);

  loginSucceeded(ip, login);
  const { hash: _h, ...user } = row;
  const token = await createSession(pool, user.id, { ip, ua: req.get('user-agent') });
  setSessionCookie(res, token);
  res.json(sessionPayload(user));
});

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[COOKIE] as string | undefined;
  if (token) await destroySession(pool, token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json(sessionPayload(me(req)));
});

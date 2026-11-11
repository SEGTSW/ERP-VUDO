import { createHash, randomBytes } from 'node:crypto';
import type { Response, CookieOptions } from 'express';
import { config } from '../config.js';
import type { Db } from '../db.js';
import { USER_COLS, type User } from '../users.js';

export const COOKIE = 'vudo_sid';
const DAY = 86_400_000;

const sha256 = (s: string) => createHash('sha256').update(s).digest();

const cookieOpts = (): CookieOptions => ({
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: 'lax',
  path: '/',
});

export async function createSession(db: Db, userId: number, meta: { ip?: string; ua?: string }): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent)
     VALUES ($1, $2, now() + make_interval(days => $3), $4, $5)`,
    [sha256(token), userId, config.sessionDays, meta.ip ?? null, meta.ua?.slice(0, 300) ?? null],
  );
  return token;
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, { ...cookieOpts(), maxAge: config.sessionDays * DAY });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE, cookieOpts());
}

/**
 * Знаходить живу сесію й користувача. Вимкнений користувач — сесія видаляється.
 * Термін дії продовжується не частіше разу на годину (менше записів у БД).
 */
export async function resolveSession(db: Db, token: string): Promise<User | null> {
  const h = sha256(token);
  const r = await db.query<User & { refresh: boolean }>(
    `SELECT ${USER_COLS}, s.last_seen_at < now() - interval '1 hour' AS refresh
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [h],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.disabled) {
    await db.query('DELETE FROM sessions WHERE user_id = $1', [row.id]);
    return null;
  }
  if (row.refresh) {
    await db.query(
      `UPDATE sessions SET last_seen_at = now(), expires_at = now() + make_interval(days => $2) WHERE token_hash = $1`,
      [h, config.sessionDays],
    );
  }
  const { refresh: _r, ...user } = row;
  return user;
}

export async function destroySession(db: Db, token: string) {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}

export async function destroyUserSessions(db: Db, userId: number, exceptToken?: string) {
  if (exceptToken) {
    await db.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [userId, sha256(exceptToken)]);
  } else {
    await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }
}

export async function purgeExpiredSessions(db: Db) {
  await db.query('DELETE FROM sessions WHERE expires_at <= now()');
}

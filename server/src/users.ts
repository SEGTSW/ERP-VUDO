import type { Role } from '@vudo/shared';
import type { Db } from './db.js';

/** Користувач у пам'яті сервера (без хеша пароля). */
export interface User {
  id: number;
  name: string;
  login: string;
  roles: Role[];
  phone: string | null;
  disabled: boolean;
  theme: 'light' | 'dark' | null;
  startSection: string | null;
  ordersRows: number | null;
}

export const USER_COLS = `u.id, u.name, u.login, u.roles, u.phone, u.disabled, u.theme,
  u.start_section AS "startSection", u.orders_rows AS "ordersRows"`;

export async function getUser(db: Db, id: number): Promise<User | null> {
  const r = await db.query<User>(`SELECT ${USER_COLS} FROM users u WHERE u.id = $1`, [id]);
  return r.rows[0] ?? null;
}

/** Кількість активних адмінів (без урахування excludeId). */
export async function activeAdminCount(db: Db, excludeId?: number): Promise<number> {
  const r = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM users WHERE NOT disabled AND 'Адмін' = ANY(roles) AND ($1::bigint IS NULL OR id <> $1)`,
    [excludeId ?? null],
  );
  return r.rows[0]!.n;
}

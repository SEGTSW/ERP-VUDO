/** Перевірка людей, вибраних у замовленні: лише зі списку користувачів з потрібною роллю, активні (крім уже вибраних). */
import type { Role } from '@vudo/shared';
import type { Db } from '../db.js';
import { badRequest } from '../errors.js';

export async function checkPerson(
  db: Db,
  id: number,
  roles: Role[],
  label: string,
  keep: (number | null | undefined)[] = [],
): Promise<string> {
  const r = await db.query<{ name: string; roles: Role[]; disabled: boolean }>('SELECT name, roles, disabled FROM users WHERE id = $1', [id]);
  const u = r.rows[0];
  if (!u || !u.roles.some((x) => roles.includes(x))) throw badRequest(`${label}: виберіть зі списку працівників з роллю «${roles.join('» або «')}».`);
  if (u.disabled && !keep.includes(id)) throw badRequest(`${label}: у користувача «${u.name}» вимкнено доступ.`);
  return u.name;
}

export async function namesOf(db: Db, ids: (number | null | undefined)[]): Promise<Map<number, string>> {
  const clean = ids.filter((x): x is number => x != null);
  if (!clean.length) return new Map();
  const r = await db.query<{ id: number; name: string }>('SELECT id, name FROM users WHERE id = ANY($1)', [clean]);
  return new Map(r.rows.map((u) => [u.id, u.name]));
}

/** Клієнти й дизайнери-партнери (ТЗ розділ 9): перевірки, створення, відображення. */
import { CLIENT_TYPES, SOURCES, phoneDigitsCount, phoneKey } from '@vudo/shared';
import { z } from 'zod';
import type { Db } from './db.js';
import { badRequest } from './errors.js';
import { writeLog } from './audit.js';

export const DESIGNER = 'дизайнер-партнер';

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

/** Поля без значень за замовчуванням — для часткового оновлення (PATCH). */
export const clientFields = z.object({
  name: z.string().trim().max(200),
  phone: optText(40),
  type: z.enum(CLIENT_TYPES),
  source: z.enum(SOURCES).nullish().transform((v) => v ?? null),
  email: optText(200),
  messenger: optText(200),
  company: optText(200),
  bonusPct: z.number().min(0).max(100).nullish().transform((v) => v ?? null),
  addresses: z
    .array(z.string().trim().max(300))
    .max(50)
    .transform((a) => [...new Set(a.filter(Boolean))]),
  comment: optText(5000),
});

export const clientSchema = clientFields.extend({
  type: clientFields.shape.type.default('фізособа'),
  addresses: clientFields.shape.addresses.default([]),
});
export type ClientInput = z.infer<typeof clientSchema>;

/** «Ім'я · Компанія»; без компанії — лише ім'я. */
export const designerLabel = (c: { name: string; company: string | null }) => (c.company ? `${c.name} · ${c.company}` : c.name);

/** Перевірка полів і унікальності телефону (за останніми 10 цифрами; клієнти й дизайнери разом). */
export async function validateClient(db: Db, v: ClientInput, selfId?: number): Promise<void> {
  const designer = v.type === DESIGNER;
  if (!v.name) throw badRequest(designer ? "Вкажіть ім'я дизайнера." : 'Вкажіть ПІБ або назву клієнта.', 'name');
  if (!designer && phoneDigitsCount(v.phone) < 9) throw badRequest('Вкажіть телефон (щонайменше 9 цифр).', 'phone');
  if (designer && v.phone && phoneDigitsCount(v.phone) < 9) throw badRequest('Телефон: щонайменше 9 цифр.', 'phone');
  if (v.phone) {
    const dup = await findByPhone(db, v.phone, selfId);
    if (dup) throw badRequest(`${designer ? 'Контакт' : 'Клієнт'} із цим телефоном уже є: ${dup.name}.`, 'phone');
  }
}

export async function findByPhone(db: Db, phone: string, exceptId?: number) {
  const key = phoneKey(phone);
  if (!key) return null;
  const r = await db.query<{ id: number; name: string; type: string; source: string | null; archived: boolean; addresses: string[] }>(
    `SELECT id, name, type, source, archived, addresses FROM clients WHERE phone_key(phone) = $1 AND ($2::bigint IS NULL OR id <> $2)`,
    [key, exceptId ?? null],
  );
  return r.rows[0] ?? null;
}

/** Створює клієнта (або дизайнера) і пише запис у журнал. Викликати в транзакції після validateClient. */
export async function insertClient(db: Db, v: ClientInput, userId: number): Promise<number> {
  const designer = v.type === DESIGNER;
  const r = await db.query<{ id: number }>(
    `INSERT INTO clients (name, phone, type, source, email, messenger, company, bonus_pct, addresses, comment, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      v.name,
      v.phone,
      v.type,
      v.source,
      v.email,
      v.messenger,
      designer ? v.company : null,
      designer ? v.bonusPct : null,
      v.addresses,
      v.comment,
      userId,
    ],
  );
  await writeLog(db, designer
    ? { userId, folder: 'other', text: `Новий дизайнер-партнер «${designerLabel(v)}»` }
    : { userId, folder: 'client', text: `Новий клієнт «${v.name}»` });
  return r.rows[0]!.id;
}

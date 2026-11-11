import { Router } from 'express';
import { z } from 'zod';
import { REFUSAL, afterContract, phoneKey } from '@vudo/shared';
import { pool, tx } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { me, requireOffice } from '../auth/middleware.js';
import { diffLine, writeLog } from '../audit.js';
import { getSettings } from '../settings.js';
import { CLIENT_COLS, compute, fetchOrders } from '../orders/repo.js';
import { officeList } from '../orders/serialize.js';
import { DESIGNER, clientFields, clientSchema, designerLabel, insertClient, validateClient } from '../clients.js';
import type { ClientRef } from '../orders/repo.js';

export const clientsRouter = Router();
clientsRouter.use('/clients', requireOffice);

const idParam = (v: unknown) => {
  const id = Number(v);
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound();
  return id;
};

const listSchema = z.object({
  q: z.string().max(100).default(''),
  archived: z.enum(['0', '1']).default('0'),
  kind: z.enum(['clients', 'designers']).default('clients'),
});

/** Таблиця клієнтів / дизайнерів-партнерів з кількістю замовлень, сумою покупок і боргом. */
clientsRouter.get('/clients', async (req, res) => {
  const q = listSchema.parse(req.query);
  const text = q.q.trim().toLowerCase();
  const digits = text.replace(/\D/g, '');
  const r = await pool.query<ClientRef & { createdAt: string }>(
    `SELECT ${CLIENT_COLS('c')}, c.created_at AS "createdAt" FROM clients c
      WHERE c.archived = $1 AND ($2 = 'clients' OR c.type = $3)
        AND ($4 = '' OR lower(c.name) LIKE '%' || $4 || '%' OR lower(coalesce(c.company, '')) LIKE '%' || $4 || '%'
             OR (length($5) >= 3 AND regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g') LIKE '%' || $5 || '%'))
      ORDER BY c.name`,
    [q.archived === '1', q.kind, DESIGNER, text, digits],
  );
  const ids = r.rows.map((c) => c.id);
  const settings = await getSettings(pool);
  const orders = ids.length ? await fetchOrders(pool, 'o.client_id = ANY($1) OR o.designer_id = ANY($1)', [ids]) : [];
  const out = r.rows.map((c) => {
    if (q.kind === 'designers') {
      const os = orders.filter((o) => o.designerId === c.id && o.status !== REFUSAL);
      return {
        ...c,
        effectiveBonusPct: c.bonusPct ?? settings.designerPct,
        ordersCount: os.length,
        activeCount: os.filter((o) => !o.archived && o.status !== 'Закрито').length,
      };
    }
    const os = orders.filter((o) => o.clientId === c.id);
    const bought = os.filter((o) => o.status !== REFUSAL && afterContract(o.status));
    let sum = 0;
    let debt = 0;
    for (const o of bought) {
      const k = compute(o, settings).calc;
      sum += k.price;
      debt += Math.max(0, k.debt);
    }
    return { ...c, ordersCount: os.length, purchases: sum, debt };
  });
  res.json(out);
});

/** Картка клієнта / дизайнера з його замовленнями. */
clientsRouter.get('/clients/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const r = await pool.query<ClientRef>(`SELECT ${CLIENT_COLS('c')} FROM clients c WHERE c.id = $1`, [id]);
  const c = r.rows[0];
  if (!c) throw notFound('Клієнта не знайдено.');
  const settings = await getSettings(pool);
  const orders = await fetchOrders(pool, c.type === DESIGNER ? 'o.client_id = $1 OR o.designer_id = $1' : 'o.client_id = $1', [id]);
  res.json({ ...c, effectiveBonusPct: c.bonusPct ?? settings.designerPct, orders: await officeList(pool, orders, settings) });
});

clientsRouter.post('/clients', async (req, res) => {
  const v = clientSchema.parse(req.body);
  const u = me(req);
  const id = await tx(async (c) => {
    await validateClient(c, v);
    return insertClient(c, v, u.id);
  }).catch(uniquePhone);
  res.status(201).json({ id });
});

const patchSchema = clientFields.partial().extend({ archived: z.boolean().optional() });

clientsRouter.patch('/clients/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const b = patchSchema.parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    const r = await c.query<ClientRef>(`SELECT ${CLIENT_COLS('c')} FROM clients c WHERE c.id = $1 FOR UPDATE`, [id]);
    const cur = r.rows[0];
    if (!cur) throw notFound('Клієнта не знайдено.');
    const next = {
      name: b.name ?? cur.name,
      phone: b.phone !== undefined ? b.phone : cur.phone,
      type: b.type ?? (cur.type as (typeof b)['type'] & string),
      source: b.source !== undefined ? b.source : (cur.source as never),
      email: b.email !== undefined ? b.email : cur.email,
      messenger: b.messenger !== undefined ? b.messenger : cur.messenger,
      company: b.company !== undefined ? b.company : cur.company,
      bonusPct: b.bonusPct !== undefined ? b.bonusPct : cur.bonusPct,
      addresses: b.addresses ?? cur.addresses,
      comment: b.comment !== undefined ? b.comment : cur.comment,
    };
    if (next.type !== DESIGNER) {
      next.company = null;
      next.bonusPct = null;
    }
    // Тип «дизайнер-партнер» не можна зняти, поки він прив'язаний до замовлень як дизайнер.
    if (cur.type === DESIGNER && next.type !== DESIGNER) {
      const used = await c.query('SELECT 1 FROM orders WHERE designer_id = $1 LIMIT 1', [id]);
      if (used.rowCount) throw badRequest('Цей дизайнер уже вказаний у замовленнях — тип змінити не можна.', 'type');
    }
    if (b.archived === undefined || Object.keys(b).length > 1) await validateClient(c, next, id);
    const archived = b.archived ?? cur.archived;

    await c.query(
      `UPDATE clients SET name = $2, phone = $3, type = $4, source = $5, email = $6, messenger = $7, company = $8,
              bonus_pct = $9, addresses = $10, comment = $11, archived = $12 WHERE id = $1`,
      [id, next.name, next.phone, next.type, next.source, next.email, next.messenger, next.company, next.bonusPct, next.addresses, next.comment, archived],
    );

    const designer = next.type === DESIGNER;
    const label = designer ? designerLabel(next) : next.name;
    const ch = [
      diffLine(designer ? "Ім'я" : 'ПІБ', cur.name, next.name),
      diffLine('Телефон', cur.phone, next.phone),
      diffLine('Тип', cur.type, next.type),
      diffLine('Джерело', cur.source, next.source),
      diffLine('Email', cur.email, next.email),
      diffLine('Месенджер', cur.messenger, next.messenger),
      diffLine('Компанія', cur.company, next.company),
      diffLine('Адреси', cur.addresses.join('; '), next.addresses.join('; ')),
      diffLine('Коментар', cur.comment, next.comment),
    ].filter(Boolean);
    if (ch.length) {
      await writeLog(c, designer || cur.type === DESIGNER
        ? { userId: u.id, folder: 'other', text: `Оновлено дизайнера-партнера «${label}»: ${ch.join('; ')}` }
        : { userId: u.id, folder: 'client', text: `Оновлено клієнта «${label}»: ${ch.join('; ')}` });
    }
    if ((cur.bonusPct ?? null) !== (next.bonusPct ?? null)) {
      const p = (x: number | null) => (x == null ? 'заг.' : `${x}%`);
      await writeLog(c, { userId: u.id, folder: 'fin', finScope: 'pay', text: `Бонус дизайнера «${label}»: ${p(cur.bonusPct)} → ${p(next.bonusPct)}` });
    }
    if (archived !== cur.archived) {
      const what = designer ? `Дизайнер-партнер «${label}»` : `Клієнт «${label}»`;
      await writeLog(c, { userId: u.id, folder: designer ? 'other' : 'client', text: `${what} ${archived ? 'в архіві' : 'повернуто з архіву'}` });
    }
  }).catch(uniquePhone);
  res.json({ ok: true });
});

/** Паралельне створення з тим самим телефоном — ловить унікальний індекс БД. */
function uniquePhone(e: unknown): never {
  if ((e as { code?: string; constraint?: string }).constraint === 'clients_phone_uniq') {
    throw badRequest('Клієнт із цим телефоном уже є.', 'phone');
  }
  throw e;
}

/** Перевірка телефону під час введення у «Нове звернення»: чи є вже такий клієнт. */
clientsRouter.get('/clients-by-phone', requireOffice, async (req, res) => {
  const phone = z.string().max(40).parse(req.query.phone ?? '');
  if (phoneKey(phone).length < 9) return void res.json(null);
  const r = await pool.query<ClientRef>(`SELECT ${CLIENT_COLS('c')} FROM clients c WHERE phone_key(c.phone) = $1`, [phoneKey(phone)]);
  res.json(r.rows[0] ?? null);
});

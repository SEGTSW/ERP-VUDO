import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  ALL_STATUSES,
  COMPONENTS,
  ITEM_TYPES,
  PAYMENT_METHODS,
  PAYMENT_TYPES,
  SOURCES,
  afterContract,
  fmtDate,
  isOffice,
  kyivToday,
  money,
  phoneDigitsCount,
  type Components,
  type Settings,
} from '@vudo/shared';
import type pg from 'pg';
import { pool, tx } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { me, requireOffice } from '../auth/middleware.js';
import { diffLine, writeLog } from '../audit.js';
import { getSettings } from '../settings.js';
import { DESIGNER, clientSchema, designerLabel, findByPhone, insertClient, validateClient } from '../clients.js';
import { compute, fetchOrder, fetchOrders, type OrderAgg } from '../orders/repo.js';
import { execCard, execList, officeCard, officeList } from '../orders/serialize.js';
import { moveStatus } from '../orders/status.js';
import { applyPeople, makePlan, syncMeasureTasks } from '../orders/plan.js';
import { checkPerson, namesOf } from '../orders/people.js';

export const ordersRouter = Router();

const idOf = (v: unknown) => {
  const id = Number(v);
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound();
  return id;
};

/** Замовлення, заблоковане для зміни в транзакції. */
async function lockOrder(c: pg.PoolClient, id: number): Promise<OrderAgg> {
  const o = await fetchOrder(c, id, true);
  if (!o) throw notFound('Замовлення не знайдено.');
  return o;
}

/** Повна картка для поточної ролі. */
async function card(req: Request, id: number) {
  const u = me(req);
  const o = await fetchOrder(pool, id);
  if (!o) throw notFound('Замовлення не знайдено.');
  return isOffice(u) ? officeCard(pool, o, await getSettings(pool), u) : execCard(pool, o, u);
}

/** Запис «Ціна змінена після договору». */
async function logPriceAfterContract(c: pg.PoolClient, o: OrderAgg, s: Settings, before: number, userId: number) {
  if (!o.contractDate) return;
  const after = compute((await fetchOrder(c, o.id))!, s).calc.price;
  if (after !== before) {
    await writeLog(c, { userId, orderId: o.id, folder: 'fin', finScope: 'pay', text: `Ціна змінена після договору: ${money(before)} → ${money(after)}` });
  }
}

/* ---------- Список ---------- */

const listSchema = z.object({
  q: z.string().max(100).default(''),
  status: z.string().max(60).default(''),
  manager: z.coerce.number().int().optional(),
  late: z.enum(['0', '1']).default('0'),
  archived: z.enum(['0', '1']).default('0'),
  mine: z.enum(['0', '1']).default('0'),
});

/**
 * Офіс: усі замовлення з фільтрами (статус, менеджер, прострочені, архів, пошук).
 * Виконавці: активні замовлення (не архів, не Відмова, не Закрито), без сум.
 */
ordersRouter.get('/orders', async (req, res) => {
  const q = listSchema.parse(req.query);
  const u = me(req);
  const text = q.q.trim().toLowerCase();
  const digits = text.replace(/\D/g, '');
  const params: unknown[] = [text, digits];
  const search = `($1 = '' OR lower(o.num) LIKE '%' || $1 || '%' OR o.client_id IN (
      SELECT id FROM clients WHERE lower(name) LIKE '%' || $1 || '%'
        OR (length($2) >= 3 AND regexp_replace(coalesce(phone, ''), '\\D', '', 'g') LIKE '%' || $2 || '%'))
      ${isOffice(u) ? '' : `OR lower(coalesce(o.address, '')) LIKE '%' || $1 || '%'`})`;

  if (!isOffice(u)) {
    let where = `NOT o.archived AND o.status NOT IN ('Відмова', 'Закрито') AND ${search}`;
    if (q.mine === '1') {
      params.push(u.id);
      where += ` AND EXISTS (SELECT 1 FROM plan_tasks t WHERE t.order_id = o.id AND t.assignee_id = $${params.length})`;
    }
    res.json(execList(await fetchOrders(pool, where, params), u));
    return;
  }

  let where = `o.archived = ${q.archived === '1'} AND ${search}`;
  if (q.status && (ALL_STATUSES as readonly string[]).includes(q.status)) {
    params.push(q.status);
    where += ` AND o.status = $${params.length}`;
  }
  if (q.manager) {
    params.push(q.manager);
    where += ` AND o.manager_id = $${params.length}`;
  }
  const settings = await getSettings(pool);
  let list = await officeList(pool, await fetchOrders(pool, where, params), settings);
  if (q.late === '1') list = list.filter((o) => o.late > 0);
  // новіші вгорі
  list.sort((a, b) => b.num.localeCompare(a.num));
  res.json(list);
});

/** Кількість прострочених (кнопка «Прострочених: N»). */
ordersRouter.get('/orders-late-count', requireOffice, async (_req, res) => {
  const settings = await getSettings(pool);
  const list = await officeList(pool, await fetchOrders(pool, 'NOT o.archived'), settings);
  res.json({ count: list.filter((o) => o.late > 0).length });
});

/* ---------- Нове звернення (5.2) ---------- */

const newOrderSchema = z.object({
  clientId: z.number().int().positive().optional(),
  phone: z.string().max(40).optional(),
  name: z.string().trim().max(200).optional(),
  type: z.enum(['фізособа', 'юрособа', DESIGNER]).optional(),
  source: z.enum(SOURCES),
  designerId: z.number().int().positive().nullish(),
  newDesigner: z
    .object({ name: z.string().trim().max(200), company: z.string().trim().max(200).optional(), phone: z.string().trim().max(40).optional() })
    .nullish(),
  managerId: z.number().int().positive(),
  comment: z.string().trim().max(5000).optional(),
});

ordersRouter.post('/orders', requireOffice, async (req, res) => {
  const b = newOrderSchema.parse(req.body);
  const u = me(req);
  const id = await tx(async (c) => {
    await checkPerson(c, b.managerId, ['Менеджер', 'Адмін'], 'Менеджер');

    // Клієнт: вибраний, знайдений за телефоном або новий.
    let clientId = b.clientId;
    if (!clientId) {
      if (phoneDigitsCount(b.phone) < 9) throw badRequest('Вкажіть телефон клієнта (щонайменше 9 цифр).', 'phone');
      const dup = await findByPhone(c, b.phone!);
      if (dup) clientId = dup.id;
      else {
        const v = clientSchema.parse({ name: b.name ?? '', phone: b.phone, type: b.type ?? 'фізособа', source: b.source });
        if (!v.name) throw badRequest('Вкажіть ПІБ клієнта.', 'name');
        await validateClient(c, v);
        clientId = await insertClient(c, v, u.id);
      }
    }
    const cl = await c.query<{ id: number; type: string; source: string | null; addresses: string[]; archived: boolean; name: string }>(
      'SELECT id, type, source, addresses, archived, name FROM clients WHERE id = $1',
      [clientId],
    );
    const client = cl.rows[0];
    if (!client) throw badRequest('Клієнта не знайдено.');

    // Дизайнер-партнер: вибраний, новий (створюється разом зі зверненням) або сам клієнт-дизайнер.
    let designerId: number | null = null;
    let designerName = '';
    if (b.source === 'дизайнер') {
      if (b.newDesigner) {
        const v = clientSchema.parse({ ...b.newDesigner, type: DESIGNER, source: 'дизайнер' });
        await validateClient(c, v);
        designerId = await insertClient(c, v, u.id);
        designerName = designerLabel(v);
      } else if (b.designerId) {
        const d = await c.query<{ name: string; company: string | null }>(
          `SELECT name, company FROM clients WHERE id = $1 AND type = $2 AND NOT archived`,
          [b.designerId, DESIGNER],
        );
        if (!d.rows[0]) throw badRequest('Дизайнера-партнера не знайдено або він в архіві.', 'designerId');
        designerId = b.designerId;
        designerName = designerLabel(d.rows[0]);
      } else if (client.type === DESIGNER) {
        designerId = client.id;
        designerName = client.name;
      }
    }

    const num = await c.query<{ num: string }>(
      `SELECT to_char(now() AT TIME ZONE 'Europe/Kyiv', 'YYYY') || '-' || lpad(nextval('order_num_seq')::text, 4, '0') AS num`,
    );
    const r = await c.query<{ id: number; num: string }>(
      `INSERT INTO orders (num, client_id, address, manager_id, source, designer_id, comment, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, num`,
      [num.rows[0]!.num, clientId, client.addresses[0] ?? null, b.managerId, b.source ?? client.source, designerId, b.comment || null, u.id],
    );
    const o = r.rows[0]!;
    await writeLog(c, {
      userId: u.id,
      orderId: o.id,
      folder: 'order',
      text: `Створено звернення №${o.num}${designerName ? ` · дизайнер «${designerName}»` : ''}`,
    });
    return o.id;
  });
  res.status(201).json(await card(req, id));
});

/* ---------- Картка ---------- */

ordersRouter.get('/orders/:id', async (req, res) => {
  res.json(await card(req, idOf(req.params.id)));
});

/* ---------- Вкладка «Загальне» (5.3) ---------- */

const dateOrNull = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Неправильна дата.')
  .nullable()
  .or(z.literal('').transform(() => null));

const mainSchema = z.object({
  clientId: z.number().int().positive(),
  address: z.string().trim().max(300).transform((v) => v || null),
  source: z.enum(SOURCES).nullable(),
  designerId: z.number().int().positive().nullable(),
  managerId: z.number().int().positive(),
  measurerId: z.number().int().positive().nullable(),
  constructorId: z.number().int().positive().nullable(),
  installerIds: z.array(z.number().int().positive()).max(20),
  measureDate: dateOrNull,
  installDate: dateOrNull,
  readyDate: dateOrNull,
  delivery: z.number().min(0).max(100_000_000),
  discount: z.number().min(0).max(100_000_000),
  discountType: z.enum(['грн', '%']),
  comment: z.string().trim().max(5000).transform((v) => v || null),
});

ordersRouter.patch('/orders/:id', requireOffice, async (req, res) => {
  const id = idOf(req.params.id);
  const b = mainSchema.parse(req.body);
  const u = me(req);
  if (b.discountType === '%' && b.discount > 100) throw badRequest('Знижка у відсотках — не більше 100.', 'discount');
  await tx(async (c) => {
    const o = await lockOrder(c, id);
    const s = await getSettings(c);
    const before = compute(o, s).calc.price;

    // Люди — лише зі списків з потрібною роллю; вимкнені — лише якщо вже були вибрані.
    await checkPerson(c, b.managerId, ['Менеджер', 'Адмін'], 'Менеджер', [o.managerId]);
    if (b.measurerId) await checkPerson(c, b.measurerId, ['Замірник'], 'Замірник', [o.measurerId]);
    if (b.constructorId) await checkPerson(c, b.constructorId, ['Конструктор'], 'Конструктор', [o.constructorId]);
    const installers = [...new Set(b.installerIds)];
    for (const x of installers) await checkPerson(c, x, ['Монтажник'], 'Монтажники', o.installerIds);

    if (b.clientId !== o.clientId) {
      const cl = await c.query('SELECT 1 FROM clients WHERE id = $1 AND (NOT archived OR id = $2)', [b.clientId, o.clientId]);
      if (!cl.rowCount) throw badRequest('Клієнта не знайдено або він в архіві.', 'clientId');
    }
    let designerId = b.source === 'дизайнер' ? b.designerId : null;
    if (designerId && designerId !== o.designerId) {
      const d = await c.query('SELECT 1 FROM clients WHERE id = $1 AND type = $2 AND NOT archived', [designerId, DESIGNER]);
      if (!d.rowCount) throw badRequest('Дизайнера-партнера не знайдено або він в архіві.', 'designerId');
    }
    if (b.source === 'дизайнер' && !designerId) {
      const cl = await c.query<{ type: string }>('SELECT type FROM clients WHERE id = $1', [b.clientId]);
      if (cl.rows[0]?.type === DESIGNER) designerId = b.clientId;
    }

    await c.query(
      `UPDATE orders SET client_id = $2, address = $3, source = $4, designer_id = $5, manager_id = $6, measurer_id = $7,
              constructor_id = $8, installer_ids = $9, measure_date = $10, install_date = $11, ready_date = $12,
              delivery = $13, discount = $14, discount_type = $15, comment = $16
        WHERE id = $1`,
      [id, b.clientId, b.address, b.source, designerId, b.managerId, b.measurerId, b.constructorId, installers,
        b.measureDate, b.installDate, b.readyDate, b.delivery, b.discount, b.discountType, b.comment],
    );

    // Журнал: «поле: було → стало». Гроші — окремим записом (папка «Фінанси»).
    const names = await namesOf(c, [o.managerId, b.managerId, o.measurerId, b.measurerId, o.constructorId, b.constructorId, ...o.installerIds, ...installers]);
    const nm = (x: number | null) => (x ? (names.get(x) ?? '—') : '—');
    const clientName = async (x: number | null) =>
      x ? ((await c.query<{ name: string; company: string | null }>('SELECT name, company FROM clients WHERE id = $1', [x])).rows[0] ?? null) : null;
    const [oc, nc, od, nd] = await Promise.all([clientName(o.clientId), clientName(b.clientId), clientName(o.designerId), clientName(designerId)]);
    const people = diffLine('Монтажники', o.installerIds.map(nm).join(', '), installers.map(nm).join(', '));
    const plain = [
      diffLine('Клієнт', oc?.name, nc?.name),
      diffLine('Адреса', o.address, b.address),
      diffLine('Джерело', o.source, b.source),
      diffLine('Дизайнер', od ? designerLabel(od) : null, nd ? designerLabel(nd) : null),
      diffLine('Менеджер', nm(o.managerId), nm(b.managerId)),
      diffLine('Замірник', nm(o.measurerId), nm(b.measurerId)),
      diffLine('Конструктор', nm(o.constructorId), nm(b.constructorId)),
      people,
      diffLine('Дата заміру', o.measureDate && fmtDate(o.measureDate), b.measureDate && fmtDate(b.measureDate)),
      diffLine('Монтаж — обіцяли клієнту', o.installDate && fmtDate(o.installDate), b.installDate && fmtDate(b.installDate)),
      diffLine('Готовність (план)', o.readyDate && fmtDate(o.readyDate), b.readyDate && fmtDate(b.readyDate)),
      diffLine('Коментар', o.comment, b.comment),
    ].filter((x): x is string => !!x);
    const moneyCh = [
      diffLine('Доставка', money(o.delivery), money(b.delivery)),
      diffLine('Знижка', `${o.discount} ${o.discountType}`, `${b.discount} ${b.discountType}`),
    ].filter(Boolean);

    if ((o.measureDate ?? null) !== b.measureDate) await syncMeasureTasks(c, id, b.measureDate);
    const updated = await applyPeople(c, {
      id,
      status: o.status,
      managerId: b.managerId,
      measurerId: b.measurerId,
      constructorId: b.constructorId,
      installerIds: installers,
    });
    if (updated) plain.push(`оновлено відповідальних у плані: ${updated}`);
    if (!plain.length && !moneyCh.length) throw badRequest('Змін немає.');
    if (plain.length) await writeLog(c, { userId: u.id, orderId: id, folder: 'order', text: `Змінено. ${plain.join('; ')}` });
    if (moneyCh.length) await writeLog(c, { userId: u.id, orderId: id, folder: 'fin', finScope: 'pay', text: `Змінено. ${moneyCh.join('; ')}` });
    await logPriceAfterContract(c, o, s, before, u.id);
  });
  res.json(await card(req, id));
});

ordersRouter.post('/orders/:id/archive', requireOffice, async (req, res) => {
  const id = idOf(req.params.id);
  const { archived } = z.object({ archived: z.boolean() }).parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    const o = await lockOrder(c, id);
    if (o.archived === archived) return;
    await c.query('UPDATE orders SET archived = $2 WHERE id = $1', [id, archived]);
    await writeLog(c, { userId: u.id, orderId: id, folder: 'order', text: archived ? 'Замовлення перенесено в архів' : 'Замовлення повернуто з архіву' });
  });
  res.json(await card(req, id));
});

/* ---------- Статус (розділ 4) ---------- */

const moveSchema = z.object({
  to: z.enum(ALL_STATUSES as [string, ...string[]]),
  mode: z.enum(['step', 'jump']),
  values: z
    .object({
      address: z.string().trim().max(300).optional(),
      measureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      measurerId: z.number().int().positive().optional(),
      installDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      installerIds: z.array(z.number().int().positive()).max(20).optional(),
      ok: z.boolean().optional(),
      refuseReason: z.string().trim().max(2000).optional(),
      claimText: z.string().trim().max(5000).optional(),
      claimFix: z.string().trim().max(5000).optional(),
    })
    .default({}),
});

ordersRouter.post('/orders/:id/status', requireOffice, async (req, res) => {
  const id = idOf(req.params.id);
  const b = moveSchema.parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    const o = await lockOrder(c, id);
    const s = await getSettings(c);
    await moveStatus(c, o, { to: b.to as OrderAgg['status'], mode: b.mode, values: b.values }, s, u.id, async (pid, role) => {
      await checkPerson(c, pid, [role], role === 'Замірник' ? 'Замірник' : 'Монтажники', role === 'Замірник' ? [o.measurerId] : o.installerIds);
    });
  });
  res.json(await card(req, id));
});

/* ---------- Вироби і прорахунок (розділ 6) ---------- */

const amount = z.number().min(0).max(100_000_000);
const componentsSchema = z
  .object(Object.fromEntries(COMPONENTS.map(([k]) => [k, amount.optional()])) as Record<(typeof COMPONENTS)[number][0], z.ZodOptional<typeof amount>>)
  .strict()
  .transform((c) => Object.fromEntries(Object.entries(c).filter(([, v]) => v != null && v > 0)) as Components);

const itemSchema = z.object({
  name: z.string().trim().min(1, 'Вкажіть назву виробу.').max(200),
  type: z.enum(ITEM_TYPES),
  description: z.string().trim().max(5000).transform((v) => v || null),
  pre: componentsSchema,
  designerPct: z.number().min(0).max(100).nullable(),
});

const itemOf = (o: OrderAgg, itemId: number) => {
  const i = o.items.find((x) => x.id === itemId);
  if (!i) throw notFound('Виріб не знайдено.');
  return i;
};

ordersRouter.post('/orders/:id/items', requireOffice, async (req, res) => {
  const id = idOf(req.params.id);
  const b = itemSchema.parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    const o = await lockOrder(c, id);
    const s = await getSettings(c);
    const before = compute(o, s).calc.price;
    const r = await c.query<{ id: number }>(
      `INSERT INTO items (order_id, name, type, description, pre, designer_pct, markup_pct, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [id, b.name, b.type, b.description, b.pre, b.designerPct, s.markupPct, u.id],
    );
    await makePlan(c, o, r.rows[0]!.id);
    const price = compute((await fetchOrder(c, id))!, s).items.get(r.rows[0]!.id)!.price;
    await writeLog(c, {
      userId: u.id,
      orderId: id,
      folder: 'fin',
      finScope: 'pay',
      text: `Додано виріб «${b.name}», ${money(price)}. Створено план: Прорахунок → Замір → Конструктив → Збірка → Монтаж`,
    });
    await logPriceAfterContract(c, o, s, before, u.id);
  });
  res.status(201).json(await card(req, id));
});

ordersRouter.patch('/orders/:id/items/:itemId', requireOffice, async (req, res) => {
  const id = idOf(req.params.id);
  const itemId = idOf(req.params.itemId);
  const b = itemSchema.parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    const o = await lockOrder(c, id);
    const i = itemOf(o, itemId);
    const s = await getSettings(c);
    const k0 = compute(o, s);
    const p0 = k0.items.get(itemId)!;
    // Збереження прорахунку фіксує поточну націнку з налаштувань.
    await c.query(
      `UPDATE items SET name = $2, type = $3, description = $4, pre = $5, designer_pct = $6, markup_pct = $7 WHERE id = $1`,
      [itemId, b.name, b.type, b.description, b.pre, b.designerPct, s.markupPct],
    );
    const p1 = compute((await fetchOrder(c, id))!, s).items.get(itemId)!;
    const ch = [
      diffLine('назва', i.name, b.name),
      diffLine('тип', i.type, b.type),
      diffLine('опис', i.description, b.description),
      p0.price !== p1.price ? `ціна ${money(p0.price)} → ${money(p1.price)}` : null,
      p0.cost !== p1.cost ? `собівартість ${money(p0.cost)} → ${money(p1.cost)}` : null,
    ].filter(Boolean);
    if (ch.length) {
      await writeLog(c, { userId: u.id, orderId: id, folder: 'fin', finScope: 'pay', text: `Змінено виріб «${b.name}»: ${ch.join(', ')}` });
    }
    await logPriceAfterContract(c, o, s, k0.calc.price, u.id);
  });
  res.json(await card(req, id));
});

/** Точний прорахунок: ті самі 6 сум; усі порожні — очищає. */
ordersRouter.put('/orders/:id/items/:itemId/exact', requireOffice, async (req, res) => {
  const id = idOf(req.params.id);
  const itemId = idOf(req.params.itemId);
  const { exact } = z.object({ exact: componentsSchema }).parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    const o = await lockOrder(c, id);
    const i = itemOf(o, itemId);
    const s = await getSettings(c);
    const k0 = compute(o, s);
    const p0 = k0.items.get(itemId)!.price;
    const empty = !Object.keys(exact).length;
    await c.query('UPDATE items SET exact = $2, markup_pct = $3 WHERE id = $1', [itemId, empty ? null : exact, s.markupPct]);
    const k1 = compute((await fetchOrder(c, id))!, s).items.get(itemId)!;
    await writeLog(c, {
      userId: u.id,
      orderId: id,
      folder: 'fin',
      finScope: 'pay',
      text: empty
        ? `Точний прорахунок «${i.name}» очищено`
        : `Точний прорахунок «${i.name}»: собівартість ${money(k1.cost)}, точна вартість ${money(k1.price)}${p0 !== k1.price ? ` (було ${money(p0)})` : ''}`,
    });
    await logPriceAfterContract(c, o, s, k0.calc.price, u.id);
  });
  res.json(await card(req, id));
});

/** Виріб видаляється лише до договору (з підтвердженням «Точно?» в інтерфейсі). */
ordersRouter.delete('/orders/:id/items/:itemId', requireOffice, async (req, res) => {
  const id = idOf(req.params.id);
  const itemId = idOf(req.params.itemId);
  const u = me(req);
  await tx(async (c) => {
    const o = await lockOrder(c, id);
    const i = itemOf(o, itemId);
    if (afterContract(o.status) || o.contractDate) {
      throw badRequest('Після договору вироби не прибираються — змініть дані виробу або додайте коментар.');
    }
    await c.query('DELETE FROM items WHERE id = $1', [itemId]);
    await writeLog(c, { userId: u.id, orderId: id, folder: 'fin', finScope: 'pay', text: `Прибрано виріб «${i.name}»` });
  });
  res.json(await card(req, id));
});

/* ---------- Оплати (5.3, вкладка «Оплати») ---------- */

const paymentSchema = z.object({
  sum: z.number().positive('Вкажіть суму оплати більше 0.').max(100_000_000),
  type: z.enum(PAYMENT_TYPES),
  method: z.enum(PAYMENT_METHODS),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Неправильна дата.'),
  comment: z.string().trim().max(1000).optional(),
});

ordersRouter.post('/orders/:id/payments', requireOffice, async (req, res) => {
  const id = idOf(req.params.id);
  const b = paymentSchema.parse(req.body);
  const u = me(req);
  const sum = Math.round(b.sum * 100) / 100;
  const result = await tx(async (c) => {
    await lockOrder(c, id);
    await c.query(
      `INSERT INTO payments (order_id, sum, type, method, date, comment, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, sum, b.type, b.method, b.date, b.comment || null, u.id],
    );
    await writeLog(c, {
      userId: u.id,
      orderId: id,
      folder: 'fin',
      finScope: 'pay',
      text: `Оплата: ${b.type}, ${b.type === 'повернення' ? '−' : ''}${money(sum)} (${b.method})${b.date !== kyivToday() ? ` від ${fmtDate(b.date)}` : ''}`,
    });
    return compute((await fetchOrder(c, id))!, await getSettings(c)).calc;
  });
  res.status(201).json({
    message: `Внесено ${money(sum)}. Оплачено ${money(result.paid)}, борг ${money(result.debt)}`,
    card: await card(req, id),
  });
});

/* ---------- Коментарі ---------- */

ordersRouter.post('/orders/:id/comments', async (req, res) => {
  const id = idOf(req.params.id);
  const { text } = z.object({ text: z.string().trim().min(1, 'Напишіть текст коментаря.').max(5000) }).parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    await lockOrder(c, id);
    await c.query('INSERT INTO order_comments (order_id, text, created_by) VALUES ($1, $2, $3)', [id, text, u.id]);
    await writeLog(c, { userId: u.id, orderId: id, folder: 'files', text: `Коментар: ${text.length > 80 ? `${text.slice(0, 80)}…` : text}` });
  });
  res.status(201).json(await card(req, id));
});


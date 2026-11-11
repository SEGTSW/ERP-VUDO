/** 8А.4 Склад залишків: адмін, менеджер, Цех, Конструктор, Технолог. Цін і сум немає. */
import { Router } from 'express';
import { z } from 'zod';
import type pg from 'pg';
import { pool, tx } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { me, requireSection } from '../auth/middleware.js';
import { writeLog } from '../audit.js';

export const stockRouter = Router();
stockRouter.use('/stock', requireSection('stock'));

export const STOCK_KINDS = ['Плита', 'Стільниця', 'Фурнітура', 'Профіль', 'Інше'] as const;
const isSheet = (k: string) => k === 'Плита' || k === 'Стільниця';

interface StockRow {
  id: number;
  kind: string;
  material: string;
  thick: number | null;
  w: number | null;
  h: number | null;
  qty: number;
  unit: string;
  place: string | null;
  fromOrderId: number | null;
  note: string | null;
  status: 'вільний' | 'резерв' | 'використано';
  resOrderId: number | null;
}

const COLS = `s.id, s.kind, s.material, s.thick, s.w, s.h, s.qty, s.unit, s.place, s.from_order_id AS "fromOrderId", s.note, s.status,
  s.res_order_id AS "resOrderId", s.created_at AS "createdAt", u.name AS "byName",
  fo.num AS "fromNum", fc.name AS "fromClient", ro.num AS "resNum", rc.name AS "resClient"`;
const JOINS = `LEFT JOIN users u ON u.id = s.created_by
  LEFT JOIN orders fo ON fo.id = s.from_order_id LEFT JOIN clients fc ON fc.id = fo.client_id
  LEFT JOIN orders ro ON ro.id = s.res_order_id LEFT JOIN clients rc ON rc.id = ro.client_id`;

/** «плита «ДСП Egger W1000» 1200×600×18» — для журналу. */
const label = (x: Pick<StockRow, 'kind' | 'material' | 'w' | 'h' | 'thick'>) =>
  `${x.kind.toLowerCase()} «${x.material}»${isSheet(x.kind) && x.w ? ` ${x.w}×${x.h}${x.thick ? `×${x.thick}` : ''}` : ''}`;
const qtyText = (q: number) => String(Math.round(q * 1000) / 1000).replace('.', ',');

async function orderNum(c: pg.PoolClient, id: number | null) {
  if (!id) return null;
  const r = await c.query<{ num: string }>(`SELECT num FROM orders WHERE id = $1 AND status <> 'Відмова'`, [id]);
  if (!r.rows[0]) throw badRequest('Замовлення не знайдено.');
  return r.rows[0].num;
}

async function lockItem(c: pg.PoolClient, id: number): Promise<StockRow> {
  const r = await c.query<StockRow>(
    `SELECT id, kind, material, thick, w, h, qty, unit, place, from_order_id AS "fromOrderId", note, status, res_order_id AS "resOrderId"
       FROM stock_items WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!r.rows[0]) throw notFound('Позицію не знайдено.');
  return r.rows[0];
}

stockRouter.get('/stock', async (_req, res) => {
  const r = await pool.query(`SELECT ${COLS} FROM stock_items s ${JOINS} ORDER BY s.kind, s.material, (s.w * s.h) DESC NULLS LAST, s.id`);
  res.json(r.rows);
});

const num = (max: number) => z.number().int().positive().max(max).nullable().optional();
const itemSchema = z
  .object({
    kind: z.enum(STOCK_KINDS),
    material: z.string().trim().min(1, 'Вкажіть матеріал або найменування.').max(200),
    thick: num(500),
    w: num(10000),
    h: num(10000),
    qty: z.number().min(0).max(1_000_000),
    unit: z.enum(['шт', 'м', 'пар', 'уп', 'м²', 'кг']),
    place: z.string().trim().max(100).transform((v) => v || null),
    fromOrderId: z.number().int().positive().nullable(),
    note: z.string().trim().max(1000).transform((v) => v || null),
  })
  .transform((v) => (isSheet(v.kind) ? v : { ...v, thick: null, w: null, h: null }))
  .superRefine((v, ctx) => {
    if (isSheet(v.kind) && !(v.w && v.h)) {
      ctx.addIssue({ code: 'custom', message: v.kind === 'Стільниця' ? 'Для стільниці вкажіть довжину і глибину.' : 'Для плити вкажіть ширину і висоту обрізка.' });
    }
  });

stockRouter.post('/stock', async (req, res) => {
  const b = itemSchema.parse(req.body);
  if (!(b.qty > 0)) throw badRequest('Вкажіть кількість.');
  const u = me(req);
  await tx(async (c) => {
    const from = await orderNum(c, b.fromOrderId);
    await c.query(
      `INSERT INTO stock_items (kind, material, thick, w, h, qty, unit, place, from_order_id, note, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
      [b.kind, b.material, b.thick ?? null, b.w ?? null, b.h ?? null, b.qty, b.unit, b.place, b.fromOrderId, b.note, u.id],
    );
    await writeLog(c, {
      userId: u.id,
      orderId: b.fromOrderId,
      folder: 'stock',
      text: `Склад: додано ${label({ ...b, thick: b.thick ?? null, w: b.w ?? null, h: b.h ?? null })} — ${qtyText(b.qty)} ${b.unit}${b.place ? ` · ${b.place}` : ''}${from ? ` (з №${from})` : ''}`,
    });
  });
  res.status(201).json({ ok: true });
});

stockRouter.patch('/stock/:id', async (req, res) => {
  const id = Number(req.params.id);
  const b = itemSchema.parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    const x = await lockItem(c, id);
    await orderNum(c, b.fromOrderId);
    const status = b.qty <= 0 ? 'використано' : x.status;
    await c.query(
      `UPDATE stock_items SET kind = $2, material = $3, thick = $4, w = $5, h = $6, qty = $7, unit = $8, place = $9, from_order_id = $10,
              note = $11, status = $12, updated_at = now(), updated_by = $13 WHERE id = $1`,
      [id, b.kind, b.material, b.thick ?? null, b.w ?? null, b.h ?? null, b.qty, b.unit, b.place, b.fromOrderId, b.note, status, u.id],
    );
    await writeLog(c, {
      userId: u.id,
      orderId: x.resOrderId ?? b.fromOrderId,
      folder: 'stock',
      text: `Склад: оновлено ${label({ ...b, thick: b.thick ?? null, w: b.w ?? null, h: b.h ?? null })} — ${qtyText(b.qty)} ${b.unit}`,
    });
  });
  res.json({ ok: true });
});

/** Видалення позиції (з підтвердженням «Точно?» в інтерфейсі). */
stockRouter.delete('/stock/:id', async (req, res) => {
  const id = Number(req.params.id);
  const u = me(req);
  await tx(async (c) => {
    const x = await lockItem(c, id);
    await c.query('DELETE FROM stock_items WHERE id = $1', [id]);
    await writeLog(c, { userId: u.id, folder: 'stock', text: `Склад: видалено ${label(x)}` });
  });
  res.json({ ok: true });
});

stockRouter.post('/stock/:id/reserve', async (req, res) => {
  const id = Number(req.params.id);
  const { orderId } = z.object({ orderId: z.number({ error: 'Виберіть замовлення.' }).int().positive() }).parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    const x = await lockItem(c, id);
    if (x.status === 'використано') throw badRequest('Позицію вже використано.');
    const n = await orderNum(c, orderId);
    await c.query(`UPDATE stock_items SET status = 'резерв', res_order_id = $2, updated_at = now(), updated_by = $3 WHERE id = $1`, [id, orderId, u.id]);
    await writeLog(c, { userId: u.id, orderId, folder: 'stock', text: `Склад: зарезервовано ${label(x)} під №${n}` });
  });
  res.json({ ok: true });
});

stockRouter.post('/stock/:id/unreserve', async (req, res) => {
  const id = Number(req.params.id);
  const u = me(req);
  await tx(async (c) => {
    const x = await lockItem(c, id);
    if (x.status !== 'резерв') throw badRequest('Позиція не зарезервована.');
    await c.query(`UPDATE stock_items SET status = 'вільний', res_order_id = NULL, updated_at = now(), updated_by = $2 WHERE id = $1`, [id, u.id]);
    await writeLog(c, { userId: u.id, orderId: x.resOrderId, folder: 'stock', text: `Склад: знято резерв — ${label(x)}` });
  });
  res.json({ ok: true });
});

/** Використати: скільки + для якого замовлення; часткове списання залишає решту на складі. */
stockRouter.post('/stock/:id/use', async (req, res) => {
  const id = Number(req.params.id);
  const b = z.object({ qty: z.number().positive('Вкажіть кількість.'), orderId: z.number().int().positive().nullable().optional() }).parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    const x = await lockItem(c, id);
    if (x.status === 'використано') throw badRequest('Позицію вже використано.');
    if (b.qty > x.qty + 1e-9) throw badRequest(`На складі лише ${qtyText(x.qty)} ${x.unit}.`);
    const forOrder = b.orderId ?? x.resOrderId;
    const n = forOrder ? await orderNum(c, forOrder) : null;
    if (b.qty < x.qty) {
      // Частина: списана позиція окремим записом, решта лишається
      const rest = Math.round((x.qty - b.qty) * 1000) / 1000;
      // Списали під інше замовлення — резерв решти зберігається; під своє (або без прив'язки) — решта звільняється.
      const keepReserve = x.status === 'резерв' && !!b.orderId && b.orderId !== x.resOrderId;
      await c.query(
        `UPDATE stock_items SET qty = $2, status = $3, res_order_id = $4, updated_at = now(), updated_by = $5 WHERE id = $1`,
        [id, rest, keepReserve ? 'резерв' : 'вільний', keepReserve ? x.resOrderId : null, u.id],
      );
      await c.query(
        `INSERT INTO stock_items (kind, material, thick, w, h, qty, unit, place, from_order_id, note, status, res_order_id, created_by, updated_by)
         SELECT kind, material, thick, w, h, $2, unit, place, from_order_id, note, 'використано', $3, $4, $4 FROM stock_items WHERE id = $1`,
        [id, b.qty, forOrder, u.id],
      );
    } else {
      await c.query(`UPDATE stock_items SET status = 'використано', res_order_id = $2, updated_at = now(), updated_by = $3 WHERE id = $1`, [id, forOrder, u.id]);
    }
    await writeLog(c, {
      userId: u.id,
      orderId: forOrder,
      folder: 'stock',
      text: `Склад: використано ${label(x)} — ${qtyText(b.qty)} ${x.unit}${n ? ` для №${n}` : ''}`,
    });
  });
  res.json({ ok: true });
});

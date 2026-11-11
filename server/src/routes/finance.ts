/**
 * Фінанси власника (ТЗ 10.1 облік, 10.8 статейник, 5.4 витрати замовлення).
 * Усе тут — лише власник (роль Адмін); менеджеру сервер ці дані не віддає навіть за прямим посиланням.
 */
import { Router } from 'express';
import { z } from 'zod';
import type pg from 'pg';
import { ACCOUNTS, ART_TYPES, PNL_LINES, findArticle, fmtDate, kyivToday, lineLabel, money, typeSign } from '@vudo/shared';
import { pool, tx } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { me, requireOwner } from '../auth/middleware.js';
import { diffLine, writeLog } from '../audit.js';
import { getSettings } from '../settings.js';
import { balances, cashRows, loadArticles, orderFacts } from '../finance/cash.js';
import { fetchOrder, ownerFigures, compute } from '../orders/repo.js';

export const financeRouter = Router();
financeRouter.use('/finance', requireOwner);

const MAX_ROWS = 400;

/* ---------- 10.1 Облік ---------- */

const listSchema = z.object({
  month: z.string().regex(/^(\d{4}-\d{2})?$/).default(kyivToday().slice(0, 7)),
  type: z.string().max(30).default(''),
  cat: z.string().max(100).default(''),
  q: z.string().max(100).default(''),
});

financeRouter.get('/finance/cash', async (req, res) => {
  const q = listSchema.parse(req.query);
  const monthEnd = (m: string) => {
    const [y, mm] = m.split('-').map(Number);
    return new Date(Date.UTC(y!, mm!, 0)).toISOString().slice(0, 10);
  };
  const all = await cashRows(pool, q.month ? { from: `${q.month}-01`, to: monthEnd(q.month) } : {});
  const text = q.q.trim().toLowerCase();
  const rows = all.filter(
    (r) =>
      (!q.type || r.type === q.type) &&
      (!q.cat || r.cat === q.cat) &&
      (!text || `${r.obj} ${r.note} ${r.counterparty}`.toLowerCase().includes(text)),
  );
  const inflow = rows.filter((r) => r.sum > 0).reduce((s, r) => s + r.sum, 0);
  const outflow = rows.filter((r) => r.sum < 0).reduce((s, r) => s + r.sum, 0);
  const months = await pool.query<{ m: string }>(
    `SELECT DISTINCT to_char(date, 'YYYY-MM') AS m FROM (SELECT date FROM cash_ops UNION SELECT date FROM payments) x ORDER BY m DESC`,
  );
  res.json({
    rows: rows.slice(0, MAX_ROWS),
    total: rows.length,
    inflow: Math.round(inflow * 100) / 100,
    outflow: Math.round(outflow * 100) / 100,
    balances: await balances(pool),
    months: months.rows.map((x) => x.m),
    today: kyivToday(),
  });
});

const opSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Вкажіть дату.'),
  type: z.enum(ART_TYPES),
  cat: z.string().trim().max(100),
  obj: z.string().trim().max(200).default(''),
  orderId: z.number().int().positive().nullable().default(null),
  counterparty: z.string().trim().max(200).default(''),
  note: z.string().trim().max(1000).default(''),
  account: z.enum(ACCOUNTS),
  /** Без мінуса — знак визначає стаття */
  amount: z.number().positive('Вкажіть суму більше 0.').max(1_000_000_000),
});

interface OpRow {
  id: number;
  date: string;
  type: string;
  cat: string;
  obj: string;
  orderId: number | null;
  counterparty: string;
  note: string;
  account: string;
  sum: number;
}

/** Перевірка операції за статейником; для підстатті «до замовлення» — замовлення обов'язкове, об'єкт = «№ · клієнт». */
async function normalize(c: pg.PoolClient, b: z.infer<typeof opSchema>) {
  const arts = await loadArticles(c);
  const art = findArticle(arts, b.type, b.cat, b.obj);
  const toOrder = arts.some((a) => !a.hidden && a.type === b.type && a.cat === b.cat && a.toOrder);
  let obj = b.obj;
  let orderId: number | null = null;
  if (toOrder) {
    if (!b.orderId) throw badRequest('Виберіть замовлення.', 'orderId');
    const o = await c.query<{ label: string }>(
      `SELECT '№' || o.num || ' · ' || cl.name AS label FROM orders o JOIN clients cl ON cl.id = o.client_id WHERE o.id = $1`,
      [b.orderId],
    );
    if (!o.rows[0]) throw badRequest('Замовлення не знайдено.', 'orderId');
    obj = o.rows[0].label;
    orderId = b.orderId;
  }
  const sum = Math.round(typeSign(b.type) * b.amount * 100) / 100;
  return { ...b, obj, orderId, sum, counterparty: b.counterparty || art?.defaultCp || 'VUDO', line: art?.line ?? 'none' };
}

const opLabel = (x: { type: string; cat: string }) => [x.type, x.cat].filter(Boolean).join('/');

financeRouter.post('/finance/cash', async (req, res) => {
  const b = opSchema.parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    const v = await normalize(c, b);
    await c.query(
      `INSERT INTO cash_ops (date, type, cat, obj, order_id, counterparty, note, account, sum, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [v.date, v.type, v.cat, v.obj, v.orderId, v.counterparty, v.note, v.account, v.sum, u.id],
    );
    await writeLog(c, {
      userId: u.id,
      orderId: v.orderId,
      folder: 'fin',
      finScope: 'report',
      text: `Облік: ${opLabel(v)} ${money(v.sum)}${v.note ? ` · ${v.note}` : ''}`,
    });
  });
  res.status(201).json({ ok: true });
});

async function lockOp(c: pg.PoolClient, id: number): Promise<OpRow> {
  const r = await c.query<OpRow>(
    `SELECT id, date, type, cat, obj, order_id AS "orderId", counterparty, note, account, sum FROM cash_ops WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!r.rows[0]) throw notFound('Операцію не знайдено.');
  return r.rows[0];
}

/** Редагування операції: «поле: було → стало» — у Повідомлення і в історію замовлення (обох, якщо замовлення змінено). */
financeRouter.patch('/finance/cash/:id', async (req, res) => {
  const id = Number(req.params.id);
  const b = opSchema.parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    const old = await lockOp(c, id);
    const v = await normalize(c, b);
    const ch = [
      diffLine('дата', fmtDate(old.date), fmtDate(v.date)),
      diffLine('стаття', old.type, v.type),
      diffLine('підстаття', old.cat, v.cat),
      diffLine("об'єкт", old.obj, v.obj),
      diffLine('контрагент', old.counterparty, v.counterparty),
      diffLine('примітка', old.note, v.note),
      diffLine('каса', old.account, v.account),
      diffLine('сума', money(old.sum), money(v.sum)),
    ].filter(Boolean);
    if (!ch.length) throw badRequest('Змін немає.');
    await c.query(
      `UPDATE cash_ops SET date=$2, type=$3, cat=$4, obj=$5, order_id=$6, counterparty=$7, note=$8, account=$9, sum=$10,
              updated_at = now(), updated_by = $11 WHERE id = $1`,
      [id, v.date, v.type, v.cat, v.obj, v.orderId, v.counterparty, v.note, v.account, v.sum, u.id],
    );
    const text = `Облік: змінено операцію від ${fmtDate(old.date)} (${[old.cat, old.note].filter(Boolean).join(' · ')}) — ${ch.join('; ')}`;
    const orders = [...new Set([old.orderId, v.orderId])];
    for (const oid of orders) await writeLog(c, { userId: u.id, orderId: oid, folder: 'fin', finScope: 'report', text });
  });
  res.json({ ok: true });
});

/** Видалення операції (лише власник; у інтерфейсі — другий клік «Точно?»). */
financeRouter.delete('/finance/cash/:id', async (req, res) => {
  const id = Number(req.params.id);
  const u = me(req);
  await tx(async (c) => {
    const old = await lockOp(c, id);
    await c.query('DELETE FROM cash_ops WHERE id = $1', [id]);
    await writeLog(c, {
      userId: u.id,
      orderId: old.orderId,
      folder: 'fin',
      finScope: 'report',
      text: `Облік: видалено операцію від ${fmtDate(old.date)} — ${opLabel(old)} ${money(old.sum)}${old.note ? ` · ${old.note}` : ''}`,
    });
  });
  res.json({ ok: true });
});

/* ---------- 10.8 Статейник ---------- */

financeRouter.get('/finance/articles', async (_req, res) => {
  const arts = (await loadArticles(pool)).filter((a) => !a.hidden);
  const ops = await pool.query<{ type: string; cat: string; obj: string }>('SELECT type, cat, obj FROM cash_ops');
  res.json(
    arts.map((a) => ({
      ...a,
      ops: ops.rows.filter((e) => findArticle(arts, e.type, e.cat, e.obj)?.id === a.id).length,
    })),
  );
});

/** Поля без значень за замовчуванням — щоб часткове оновлення (PATCH) не скидало незмінені поля. */
const artFields = z.object({
  type: z.enum(ART_TYPES),
  cat: z.string().trim().max(100),
  obj: z.string().trim().max(200),
  defaultCp: z.string().trim().max(200),
  line: z.enum(PNL_LINES.map((l) => l[0]) as [string, ...string[]]),
  toOrder: z.boolean(),
});
const artSchema = artFields.extend({
  obj: artFields.shape.obj.default(''),
  defaultCp: artFields.shape.defaultCp.default(''),
  toOrder: artFields.shape.toOrder.default(false),
});

const uniqueArt = (e: unknown): never => {
  if ((e as { constraint?: string }).constraint === 'articles_uniq') throw badRequest('Така стаття / підстаття / об\'єкт уже є.');
  throw e;
};

financeRouter.post('/finance/articles', async (req, res) => {
  const b = artSchema.parse(req.body);
  if (b.type === 'Дохід' || b.type === 'Витрата') if (!b.cat) throw badRequest('Вкажіть підстаттю.', 'cat');
  const u = me(req);
  await tx(async (c) => {
    await c.query(`INSERT INTO articles (type, cat, obj, default_cp, line, to_order) VALUES ($1,$2,$3,$4,$5,$6)`, [
      b.type, b.cat, b.obj, b.defaultCp, b.line, b.toOrder,
    ]);
    await writeLog(c, { userId: u.id, folder: 'fin', finScope: 'report', text: `Статейник: додано ${opLabel(b)}${b.obj ? `/${b.obj}` : ''} → ${lineLabel(b.line)}` });
  }).catch(uniqueArt);
  res.status(201).json({ ok: true });
});

/** Зміна рядка одразу переносить усі такі операції (P&L рахується за статейником); перейменування підстатті записані операції не змінює. */
financeRouter.patch('/finance/articles/:id', async (req, res) => {
  const id = Number(req.params.id);
  const b = artFields.omit({ type: true }).partial().extend({ hidden: z.boolean().optional() }).parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    const r = await c.query<{ type: string; cat: string; obj: string; default_cp: string; line: string; to_order: boolean; hidden: boolean }>(
      'SELECT type, cat, obj, default_cp, line, to_order, hidden FROM articles WHERE id = $1 FOR UPDATE',
      [id],
    );
    const a = r.rows[0];
    if (!a) throw notFound('Статтю не знайдено.');
    const n = {
      cat: b.cat ?? a.cat,
      obj: b.obj ?? a.obj,
      defaultCp: b.defaultCp ?? a.default_cp,
      line: b.line ?? a.line,
      toOrder: b.toOrder ?? a.to_order,
      hidden: b.hidden ?? a.hidden,
    };
    await c.query('UPDATE articles SET cat=$2, obj=$3, default_cp=$4, line=$5, to_order=$6, hidden=$7 WHERE id = $1', [
      id, n.cat, n.obj, n.defaultCp, n.line, n.toOrder, n.hidden,
    ]);
    const ch = [
      diffLine('підстаття', a.cat, n.cat),
      diffLine("об'єкт", a.obj, n.obj),
      diffLine('контрагент', a.default_cp, n.defaultCp),
      diffLine('рядок P&L', lineLabel(a.line), lineLabel(n.line)),
      a.to_order !== n.toOrder ? `до замовлення: ${n.toOrder ? 'так' : 'ні'}` : null,
      n.hidden && !a.hidden ? 'приховано' : null,
    ].filter(Boolean);
    if (ch.length) {
      await writeLog(c, { userId: u.id, folder: 'fin', finScope: 'report', text: `Статейник: ${opLabel(a)}${a.obj ? `/${a.obj}` : ''} — ${ch.join('; ')}` });
    }
  }).catch(uniqueArt);
  res.json({ ok: true });
});

/* ---------- 5.4 Вкладка «Витрати» замовлення ---------- */

financeRouter.get('/finance/orders/:id/costs', async (req, res) => {
  const id = Number(req.params.id);
  const o = await fetchOrder(pool, id);
  if (!o) throw notFound('Замовлення не знайдено.');
  const s = await getSettings(pool);
  const { calc } = compute(o, s);
  const f = await orderFacts(pool, id);
  const figures = ownerFigures(o, calc, s, f);
  res.json({
    fact: f.fact,
    materials: f.materials,
    collab: f.collab,
    byCat: f.byCat,
    plan: calc.cost,
    left: Math.round((calc.cost - f.materials) * 100) / 100,
    opex: o.opex,
    opexPct: s.opexPct,
    opexAutoValue: Math.round((calc.price * s.opexPct) / 100),
    price: calc.price,
    figures,
    rows: f.rows,
  });
});

financeRouter.patch('/finance/orders/:id/opex', async (req, res) => {
  const id = Number(req.params.id);
  const { opex } = z.object({ opex: z.number().min(0).max(1_000_000_000).nullable() }).parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    const o = await fetchOrder(c, id, true);
    if (!o) throw notFound('Замовлення не знайдено.');
    if ((o.opex ?? null) === opex) return;
    await c.query('UPDATE orders SET opex = $2 WHERE id = $1', [id, opex]);
    await writeLog(c, {
      userId: u.id,
      orderId: id,
      folder: 'fin',
      finScope: 'report',
      text: `Постійні витрати замовлення: ${o.opex == null ? 'авто' : money(o.opex)} → ${opex == null ? 'авто' : money(opex)}`,
    });
  });
  res.json({ ok: true });
});

/* ---------- 10.2 P&L ---------- */

financeRouter.get('/finance/pnl', async (req, res) => {
  const today = kyivToday();
  const year = z.coerce.number().int().min(2000).max(2100).default(Number(today.slice(0, 4))).parse(req.query.year);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  // (17) Факт рядка за місяць = Σ операцій місяця з цим рядком (оплати клієнтів включно)
  const rows = await cashRows(pool, { from: `${year}-01-01`, to: `${year}-12-31` });
  const fact: Record<string, Record<string, number>> = Object.fromEntries(months.map((m) => [m, { net: 0 }]));
  for (const r of rows) {
    const f = fact[r.date.slice(0, 7)]!;
    f[r.line] = Math.round(((f[r.line] ?? 0) + r.sum) * 100) / 100;
    f.net = Math.round((f.net! + r.sum) * 100) / 100;
  }
  // (20) Залишок = Σ усіх операцій до кінця місяця: стартовий — усе до 1 січня
  const before = (await cashRows(pool, { to: `${year - 1}-12-31` })).reduce((s, r) => s + r.sum, 0);
  const plan = await pool.query<{ month: string; line: string; amount: number }>(
    'SELECT month, line, amount FROM pnl_plan WHERE month LIKE $1',
    [`${year}-%`],
  );
  const planBy: Record<string, Record<string, number>> = Object.fromEntries(months.map((m) => [m, {}]));
  for (const p of plan.rows) planBy[p.month]![p.line] = p.amount;
  const years = await pool.query<{ y: number }>(
    `SELECT DISTINCT y FROM (
       SELECT extract(year FROM date)::int AS y FROM cash_ops UNION SELECT extract(year FROM date)::int FROM payments
       UNION SELECT left(month, 4)::int FROM pnl_plan) x ORDER BY y`,
  );
  res.json({
    year,
    months,
    fact,
    plan: planBy,
    opening: Math.round(before * 100) / 100,
    years: [...new Set([...years.rows.map((x) => x.y), Number(today.slice(0, 4))])].sort(),
    today,
  });
});

financeRouter.put('/finance/pnl/plan', async (req, res) => {
  const b = z
    .object({
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      line: z.enum(PNL_LINES.map((l) => l[0]).filter((l) => l !== 'none') as [string, ...string[]]),
      amount: z.number().min(-1_000_000_000).max(1_000_000_000).nullable(),
    })
    .parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    const r = await c.query<{ amount: number }>('SELECT amount FROM pnl_plan WHERE month = $1 AND line = $2 FOR UPDATE', [b.month, b.line]);
    const old = r.rows[0]?.amount ?? null;
    if (old === b.amount) return;
    if (b.amount == null) await c.query('DELETE FROM pnl_plan WHERE month = $1 AND line = $2', [b.month, b.line]);
    else {
      await c.query(
        `INSERT INTO pnl_plan (month, line, amount, updated_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (month, line) DO UPDATE SET amount = EXCLUDED.amount, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [b.month, b.line, b.amount, u.id],
      );
    }
    const v = (x: number | null) => (x == null ? '—' : money(x));
    await writeLog(c, { userId: u.id, folder: 'fin', finScope: 'report', text: `P&L план ${b.month} · ${lineLabel(b.line)}: ${v(old)} → ${v(b.amount)}` });
  });
  res.json({ ok: true });
});

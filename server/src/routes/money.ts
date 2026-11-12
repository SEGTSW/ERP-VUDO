/**
 * Звіти по грошах (ТЗ 10.3–10.6):
 *  - Оплати клієнтів і Борги клієнтів — менеджер і власник (розділ меню «Оплати» у менеджера);
 *  - Дизайнерам і Нарахування — лише власник.
 */
import { Router } from 'express';
import { z } from 'zod';
import { PAYMENT_METHODS, PAYMENT_TYPES, REFUSAL, afterContract, afterInstall, fmtDate, kyivToday, money, paymentSign } from '@vudo/shared';
import { pool, tx } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { me, requireOffice, requireOwner } from '../auth/middleware.js';
import { writeLog } from '../audit.js';
import { getSettings } from '../settings.js';
import { compute, fetchOrders, partnerBonusPct } from '../orders/repo.js';
import { DESIGNER, designerLabel } from '../clients.js';

export const moneyRouter = Router();

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const period = z.object({ from: date.optional(), to: date.optional() });

/* ---------- 10.3 Оплати клієнтів ---------- */

moneyRouter.get('/money/payments', requireOffice, async (req, res) => {
  const q = period
    .extend({
      method: z.enum(PAYMENT_METHODS).or(z.literal('')).default(''),
      type: z.enum(PAYMENT_TYPES).or(z.literal('')).default(''),
      manager: z.coerce.number().int().optional(),
    })
    .parse(req.query);
  const r = await pool.query<{ id: number; date: string; sum: number; type: string; method: string; orderId: number; num: string; client: string; managerName: string; byName: string | null }>(
    `SELECT p.id, p.date, p.sum, p.type, p.method, o.id AS "orderId", o.num, cl.name AS client, m.name AS "managerName", u.name AS "byName"
       FROM payments p JOIN orders o ON o.id = p.order_id JOIN clients cl ON cl.id = o.client_id
       JOIN users m ON m.id = o.manager_id LEFT JOIN users u ON u.id = p.created_by
      WHERE ($1::date IS NULL OR p.date >= $1) AND ($2::date IS NULL OR p.date <= $2)
        AND ($3 = '' OR p.method = $3) AND ($4 = '' OR p.type = $4) AND ($5::bigint IS NULL OR o.manager_id = $5)
      ORDER BY p.date DESC, p.id DESC`,
    [q.from ?? null, q.to ?? null, q.method, q.type, q.manager ?? null],
  );
  const signed = (p: { type: string; sum: number }) => paymentSign(p.type) * p.sum;
  const by = (m: string) => r.rows.filter((p) => p.method === m).reduce((s, p) => s + signed(p), 0);
  res.json({
    rows: r.rows,
    total: r.rows.reduce((s, p) => s + signed(p), 0),
    count: r.rows.length,
    byMethod: Object.fromEntries(PAYMENT_METHODS.map((m) => [m, by(m)])),
  });
});

/* ---------- 10.4 Борги клієнтів ---------- */

moneyRouter.get('/money/debts', requireOffice, async (req, res) => {
  const manager = z.coerce.number().int().optional().parse(req.query.manager);
  const s = await getSettings(pool);
  const orders = await fetchOrders(pool, `NOT o.archived AND o.status <> 'Відмова' AND ($1::bigint IS NULL OR o.manager_id = $1)`, [manager ?? null]);
  // Лише замовлення з договором (Договір і далі або Рекламація) і боргом > 0
  const rows = orders
    .filter((o) => afterContract(o.status))
    .map((o) => ({ o, c: compute(o, s).calc }))
    .filter((x) => x.c.debt > 0)
    .sort((a, b) => b.c.debt - a.c.debt)
    .map(({ o, c }) => ({
      orderId: o.id,
      num: o.num,
      client: o.client.name,
      phone: o.client.phone,
      status: o.status,
      managerName: o.managerName,
      installDate: o.installDate,
      price: c.price,
      paid: c.paid,
      debt: c.debt,
      afterInstall: afterInstall(o.status),
    }));
  res.json({
    rows,
    total: rows.reduce((t, x) => t + x.debt, 0),
    afterInstall: rows.filter((x) => x.afterInstall).reduce((t, x) => t + x.debt, 0),
  });
});

/* ---------- 10.5 Дизайнерам ---------- */

moneyRouter.get('/money/designers', requireOwner, async (_req, res) => {
  const s = await getSettings(pool);
  const designers = await pool.query<{ id: number; name: string; company: string | null; phone: string | null; bonusPct: number | null; archived: boolean }>(
    `SELECT id, name, company, phone, bonus_pct AS "bonusPct", archived FROM clients WHERE type = $1 ORDER BY name`,
    [DESIGNER],
  );
  const orders = await fetchOrders(pool, `o.designer_id IS NOT NULL AND o.source = 'дизайнер' AND o.status <> 'Відмова'`);
  const pays = await pool.query<{ id: number; designerId: number; sum: number; method: string; date: string; comment: string | null; byName: string | null }>(
    `SELECT d.id, d.designer_id AS "designerId", d.sum, d.method, d.date, d.comment, u.name AS "byName"
       FROM designer_payouts d LEFT JOIN users u ON u.id = d.created_by ORDER BY d.date DESC, d.id DESC`,
  );
  const month = kyivToday().slice(0, 7);
  const rows = designers.rows
    .map((d) => {
      const os = orders.filter((o) => o.designerId === d.id);
      const list = os.map((o) => {
        const c = compute(o, s).calc;
        return { orderId: o.id, num: o.num, client: o.client.name, status: o.status, contractDate: o.contractDate, bonus: c.partnerBonus, pct: partnerBonusPct(o, s) ?? 0, price: c.price, archived: o.archived };
      });
      // (21) Нараховано = Σ бонусів замовлень з договором; винні = нараховано − виплачено
      const signed = list.filter((x) => x.contractDate);
      const pending = list.filter((x) => !x.contractDate && !x.archived);
      const payouts = pays.rows.filter((p) => p.designerId === d.id);
      const accrued = signed.reduce((t, x) => t + x.bonus, 0);
      const paid = payouts.reduce((t, p) => t + p.sum, 0);
      return {
        id: d.id,
        label: designerLabel(d),
        name: d.name,
        company: d.company,
        phone: d.phone,
        bonusPct: d.bonusPct ?? s.designerPct,
        contracts: signed.length,
        sales: signed.reduce((t, x) => t + x.price, 0),
        accrued: Math.round(accrued * 100) / 100,
        paid,
        owe: Math.round((accrued - paid) * 100) / 100,
        expected: Math.round(pending.reduce((t, x) => t + x.bonus, 0) * 100) / 100,
        orders: [...signed, ...pending],
        payouts,
        archived: d.archived,
      };
    })
    .filter((r) => !r.archived || r.orders.length || r.payouts.length)
    .sort((a, b) => b.owe - a.owe);
  res.json({
    rows,
    owe: rows.reduce((t, r) => t + Math.max(0, r.owe), 0),
    paidThisMonth: pays.rows.filter((p) => p.date.startsWith(month)).reduce((t, p) => t + p.sum, 0),
    expected: rows.reduce((t, r) => t + r.expected, 0),
  });
});

moneyRouter.post('/money/designers/:id/payouts', requireOwner, async (req, res) => {
  const id = Number(req.params.id);
  const b = z
    .object({
      sum: z.number().positive('Вкажіть суму більше 0.').max(100_000_000),
      method: z.enum(PAYMENT_METHODS),
      date,
      comment: z.string().trim().max(1000).optional(),
    })
    .parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    const d = await c.query<{ name: string; company: string | null }>('SELECT name, company FROM clients WHERE id = $1 AND type = $2', [id, DESIGNER]);
    if (!d.rows[0]) throw notFound('Дизайнера не знайдено.');
    const sum = Math.round(b.sum * 100) / 100;
    await c.query(`INSERT INTO designer_payouts (designer_id, sum, method, date, comment, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [
      id, sum, b.method, b.date, b.comment || null, u.id,
    ]);
    await writeLog(c, {
      userId: u.id,
      folder: 'fin',
      finScope: 'report',
      text: `Виплата дизайнеру «${designerLabel(d.rows[0])}»: ${money(sum)} (${b.method}, ${fmtDate(b.date)})`,
    });
  });
  res.status(201).json({ ok: true });
});

/* ---------- 10.6 Нарахування менеджерам ---------- */

moneyRouter.get('/money/salaries', requireOwner, async (req, res) => {
  const q = period.parse(req.query);
  if (q.from && q.to && q.from > q.to) throw badRequest('Дата «від» пізніша за «до».');
  const s = await getSettings(pool);
  const people = await pool.query<{ id: number; name: string; roles: string[] }>(
    `SELECT id, name, roles FROM users WHERE NOT disabled AND roles && ARRAY['Менеджер','Адмін'] ORDER BY name`,
  );
  // Продаж — у місяць підписання договору, за ціною договору, без Відмов
  const r = await pool.query<{ managerId: number; n: number; sales: number }>(
    `SELECT manager_id AS "managerId", count(*)::int AS n, coalesce(sum(contract_price), 0)::numeric AS sales
       FROM orders WHERE contract_date IS NOT NULL AND status <> $3
        AND ($1::date IS NULL OR contract_date >= $1) AND ($2::date IS NULL OR contract_date <= $2)
      GROUP BY manager_id`,
    [q.from ?? null, q.to ?? null, REFUSAL],
  );
  const pct = s.mgrPct;
  const rows = people.rows.map((p) => {
    const x = r.rows.find((y) => y.managerId === p.id);
    const sales = x?.sales ?? 0;
    return { id: p.id, name: p.name, roles: p.roles, contracts: x?.n ?? 0, sales, pay: pct != null && pct > 0 ? Math.round(sales * pct) / 100 : null };
  });
  res.json({ rows, pct, total: rows.reduce((t, x) => t + (x.pay ?? 0), 0) });
});


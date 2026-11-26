/**
 * Звіти по грошах (ТЗ 10.3–10.6):
 *  - Оплати клієнтів і Борги клієнтів — менеджер і власник (розділ меню «Оплати» у менеджера);
 *  - Дизайнерам і Нарахування — лише власник.
 */
import { Router } from 'express';
import { z } from 'zod';
import { ACCOUNTS, PAYMENT_METHODS, PAYMENT_TYPES, REFUSAL, afterContract, afterInstall, fmtDate, kyivToday, money, paymentSign } from '@vudo/shared';
import { pool, tx } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { me, requireOffice, requireOwner } from '../auth/middleware.js';
import { diffLine, writeLog } from '../audit.js';
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
      afterInstall: afterInstall(o),
    }));
  const other = await otherDebts();
  const ordersTotal = rows.reduce((t, x) => t + x.debt, 0);
  const otherTotal = round2(other.filter((x) => !x.writtenOff).reduce((t, x) => t + x.left, 0));
  res.json({
    rows,
    other,
    ordersTotal,
    otherTotal,
    total: round2(ordersTotal + otherTotal),
    afterInstall: rows.filter((x) => x.afterInstall).reduce((t, x) => t + x.debt, 0),
  });
});

/* ---------- Борги без замовлень ---------- */

const round2 = (n: number) => Math.round(n * 100) / 100;
const txt = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);

async function otherDebts() {
  const today = kyivToday();
  const r = await pool.query<{ id: number; debtor: string; phone: string | null; reason: string | null; amount: number; date: string; dueDate: string | null; cat: string; obj: string; note: string | null; writtenOff: boolean; byName: string | null; paid: number }>(
    `SELECT d.id, d.debtor, d.phone, d.reason, d.amount, d.date, d.due_date AS "dueDate", d.cat, d.obj, d.note, d.written_off AS "writtenOff",
            u.name AS "byName", coalesce((SELECT sum(x.sum) FROM other_debt_payments x WHERE x.debt_id = d.id), 0)::numeric AS paid
       FROM other_debts d LEFT JOIN users u ON u.id = d.created_by ORDER BY d.date DESC, d.id DESC`,
  );
  const pays = await pool.query<{ id: number; debtId: number; date: string; sum: number; account: string; cashOpId: number | null; byName: string | null }>(
    `SELECT x.id, x.debt_id AS "debtId", x.date, x.sum, x.account, x.cash_op_id AS "cashOpId", u.name AS "byName"
       FROM other_debt_payments x LEFT JOIN users u ON u.id = x.created_by ORDER BY x.date, x.id`,
  );
  return r.rows
    .map((d) => {
      const left = round2(d.amount - d.paid);
      const status = d.writtenOff ? 'Списано' : left <= 0 ? 'Погашено' : d.dueDate && d.dueDate < today ? 'Прострочено' : d.paid > 0 ? 'Частково' : 'Не сплачено';
      return { ...d, left: Math.max(0, left), status, payments: pays.rows.filter((p) => p.debtId === d.id) };
    })
    .sort((a, b) => Number(a.left <= 0 || a.writtenOff) - Number(b.left <= 0 || b.writtenOff));
}

const otherDebtSchema = z.object({
  debtor: z.string().trim().min(1, 'Вкажіть, хто винен.').max(200),
  phone: txt(50),
  reason: txt(500),
  amount: z.number().positive('Вкажіть суму більше 0.').max(1_000_000_000),
  date,
  dueDate: date.nullish().transform((v) => v || null),
  cat: z.string().trim().max(100).default('Інші'),
  obj: z.string().trim().max(200).default(''),
  note: txt(1000),
});

moneyRouter.post('/money/other-debts', requireOffice, async (req, res) => {
  const b = otherDebtSchema.parse(req.body);
  const u = me(req);
  const amount = round2(b.amount);
  await tx(async (c) => {
    await c.query(
      `INSERT INTO other_debts (debtor, phone, reason, amount, date, due_date, cat, obj, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [b.debtor, b.phone, b.reason, amount, b.date, b.dueDate, b.cat || 'Інші', b.obj, b.note, u.id],
    );
    await writeLog(c, {
      userId: u.id,
      folder: 'fin',
      finScope: 'pay',
      text: `Борг без замовлення «${b.debtor}»: ${money(amount)} від ${fmtDate(b.date)}${b.reason ? ` — ${b.reason}` : ''}${b.dueDate ? `, повернути до ${fmtDate(b.dueDate)}` : ''}`,
    });
  });
  res.status(201).json({ ok: true });
});

moneyRouter.patch('/money/other-debts/:id', requireOffice, async (req, res) => {
  const id = Number(req.params.id);
  const b = otherDebtSchema.partial().extend({ writtenOff: z.boolean().optional() }).parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    const r = await c.query(
      `SELECT d.*, coalesce((SELECT sum(x.sum) FROM other_debt_payments x WHERE x.debt_id = d.id), 0)::numeric AS paid FROM other_debts d WHERE d.id = $1 FOR UPDATE`,
      [id],
    );
    const x = r.rows[0];
    if (!x) throw notFound('Борг не знайдено.');
    const n = {
      debtor: b.debtor ?? x.debtor,
      phone: b.phone !== undefined ? b.phone : x.phone,
      reason: b.reason !== undefined ? b.reason : x.reason,
      amount: b.amount != null ? round2(b.amount) : Number(x.amount),
      date: b.date ?? x.date,
      due_date: b.dueDate !== undefined ? b.dueDate : x.due_date,
      cat: b.cat || x.cat,
      obj: b.obj ?? x.obj,
      note: b.note !== undefined ? b.note : x.note,
      written_off: b.writtenOff ?? x.written_off,
    };
    if (n.amount + 0.001 < Number(x.paid)) throw badRequest(`Сума не може бути меншою за вже повернене: ${money(Number(x.paid))}.`);
    await c.query(
      `UPDATE other_debts SET debtor=$2, phone=$3, reason=$4, amount=$5, date=$6, due_date=$7, cat=$8, obj=$9, note=$10, written_off=$11 WHERE id = $1`,
      [id, n.debtor, n.phone, n.reason, n.amount, n.date, n.due_date, n.cat, n.obj, n.note, n.written_off],
    );
    const ch = [
      diffLine('хто винен', x.debtor, n.debtor),
      diffLine('телефон', x.phone, n.phone),
      diffLine('за що', x.reason, n.reason),
      Number(x.amount) !== n.amount ? `сума: ${money(Number(x.amount))} → ${money(n.amount)}` : null,
      diffLine('дата', fmtDate(x.date), fmtDate(n.date)),
      diffLine('повернути до', fmtDate(x.due_date), fmtDate(n.due_date)),
      diffLine('стаття', x.cat, n.cat),
      diffLine("об'єкт", x.obj, n.obj),
      diffLine('примітка', x.note, n.note),
      x.written_off !== n.written_off ? (n.written_off ? 'списано' : 'відновлено') : null,
    ].filter(Boolean);
    if (ch.length) await writeLog(c, { userId: u.id, folder: 'fin', finScope: 'pay', text: `Борг без замовлення «${n.debtor}»: ${ch.join('; ')}` });
  });
  res.json({ ok: true });
});

moneyRouter.delete('/money/other-debts/:id', requireOffice, async (req, res) => {
  const id = Number(req.params.id);
  const u = me(req);
  await tx(async (c) => {
    const r = await c.query<{ debtor: string; amount: number }>('SELECT debtor, amount FROM other_debts WHERE id = $1 FOR UPDATE', [id]);
    const x = r.rows[0];
    if (!x) throw notFound('Борг не знайдено.');
    const p = await c.query('SELECT 1 FROM other_debt_payments WHERE debt_id = $1 LIMIT 1', [id]);
    if (p.rowCount) throw badRequest('Спершу видаліть повернення цього боргу — або позначте борг списаним.');
    await c.query('DELETE FROM other_debts WHERE id = $1', [id]);
    await writeLog(c, { userId: u.id, folder: 'fin', finScope: 'pay', text: `Борг без замовлення «${x.debtor}» на ${money(x.amount)} видалено` });
  });
  res.json({ ok: true });
});

moneyRouter.post('/money/other-debts/:id/pay', requireOffice, async (req, res) => {
  const id = Number(req.params.id);
  const b = z
    .object({ date, sum: z.number().positive('Вкажіть суму більше 0.').max(1_000_000_000), account: z.enum(ACCOUNTS), toCash: z.boolean().default(true) })
    .parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    const r = await c.query(
      `SELECT d.*, coalesce((SELECT sum(x.sum) FROM other_debt_payments x WHERE x.debt_id = d.id), 0)::numeric AS paid FROM other_debts d WHERE d.id = $1 FOR UPDATE`,
      [id],
    );
    const x = r.rows[0];
    if (!x) throw notFound('Борг не знайдено.');
    if (x.written_off) throw badRequest('Борг списано.');
    const left = round2(Number(x.amount) - Number(x.paid));
    const sum = round2(b.sum);
    if (sum > left + 0.001) throw badRequest(`Залишок боргу — ${money(left)}.`);
    let cashId: number | null = null;
    if (b.toCash) {
      const op = await c.query<{ id: number }>(
        `INSERT INTO cash_ops (date, type, cat, obj, counterparty, note, account, sum, created_by) VALUES ($1,'Дохід',$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [b.date, x.cat, x.obj, x.debtor, ['Повернення боргу', x.reason].filter(Boolean).join(' · '), b.account, sum, u.id],
      );
      cashId = op.rows[0]!.id;
    }
    await c.query('INSERT INTO other_debt_payments (debt_id, date, sum, account, cash_op_id, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [id, b.date, sum, b.account, cashId, u.id]);
    await writeLog(c, {
      userId: u.id,
      folder: 'fin',
      finScope: 'pay',
      text: `Борг без замовлення «${x.debtor}»: повернено ${money(sum)} (${b.account})${left - sum > 0.001 ? `, залишок ${money(left - sum)}` : ' — повністю'}${b.toCash ? '' : ' (без запису в облік)'}`,
    });
  });
  res.status(201).json({ ok: true });
});

moneyRouter.delete('/money/other-debt-payments/:id', requireOffice, async (req, res) => {
  const id = Number(req.params.id);
  const u = me(req);
  await tx(async (c) => {
    const r = await c.query<{ sum: number; date: string; cash_op_id: number | null; debtor: string }>(
      `SELECT x.sum, x.date, x.cash_op_id, d.debtor FROM other_debt_payments x JOIN other_debts d ON d.id = x.debt_id WHERE x.id = $1 FOR UPDATE OF x`,
      [id],
    );
    const x = r.rows[0];
    if (!x) throw notFound('Повернення не знайдено.');
    await c.query('DELETE FROM other_debt_payments WHERE id = $1', [id]);
    if (x.cash_op_id) await c.query('DELETE FROM cash_ops WHERE id = $1', [x.cash_op_id]);
    await writeLog(c, {
      userId: u.id,
      folder: 'fin',
      finScope: 'pay',
      text: `Борг без замовлення «${x.debtor}»: видалено повернення ${money(x.sum)} від ${fmtDate(x.date)}${x.cash_op_id ? ' (і запис в обліку)' : ''}`,
    });
  });
  res.json({ ok: true });
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

/* ---------- 10.6 Нарахування ЗП: усі активні працівники; % від продажів — лише менеджерам і власнику ---------- */

moneyRouter.get('/money/salaries', requireOwner, async (req, res) => {
  const q = period.parse(req.query);
  if (q.from && q.to && q.from > q.to) throw badRequest('Дата «від» пізніша за «до».');
  const s = await getSettings(pool);
  const people = await pool.query<{ id: number; name: string; roles: string[] }>(
    `SELECT id, name, roles FROM users WHERE NOT disabled ORDER BY name`,
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
    const seller = p.roles.some((r) => r === 'Менеджер' || r === 'Адмін');
    return { id: p.id, name: p.name, roles: p.roles, seller, contracts: x?.n ?? 0, sales, pay: seller && pct != null && pct > 0 ? Math.round(sales * pct) / 100 : null };
  });
  res.json({ rows, pct, total: rows.reduce((t, x) => t + (x.pay ?? 0), 0) });
});


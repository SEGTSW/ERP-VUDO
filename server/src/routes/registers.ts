/**
 * Реєстр позик і реєстр рахунків до оплати (лише власник).
 * Рух коштів за ними може одразу записуватись в облік (галочка «Записати в облік») —
 * її знімають, якщо такий рух уже є в обліку (наприклад, після імпорту).
 */
import { Router } from 'express';
import { z } from 'zod';
import type pg from 'pg';
import { fmtDate, kyivToday, loanSummary, money, payableState, paymentPurpose } from '@vudo/shared';
import { pool, tx } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { me, requireOwner } from '../auth/middleware.js';
import { diffLine, writeLog } from '../audit.js';

export const registersRouter = Router();
registersRouter.use(['/finance/loans', '/finance/loan-ops', '/finance/payables'], requireOwner);

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Вкажіть дату.');
const text = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);

async function cashOp(
  c: pg.PoolClient,
  v: { date: string; type: string; cat: string; obj: string; orderId?: number | null; counterparty: string; note: string; account: string; sum: number },
  userId: number,
): Promise<number> {
  const r = await c.query<{ id: number }>(
    `INSERT INTO cash_ops (date, type, cat, obj, order_id, counterparty, note, account, sum, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [v.date, v.type, v.cat, v.obj, v.orderId ?? null, v.counterparty, v.note, v.account, v.sum, userId],
  );
  return r.rows[0]!.id;
}

/* ---------- Позики ---------- */

registersRouter.get('/finance/loans', async (_req, res) => {
  const today = kyivToday();
  const loans = await pool.query(
    `SELECT id, lender, tax_id AS "taxId", contract, contract_date AS "contractDate", limit_amount AS "limit", interest, note, archived
       FROM loans ORDER BY archived, lender`,
  );
  const ops = await pool.query<{ id: number; loanId: number; date: string; kind: 'in' | 'out'; sum: number; dueDate: string | null }>(
    `SELECT o.id, o.loan_id AS "loanId", o.date, o.kind, o.sum, o.method, o.doc, o.note, o.due_date AS "dueDate",
            o.cash_op_id AS "cashOpId", u.name AS "byName"
       FROM loan_ops o LEFT JOIN users u ON u.id = o.created_by ORDER BY o.date, o.id`,
  );
  const rows = loans.rows.map((l) => {
    const list = ops.rows.filter((o) => o.loanId === l.id);
    const s = loanSummary(list, today, l.limit);
    return { ...l, ...s, ops: list.map((o) => ({ ...o, state: s.states.find((x) => x.id === o.id) ?? null })) };
  });
  const active = rows.filter((r) => !r.archived);
  res.json({
    rows,
    debt: active.reduce((t, r) => t + r.debt, 0),
    overdue: active.reduce((t, r) => t + r.overdue, 0),
    nextDue: active.map((r) => r.nextDue).filter(Boolean).sort()[0] ?? null,
  });
});

const loanSchema = z.object({
  lender: z.string().trim().min(1, 'Вкажіть позикодавця.').max(200),
  taxId: text(20),
  contract: text(200),
  contractDate: date.nullish().transform((v) => v || null),
  limit: z.number().positive().max(1_000_000_000).nullable(),
  interest: z.string().trim().max(100).default('безвідсоткова'),
  note: text(1000),
});

registersRouter.post('/finance/loans', async (req, res) => {
  const b = loanSchema.parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    await c.query(
      `INSERT INTO loans (lender, tax_id, contract, contract_date, limit_amount, interest, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [b.lender, b.taxId, b.contract, b.contractDate, b.limit, b.interest, b.note, u.id],
    );
    await writeLog(c, { userId: u.id, folder: 'fin', finScope: 'report', text: `Позики: новий позикодавець «${b.lender}»${b.contract ? `, договір ${b.contract}` : ''}` });
  });
  res.status(201).json({ ok: true });
});

registersRouter.patch('/finance/loans/:id', async (req, res) => {
  const id = Number(req.params.id);
  const b = loanSchema.partial().extend({ archived: z.boolean().optional() }).parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    const r = await c.query('SELECT lender, tax_id, contract, contract_date, limit_amount, interest, note, archived FROM loans WHERE id = $1 FOR UPDATE', [id]);
    const x = r.rows[0];
    if (!x) throw notFound('Позику не знайдено.');
    const n = {
      lender: b.lender ?? x.lender,
      taxId: b.taxId !== undefined ? b.taxId : x.tax_id,
      contract: b.contract !== undefined ? b.contract : x.contract,
      contractDate: b.contractDate !== undefined ? b.contractDate : x.contract_date,
      limit: b.limit !== undefined ? b.limit : x.limit_amount,
      interest: b.interest ?? x.interest,
      note: b.note !== undefined ? b.note : x.note,
      archived: b.archived ?? x.archived,
    };
    await c.query('UPDATE loans SET lender=$2, tax_id=$3, contract=$4, contract_date=$5, limit_amount=$6, interest=$7, note=$8, archived=$9 WHERE id = $1', [
      id, n.lender, n.taxId, n.contract, n.contractDate, n.limit, n.interest, n.note, n.archived,
    ]);
    const ch = [
      diffLine('позикодавець', x.lender, n.lender),
      diffLine('договір', x.contract, n.contract),
      diffLine('ліміт', x.limit_amount == null ? null : money(x.limit_amount), n.limit == null ? null : money(n.limit)),
      x.archived !== n.archived ? (n.archived ? 'в архіві' : 'повернуто з архіву') : null,
    ].filter(Boolean);
    if (ch.length) await writeLog(c, { userId: u.id, folder: 'fin', finScope: 'report', text: `Позики «${n.lender}»: ${ch.join('; ')}` });
  });
  res.json({ ok: true });
});

registersRouter.post('/finance/loans/:id/ops', async (req, res) => {
  const id = Number(req.params.id);
  const b = z
    .object({
      date,
      kind: z.enum(['in', 'out']),
      sum: z.number().positive('Вкажіть суму більше 0.').max(1_000_000_000),
      method: z.enum(['безготівково', 'готівка']),
      doc: text(300),
      note: text(1000),
      dueDate: date.nullish().transform((v) => v || null),
      toCash: z.boolean().default(true),
    })
    .parse(req.body);
  const u = me(req);
  const today = kyivToday();
  await tx(async (c) => {
    const l = await c.query<{ lender: string; limit_amount: number | null }>('SELECT lender, limit_amount FROM loans WHERE id = $1 FOR UPDATE', [id]);
    const loan = l.rows[0];
    if (!loan) throw notFound('Позику не знайдено.');
    const ops = await c.query('SELECT id, date, kind, sum, due_date AS "dueDate" FROM loan_ops WHERE loan_id = $1', [id]);
    const s = loanSummary(ops.rows, today, loan.limit_amount);
    const sum = Math.round(b.sum * 100) / 100;
    if (b.kind === 'out' && sum > s.debt + 0.001) throw badRequest(`Повернути можна не більше боргу ТОВ: ${money(s.debt)}.`);
    if (b.kind === 'in' && loan.limit_amount != null && s.debt + sum > loan.limit_amount + 0.001) {
      throw badRequest(`Перевищено ліміт за договором: залишок ліміту ${money(s.limitLeft ?? 0)}.`);
    }
    let cashId: number | null = null;
    if (b.toCash) {
      cashId = await cashOp(
        c,
        {
          date: b.date,
          type: b.kind === 'in' ? 'Позика+' : 'Позика-',
          cat: b.kind === 'in' ? 'Поповнення' : 'Зняття',
          obj: 'VUDO',
          counterparty: loan.lender,
          note: [b.kind === 'in' ? 'Поворотна фіндопомога' : 'Повернення фіндопомоги', b.doc].filter(Boolean).join(' · '),
          account: b.method === 'готівка' ? 'Готівка' : 'Карта',
          sum: b.kind === 'in' ? sum : -sum,
        },
        u.id,
      );
    }
    await c.query(
      `INSERT INTO loan_ops (loan_id, date, kind, sum, method, doc, note, due_date, cash_op_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, b.date, b.kind, sum, b.method, b.doc, b.note, b.kind === 'in' ? b.dueDate : null, cashId, u.id],
    );
    await writeLog(c, {
      userId: u.id,
      folder: 'fin',
      finScope: 'report',
      text: `Позики «${loan.lender}»: ${b.kind === 'in' ? 'надходження' : 'повернення'} ${money(sum)} від ${fmtDate(b.date)}${b.kind === 'in' && b.dueDate ? `, повернути до ${fmtDate(b.dueDate)}` : ''}${b.toCash ? '' : ' (без запису в облік)'}`,
    });
  });
  res.status(201).json({ ok: true });
});

/** Видалення помилково внесеної операції позики (разом з її записом в обліку). */
registersRouter.delete('/finance/loan-ops/:id', async (req, res) => {
  const id = Number(req.params.id);
  const u = me(req);
  await tx(async (c) => {
    const r = await c.query<{ loan_id: number; kind: string; sum: number; date: string; cash_op_id: number | null; lender: string }>(
      `SELECT o.loan_id, o.kind, o.sum, o.date, o.cash_op_id, l.lender FROM loan_ops o JOIN loans l ON l.id = o.loan_id WHERE o.id = $1 FOR UPDATE`,
      [id],
    );
    const o = r.rows[0];
    if (!o) throw notFound('Операцію не знайдено.');
    await c.query('DELETE FROM loan_ops WHERE id = $1', [id]);
    if (o.cash_op_id) await c.query('DELETE FROM cash_ops WHERE id = $1', [o.cash_op_id]);
    await writeLog(c, {
      userId: u.id,
      folder: 'fin',
      finScope: 'report',
      text: `Позики «${o.lender}»: видалено ${o.kind === 'in' ? 'надходження' : 'повернення'} ${money(o.sum)} від ${fmtDate(o.date)}${o.cash_op_id ? ' (і запис в обліку)' : ''}`,
    });
  });
  res.json({ ok: true });
});

/* ---------- Рахунки до оплати ---------- */

registersRouter.get('/finance/payables', async (_req, res) => {
  const today = kyivToday();
  const r = await pool.query(
    `SELECT p.id, p.counterparty, p.tax_id AS "taxId", p.iban, p.purpose, p.invoice, p.amount, p.vat, p.due_date AS "dueDate",
            p.priority, p.cat, p.obj, p.order_id AS "orderId", o.num AS "orderNum", p.note, p.cancelled, p.created_at AS "createdAt",
            coalesce((SELECT sum(x.sum) FROM payable_payments x WHERE x.payable_id = p.id), 0)::numeric AS paid
       FROM payables p LEFT JOIN orders o ON o.id = p.order_id ORDER BY p.id DESC`,
  );
  const pays = await pool.query(
    `SELECT x.id, x.payable_id AS "payableId", x.date, x.sum, x.account, x.cash_op_id AS "cashOpId", u.name AS "byName"
       FROM payable_payments x LEFT JOIN users u ON u.id = x.created_by ORDER BY x.date, x.id`,
  );
  const prio = { 'терміново': 0, 'високий': 1, 'звичайний': 2, 'низький': 3 } as Record<string, number>;
  const rows = r.rows
    .map((p) => {
      const st = payableState(p.amount, p.paid, p.dueDate, today, p.cancelled);
      return { ...p, ...st, purposeText: paymentPurpose(p, st.left || p.amount), payments: pays.rows.filter((x) => x.payableId === p.id) };
    })
    // спершу неоплачені: прострочені, далі за пріоритетом і строком
    .sort(
      (a, b) =>
        Number(a.left <= 0 || a.cancelled) - Number(b.left <= 0 || b.cancelled) ||
        Number(b.status === 'Прострочено') - Number(a.status === 'Прострочено') ||
        prio[a.priority]! - prio[b.priority]! ||
        String(a.dueDate ?? '9999').localeCompare(String(b.dueDate ?? '9999')),
    );
  const open = rows.filter((x) => !x.cancelled && x.left > 0);
  const week = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) + 7)).toISOString().slice(0, 10);
  res.json({
    rows,
    toPay: open.reduce((t, x) => t + x.left, 0),
    overdue: open.filter((x) => x.status === 'Прострочено').reduce((t, x) => t + x.left, 0),
    week: open.filter((x) => x.dueDate && x.dueDate <= week).reduce((t, x) => t + x.left, 0),
  });
});

const payableSchema = z.object({
  counterparty: z.string().trim().min(1, 'Вкажіть контрагента.').max(200),
  taxId: text(20),
  iban: z
    .string()
    .trim()
    .max(40)
    .nullish()
    .transform((v) => (v ? v.replace(/\s/g, '').toUpperCase() : null))
    .refine((v) => !v || /^UA\d{27}$/.test(v), 'IBAN: UA і 27 цифр.'),
  purpose: z.string().trim().max(500).default(''),
  invoice: text(200),
  amount: z.number().positive('Вкажіть суму більше 0.').max(1_000_000_000),
  vat: z.number().min(0).max(1_000_000_000).default(0),
  dueDate: date.nullish().transform((v) => v || null),
  priority: z.enum(['терміново', 'високий', 'звичайний', 'низький']).default('звичайний'),
  cat: z.string().trim().max(100).default(''),
  obj: z.string().trim().max(200).default(''),
  orderId: z.number().int().positive().nullable().default(null),
  note: text(1000),
});

registersRouter.post('/finance/payables', async (req, res) => {
  const b = payableSchema.parse(req.body);
  if (b.vat > b.amount) throw badRequest('ПДВ не може бути більшим за суму.', 'vat');
  const u = me(req);
  await tx(async (c) => {
    await c.query(
      `INSERT INTO payables (counterparty, tax_id, iban, purpose, invoice, amount, vat, due_date, priority, cat, obj, order_id, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [b.counterparty, b.taxId, b.iban, b.purpose, b.invoice, b.amount, b.vat, b.dueDate, b.priority, b.cat, b.obj, b.orderId, b.note, u.id],
    );
    await writeLog(c, {
      userId: u.id,
      folder: 'fin',
      finScope: 'report',
      text: `Рахунки до оплати: новий — «${b.counterparty}», ${money(b.amount)}${b.dueDate ? `, оплатити до ${fmtDate(b.dueDate)}` : ''}`,
    });
  });
  res.status(201).json({ ok: true });
});

registersRouter.patch('/finance/payables/:id', async (req, res) => {
  const id = Number(req.params.id);
  const b = payableSchema.partial().extend({ cancelled: z.boolean().optional() }).parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    const r = await c.query('SELECT * FROM payables WHERE id = $1 FOR UPDATE', [id]);
    const x = r.rows[0];
    if (!x) throw notFound('Рахунок не знайдено.');
    const n = {
      counterparty: b.counterparty ?? x.counterparty,
      taxId: b.taxId !== undefined ? b.taxId : x.tax_id,
      iban: b.iban !== undefined ? b.iban : x.iban,
      purpose: b.purpose ?? x.purpose,
      invoice: b.invoice !== undefined ? b.invoice : x.invoice,
      amount: b.amount ?? Number(x.amount),
      vat: b.vat ?? Number(x.vat),
      dueDate: b.dueDate !== undefined ? b.dueDate : x.due_date,
      priority: b.priority ?? x.priority,
      cat: b.cat ?? x.cat,
      obj: b.obj ?? x.obj,
      orderId: b.orderId !== undefined ? b.orderId : x.order_id,
      note: b.note !== undefined ? b.note : x.note,
      cancelled: b.cancelled ?? x.cancelled,
    };
    if (n.vat > n.amount) throw badRequest('ПДВ не може бути більшим за суму.', 'vat');
    await c.query(
      `UPDATE payables SET counterparty=$2, tax_id=$3, iban=$4, purpose=$5, invoice=$6, amount=$7, vat=$8, due_date=$9, priority=$10,
              cat=$11, obj=$12, order_id=$13, note=$14, cancelled=$15 WHERE id = $1`,
      [id, n.counterparty, n.taxId, n.iban, n.purpose, n.invoice, n.amount, n.vat, n.dueDate, n.priority, n.cat, n.obj, n.orderId, n.note, n.cancelled],
    );
    const ch = [
      diffLine('контрагент', x.counterparty, n.counterparty),
      diffLine('сума', money(Number(x.amount)), money(n.amount)),
      diffLine('оплатити до', x.due_date ? fmtDate(x.due_date) : null, n.dueDate ? fmtDate(n.dueDate) : null),
      diffLine('пріоритет', x.priority, n.priority),
      x.cancelled !== n.cancelled ? (n.cancelled ? 'скасовано' : 'відновлено') : null,
    ].filter(Boolean);
    if (ch.length) await writeLog(c, { userId: u.id, folder: 'fin', finScope: 'report', text: `Рахунок «${n.counterparty}»: ${ch.join('; ')}` });
  });
  res.json({ ok: true });
});

/** «Оплатити» (можна частинами): витрата в облік зі статтею рахунку або замовленням. */
registersRouter.post('/finance/payables/:id/pay', async (req, res) => {
  const id = Number(req.params.id);
  const b = z
    .object({ date, sum: z.number().positive('Вкажіть суму більше 0.').max(1_000_000_000), account: z.enum(['Карта', 'Готівка']), toCash: z.boolean().default(true) })
    .parse(req.body);
  const u = me(req);
  const today = kyivToday();
  await tx(async (c) => {
    const r = await c.query(
      `SELECT p.*, coalesce((SELECT sum(x.sum) FROM payable_payments x WHERE x.payable_id = p.id), 0)::numeric AS paid,
              o.num, cl.name AS client
         FROM payables p LEFT JOIN orders o ON o.id = p.order_id LEFT JOIN clients cl ON cl.id = o.client_id WHERE p.id = $1 FOR UPDATE OF p`,
      [id],
    );
    const p = r.rows[0];
    if (!p) throw notFound('Рахунок не знайдено.');
    if (p.cancelled) throw badRequest('Рахунок скасовано.');
    const st = payableState(Number(p.amount), Number(p.paid), p.due_date, today);
    const sum = Math.round(b.sum * 100) / 100;
    if (sum > st.left + 0.001) throw badRequest(`Залишок до сплати — ${money(st.left)}.`);
    let cashId: number | null = null;
    if (b.toCash) {
      const toOrder = !!p.order_id;
      cashId = await cashOp(
        c,
        {
          date: b.date,
          type: 'Витрата',
          cat: toOrder ? p.cat || 'Замовлення' : p.cat,
          obj: toOrder ? `№${p.num} · ${p.client}` : p.obj,
          orderId: p.order_id,
          counterparty: p.counterparty,
          note: [p.purpose, p.invoice ? `рах. ${p.invoice}` : null].filter(Boolean).join(' · '),
          account: b.account,
          sum: -sum,
        },
        u.id,
      );
    }
    await c.query(`INSERT INTO payable_payments (payable_id, date, sum, account, cash_op_id, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [
      id, b.date, sum, b.account, cashId, u.id,
    ]);
    await writeLog(c, {
      userId: u.id,
      orderId: p.order_id,
      folder: 'fin',
      finScope: 'report',
      text: `Рахунок «${p.counterparty}»: оплачено ${money(sum)}${st.left - sum > 0.001 ? `, залишок ${money(st.left - sum)}` : ' — повністю'}${b.toCash ? '' : ' (без запису в облік)'}`,
    });
  });
  res.status(201).json({ ok: true });
});

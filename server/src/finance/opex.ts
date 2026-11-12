/** Частка постійних витрат на замовлення (ТЗ 10.7 і формула 13). */
import { FIXED_LINES, addDays, autoOpexPct, kyivToday, perMonth, type Settings } from '@vudo/shared';
import type { Db } from '../db.js';
import { cashRows } from './cash.js';

export interface OpexInfo {
  /** Ефективний % для замовлень, де постійні витрати не вказані вручну */
  pct: number;
  /** Авто-частка зі списку постійних витрат (null — немає бази) */
  autoPct: number | null;
  /** Підказка «за фактом 3 міс.» */
  factPct: number | null;
  /** Σ постійних витрат на місяць (лише увімкнені) */
  fixedTotal: number;
  base: { value: number; src: string } | null;
}

/** Місяць РРРР-ММ, що на k місяців раніше за поточний. */
const monthsBack = (today: string, k: number) =>
  new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - k, 1)).toISOString().slice(0, 7);

export async function opexInfo(db: Db, s: Settings): Promise<OpexInfo> {
  const today = kyivToday();
  const fixed = await db.query<{ amount: number; period: string }>('SELECT amount, period FROM fixed_costs WHERE active');
  const fixedTotal = Math.round(fixed.rows.reduce((t, x) => t + perMonth(x.amount, x.period), 0));

  // Дохід і постійні статті за 3 попередні повні місяці (з обліку, за рядками статейника)
  const m = [1, 2, 3].map((k) => monthsBack(today, k));
  const from = `${m[2]}-01`;
  const rows = await cashRows(db, { from, to: addDays(`${today.slice(0, 8)}01`, -1) });
  const income = new Map<string, number>();
  let fixedFact = 0;
  for (const r of rows) {
    const mm = r.date.slice(0, 7);
    if (r.line === 'income') income.set(mm, (income.get(mm) ?? 0) + r.sum);
    if (FIXED_LINES.includes(r.line)) fixedFact -= r.sum;
  }
  const incomes = m.map((x) => income.get(x) ?? 0).filter((x) => x > 0);
  const incomeTotal = m.reduce((t, x) => t + (income.get(x) ?? 0), 0);

  const plan = await db.query<{ amount: number }>(`SELECT amount FROM pnl_plan WHERE month = $1 AND line = 'income'`, [today.slice(0, 7)]);
  const planIncome = plan.rows[0]?.amount ?? 0;
  const base =
    planIncome > 0
      ? { value: planIncome, src: 'план доходу на цей місяць' }
      : incomes.length
        ? { value: incomes.reduce((a, b) => a + b, 0) / incomes.length, src: 'середній дохід за останні місяці' }
        : null;
  const autoPct = autoOpexPct(fixedTotal, base?.value ?? null);
  const factPct = incomeTotal > 0 ? Math.round((fixedFact / incomeTotal) * 1000) / 10 : null;
  return { pct: s.opexMode === 'auto' ? (autoPct ?? s.opexPct) : s.opexPct, autoPct, factPct, fixedTotal, base };
}

/** Налаштування з ефективним % постійних витрат — для розрахунку чистого прибутку. */
export async function withEffectiveOpex(db: Db, s: Settings): Promise<Settings> {
  return { ...s, opexPct: (await opexInfo(db, s)).pct };
}

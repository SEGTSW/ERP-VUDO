/** P&L (ТЗ 10.2, формули 17–20 розділу 14). */
import type { PnlLine } from './finance.js';

/** Знак плану: витрати вводяться без мінуса (out), доходи — плюс (in), «Кредити» і «Позика» — зі знаком (mix). */
export const LINE_KIND: Record<PnlLine, 'in' | 'out' | 'mix' | 'none'> = {
  income: 'in',
  orderCost: 'out',
  admin: 'out',
  payroll: 'out',
  other: 'out',
  marketing: 'out',
  tax: 'out',
  logistics: 'out',
  collab: 'out',
  credit: 'mix',
  working: 'out',
  invPlus: 'in',
  invMinus: 'out',
  dividends: 'out',
  loan: 'mix',
  none: 'none',
};

/** Операційні рядки, що входять у «Результат операційної діяльності». */
export const OPEX_LINES: PnlLine[] = ['admin', 'payroll', 'other', 'marketing', 'tax', 'logistics', 'collab', 'credit', 'working'];
export const INVEST_LINES: PnlLine[] = ['invPlus', 'invMinus', 'dividends', 'loan'];
/** Постійні статті для підказки «за фактом 3 міс.» (ТЗ 14, п. 13). */
export const FIXED_LINES: PnlLine[] = ['admin', 'payroll', 'other', 'marketing', 'tax'];

/** Введене значення плану → сума зі знаком. */
export function planSigned(line: PnlLine, raw: number): number {
  const k = LINE_KIND[line];
  return k === 'out' ? -Math.abs(raw) : k === 'in' ? Math.abs(raw) : raw;
}

export type LineSums = Partial<Record<PnlLine, number>>;

/** (18) Виручка = Дохід + Витрати на замовлення; Маржа % = Виручка / Дохід. (19) Результат і операційна маржа. */
export function pnlDerived(s: LineSums) {
  const g = (k: PnlLine) => s[k] ?? 0;
  const revenue = g('income') + g('orderCost');
  const result = revenue + OPEX_LINES.reduce((t, k) => t + g(k), 0);
  return {
    revenue,
    margin: g('income') ? (revenue / g('income')) * 100 : null,
    result,
    opMargin: g('income') ? (result / g('income')) * 100 : null,
  };
}

/* ---------- 10.7 Постійні витрати, формула 13 ---------- */

export const FIXED_PERIODS = [
  ['month', 'щомісяця', 1],
  ['week', 'щотижня', 52 / 12],
  ['quarter', 'раз на квартал', 1 / 3],
  ['year', 'раз на рік', 1 / 12],
] as const;
export type FixedPeriod = (typeof FIXED_PERIODS)[number][0];

/** Сума на місяць: щомісячні × 1, щотижневі × 52/12, квартальні / 3, річні / 12. */
export function perMonth(amount: number, period: string): number {
  const k = FIXED_PERIODS.find((p) => p[0] === period)?.[2] ?? 1;
  return (Number(amount) || 0) * k;
}

/**
 * (13) Частка постійних витрат на замовлення (авто) = Σ постійних на місяць / база × 100, один знак після коми.
 * База — план доходу поточного місяця; немає плану — середній фактичний дохід останніх 3 місяців з доходом.
 */
export function autoOpexPct(fixedPerMonth: number, base: number | null): number | null {
  if (!base || base <= 0) return null;
  return Math.round((fixedPerMonth / base) * 1000) / 10;
}

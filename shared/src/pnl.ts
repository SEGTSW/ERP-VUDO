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

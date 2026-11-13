/** Позики і рахунки до оплати: розрахунки, спільні для сервера й інтерфейсу. */

export interface LoanOpInput {
  id: number;
  date: string;
  kind: 'in' | 'out';
  sum: number;
  dueDate: string | null;
}

export interface LoanInflowState {
  id: number;
  remaining: number;
  status: 'Повернено' | 'Діє' | 'Прострочено';
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Підсумки позики. Повернення погашають найстаріші внески першими (FIFO);
 * неповернений залишок внеску після строку — прострочення.
 */
export function loanSummary(ops: LoanOpInput[], today: string, limit: number | null) {
  const sorted = [...ops].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const inflows = sorted.filter((o) => o.kind === 'in').map((o) => ({ ...o, left: o.sum }));
  let returned = 0;
  for (const o of sorted) if (o.kind === 'out') returned += o.sum;
  let pool = returned;
  for (const i of inflows) {
    const take = Math.min(i.left, pool);
    i.left = r2(i.left - take);
    pool = r2(pool - take);
  }
  const deposited = r2(inflows.reduce((t, i) => t + i.sum, 0));
  const debt = r2(deposited - returned);
  const states: LoanInflowState[] = inflows.map((i) => ({
    id: i.id,
    remaining: i.left,
    status: i.left <= 0 ? 'Повернено' : i.dueDate && i.dueDate < today ? 'Прострочено' : 'Діє',
  }));
  const open = inflows.filter((i) => i.left > 0 && i.dueDate).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  return {
    deposited,
    returned: r2(returned),
    debt,
    overdue: r2(inflows.filter((i) => i.left > 0 && i.dueDate && i.dueDate < today).reduce((t, i) => t + i.left, 0)),
    nextDue: open[0]?.dueDate ?? null,
    limitLeft: limit != null ? r2(limit - debt) : null,
    /** Повернули більше, ніж внесено — помилка в даних */
    overpaid: debt < 0,
    states,
  };
}

export type PayableStatus = 'До сплати' | 'Частково' | 'Сплачено' | 'Прострочено' | 'Скасовано';

/** Залишок і статус рахунку до оплати. */
export function payableState(amount: number, paid: number, dueDate: string | null, today: string, cancelled = false) {
  const left = r2(Math.max(0, amount - paid));
  let status: PayableStatus;
  if (cancelled) status = 'Скасовано';
  else if (left <= 0) status = 'Сплачено';
  else if (dueDate && dueDate < today) status = 'Прострочено';
  else status = paid > 0 ? 'Частково' : 'До сплати';
  return { left, status };
}

/** «Призначення платежу» для банку. */
export function paymentPurpose(p: { purpose: string; invoice: string | null; vat: number; amount: number }, sum: number): string {
  const money = (n: number) => n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // при частковій оплаті ПДВ — пропорційно частці від суми рахунку
  const vat = p.vat > 0 ? `, у т.ч. ПДВ ${money(r2((p.vat * sum) / p.amount))} грн` : ', без ПДВ';
  return `Оплата ${p.purpose || 'за товари/послуги'}${p.invoice ? ` згідно рах. ${p.invoice}` : ''}${vat}`;
}

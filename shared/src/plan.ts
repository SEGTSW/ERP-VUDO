/** Розрахунок дат етапів плану (ТЗ 8.2). Дні календарні; етап без днів не малюється. */
import { addDays, daysBetween } from './format.js';

export interface TaskInput {
  id: number;
  /** Ланцюжок етапів — один на замовлення */
  orderId: number;
  idx: number;
  startDate: string | null;
  days: number | null;
  progress: number;
}

export interface TaskSchedule {
  planned: boolean;
  /** Початок (РРРР-ММ-ДД) */
  start: string;
  /** Кінець не включно: start + days */
  end: string | null;
  /** Останній день етапу */
  last: string | null;
  done: boolean;
  late: boolean;
  lateBy: number;
  prevId: number | null;
}

/**
 * Початок = дата вручну; інакше кінець попереднього запланованого етапу цього замовлення;
 * перший — від дати створення замовлення. Кінець = початок + дні.
 * Прострочено: виконано < 100 % і останній день минув; тоді наступні етапи — не раніше за сьогодні.
 */
export function schedule(tasks: TaskInput[], orderCreated: (orderId: number) => string, today: string): Map<number, TaskSchedule> {
  const res = new Map<number, TaskSchedule>();
  const byOrder = new Map<number, TaskInput[]>();
  for (const t of tasks) {
    const l = byOrder.get(t.orderId) ?? [];
    l.push(t);
    byOrder.set(t.orderId, l);
  }
  for (const [orderId, list] of byOrder) {
    list.sort((a, b) => a.idx - b.idx);
    let cur = orderCreated(orderId);
    let prev: number | null = null;
    for (const t of list) {
      if (!t.days) {
        res.set(t.id, { planned: false, start: t.startDate ?? cur, end: null, last: null, done: t.progress >= 100, late: false, lateBy: 0, prevId: prev });
        continue;
      }
      const start = t.startDate ?? cur;
      const end = addDays(start, t.days);
      const last = addDays(end, -1);
      const done = t.progress >= 100;
      const late = !done && last < today;
      res.set(t.id, { planned: true, start, end, last, done, late, lateBy: late ? daysBetween(last, today) : 0, prevId: prev });
      cur = done ? end : end > today ? end : today;
      prev = t.id;
    }
  }
  return res;
}

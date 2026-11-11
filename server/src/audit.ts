import { moneyAccess, type FinScope, type LogFolder, type RoleHolder } from '@vudo/shared';
import type { Db } from './db.js';

export interface LogEntryInput {
  userId: number | null;
  text: string;
  folder: LogFolder;
  /** Обов'язково для папки «Фінанси»: pay — бачить і менеджер, report — лише власник. */
  finScope?: FinScope;
  orderId?: number | null;
}

/** Пише запис у журнал. Викликати в тій самій транзакції, що й зміну. */
export async function writeLog(db: Db, e: LogEntryInput): Promise<void> {
  if ((e.folder === 'fin') !== (e.finScope != null)) {
    throw new Error(`audit: finScope обов'язковий лише для папки fin (${e.folder})`);
  }
  await db.query(`INSERT INTO audit_log (user_id, order_id, text, folder, fin_scope) VALUES ($1, $2, $3, $4, $5)`, [
    e.userId,
    e.orderId ?? null,
    e.text,
    e.folder,
    e.finScope ?? null,
  ]);
}

/**
 * SQL-умова видимості записів для ролі (alias таблиці — l):
 * власник — усе; менеджер — без звітних записів; виконавці — без папки «Фінанси».
 * Фільтрує сервер: заборонені записи взагалі не потрапляють у відповідь.
 */
export function visibleLogSql(u: RoleHolder): string {
  switch (moneyAccess(u)) {
    case 'report':
      return 'TRUE';
    case 'pay':
      return `(l.folder <> 'fin' OR l.fin_scope = 'pay')`;
    case 'none':
      return `l.folder <> 'fin'`;
  }
}

/** Значення для журналу: порожнє → «—». */
export const lv = (v: unknown): string => (v == null || v === '' ? '—' : String(v));

/** «поле: було → стало» для змінених полів. */
export function diffLine(label: string, before: unknown, after: unknown): string | null {
  return lv(before) === lv(after) ? null : `${label}: ${lv(before)} → ${lv(after)}`;
}

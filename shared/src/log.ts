/** Журнал дій і папки повідомлень (ТЗ розділ 12). Папку і рівень доступу ставить сервер у місці створення запису. */

export const LOG_FOLDERS = [
  ['fin', 'Фінанси'],
  ['issue', 'Брак і нестачі'],
  ['stock', 'Склад'],
  ['zamir', 'Замір'],
  ['order', 'Замовлення і статуси'],
  ['plan', 'Планування'],
  ['mont', 'Монтаж і доставка'],
  ['client', 'Клієнти'],
  ['files', 'Файли й коментарі'],
  ['other', 'Інше'],
] as const;

export type LogFolder = (typeof LOG_FOLDERS)[number][0];

/**
 * Рівень доступу до фінансового запису (лише для папки «Фінанси»):
 *  - pay — оплати, ціни, знижки, доставка, прорахунки, статуси з сумами: бачать менеджер і власник;
 *  - report — звітність (витрати, маржа, прибуток, облік, P&L, виплати, нарахування…): лише власник.
 */
export type FinScope = 'pay' | 'report';

export function folderLabel(folder: LogFolder, owner: boolean): string {
  if (folder === 'fin' && !owner) return 'Оплати';
  return LOG_FOLDERS.find((f) => f[0] === folder)?.[1] ?? 'Інше';
}

export const isLogFolder = (v: unknown): v is LogFolder =>
  typeof v === 'string' && LOG_FOLDERS.some((f) => f[0] === v);

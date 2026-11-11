/** Фінанси: статті, рядки P&L, правило пошуку рядка (ТЗ 10.1, 10.2, 10.8). */

export const ART_TYPES = ['Дохід', 'Витрата', 'Інвестиції+', 'Інвестиції-', 'Позика+', 'Позика-', 'Позика', 'Дивіденди'] as const;
export type ArtType = (typeof ART_TYPES)[number];

/** Статті з мінусом: суму вводять без знака, знак визначає стаття. */
export const NEG_TYPES: readonly ArtType[] = ['Витрата', 'Інвестиції-', 'Позика-', 'Дивіденди'];
export const typeSign = (t: string) => ((NEG_TYPES as readonly string[]).includes(t) ? -1 : 1);

export const PNL_LINES = [
  ['income', 'Дохід'],
  ['orderCost', 'Витрати на замовлення'],
  ['admin', 'Адміністративні витрати'],
  ['payroll', 'Фонд оплати праці'],
  ['other', 'Інші'],
  ['marketing', 'Маркетинг'],
  ['tax', 'Податки і збори'],
  ['logistics', 'Логістика'],
  ['collab', 'Співпраці'],
  ['credit', 'Кредити'],
  ['working', 'Оборотні кошти'],
  ['invPlus', 'Інвестиції +'],
  ['invMinus', 'Інвестиції −'],
  ['dividends', 'Дивіденди'],
  ['loan', 'Позика'],
  ['none', '— не в P&L (переказ, зведення)'],
] as const;
export type PnlLine = (typeof PNL_LINES)[number][0];
export const lineLabel = (l: string) => PNL_LINES.find((x) => x[0] === l)?.[1] ?? '—';

export const ACCOUNTS = ['Карта', 'Готівка'] as const;
export type Account = (typeof ACCOUNTS)[number];

export interface ArticleRule {
  type: string;
  cat: string;
  obj: string;
  line: string;
  hidden?: boolean;
}

/**
 * Рядок P&L для операції — найточніший збіг:
 * стаття + підстаття + об'єкт → стаття + підстаття (об'єкт порожній) → стаття + підстаття → стаття (підстаття порожня);
 * немає збігу — «не в P&L».
 */
export function findArticle<T extends ArticleRule>(arts: T[], type: string, cat: string, obj: string): T | undefined {
  const A = arts.filter((a) => !a.hidden);
  return (
    A.find((a) => a.type === type && a.cat === cat && a.obj !== '' && a.obj === obj) ??
    A.find((a) => a.type === type && a.cat === cat && a.obj === '') ??
    A.find((a) => a.type === type && a.cat === cat) ??
    A.find((a) => a.type === type && a.cat === '')
  );
}

export const lineFor = (arts: ArticleRule[], type: string, cat: string, obj: string): PnlLine =>
  (findArticle(arts, type, cat, obj)?.line as PnlLine | undefined) ?? 'none';

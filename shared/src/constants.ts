/** Довідники системи (ТЗ розділи 3, 4, 13). Назви — точно як у прототипі. */

export const STATUSES = [
  'Звернення',
  'Прорахунок',
  'Замір призначено',
  'Замір виконано',
  'Очікує рішення клієнта',
  'Проєктування',
  'Проєкт погоджено',
  'Договір / аванс отримано',
  'Закупівля матеріалів',
  'У виробництві',
  'Готово до відвантаження',
  'Доставка / монтаж призначено',
  'Змонтовано',
  'Закрито',
] as const;

export const REFUSAL = 'Відмова' as const;
export const CLAIM = 'Рекламація' as const;

export type MainStatus = (typeof STATUSES)[number];
export type Status = MainStatus | typeof REFUSAL | typeof CLAIM;

/** Усі 16 статусів у порядку перемикача: 14 основних, Рекламація, Відмова. */
export const ALL_STATUSES: readonly Status[] = [...STATUSES, CLAIM, REFUSAL];

export type StatusGroup = 'sale' | 'work' | 'field' | 'done' | 'bad';

/**
 * Порядок статусів погоджено із замовником (змінено відносно ТЗ v1.0):
 * до договору — 1–7 (прорахунок, замір, проєктування), договір — 8.
 */
export const CONTRACT_INDEX = 8;

/** Група статусу: 1–7 продажі (до договору), 8–11 робота, 12–13 виїзд, 14 закрито, Відмова/Рекламація — проблема. */
export function statusGroup(s: Status): StatusGroup {
  if (s === REFUSAL || s === CLAIM) return 'bad';
  const i = STATUSES.indexOf(s);
  if (i < CONTRACT_INDEX - 1) return 'sale';
  if (i < 11) return 'work';
  if (s === 'Закрито') return 'done';
  return 'field';
}

/** Порядковий номер статусу 1–14 (0 — для Відмови/Рекламації). */
export function statusIndex(s: Status): number {
  return STATUSES.indexOf(s as MainStatus) + 1;
}

export const ITEM_TYPES = ['шафа-купе', 'розпашна шафа', 'кухня', 'гардеробна', 'передпокій', 'інше'] as const;
export const SOURCES = ['сайт', 'Instagram', 'рекомендація', 'повторний клієнт', 'дизайнер', 'інше'] as const;
export const CLIENT_TYPES = ['фізособа', 'юрособа', 'дизайнер-партнер'] as const;
export const PAYMENT_TYPES = ['аванс', 'доплата', 'інше', 'повернення'] as const;
export const PAYMENT_METHODS = ['готівка', 'картка', 'рахунок'] as const;

export const PLAN_STAGES = ['Прорахунок', 'Замір', 'Конструктив', 'Збірка', 'Монтаж'] as const;
export type PlanStage = (typeof PLAN_STAGES)[number];

/** Компоненти собівартості виробу (6 сум). */
export const COMPONENTS = [
  ['korpus', 'Корпус'],
  ['facade', 'Фасади'],
  ['top', 'Стільниця'],
  ['furn', 'Фурнітура'],
  ['light', 'Підсвітка'],
  ['profile', 'Профіль'],
] as const;
export type ComponentKey = (typeof COMPONENTS)[number][0];
export type Components = Partial<Record<ComponentKey, number>>;

/** Норма днів у статусі за замовчуванням (ТЗ, таблиця розділу 4). */
export const DEFAULT_NORMS: Partial<Record<MainStatus, number>> = {
  'Звернення': 1,
  'Замір призначено': 3,
  'Прорахунок': 2,
  'Очікує рішення клієнта': 7,
  'Проєктування': 3,
  'Закупівля матеріалів': 5,
  'У виробництві': 14,
  'Готово до відвантаження': 3,
  'Доставка / монтаж призначено': 5,
};

export interface Settings {
  /** Мінімальний аванс для договору, % */
  avansPct: number;
  /** Наша націнка (робота і монтаж), % */
  markupPct: number;
  /** Бонус дизайнерам за замовчуванням, % */
  designerPct: number;
  /** Постійні витрати на замовлення, % від ціни (режим «вручну») */
  opexPct: number;
  /** Режим постійних витрат: авто зі списку або вручну */
  opexMode: 'auto' | 'fixed';
  /** Ставка менеджерів, % від продажів (null — не задана) */
  mgrPct: number | null;
  /** Норма днів у статусі; відсутній ключ = без норми */
  norms: Partial<Record<MainStatus, number>>;
}

export const DEFAULT_SETTINGS: Settings = {
  avansPct: 30,
  markupPct: 50,
  designerPct: 10,
  opexPct: 15,
  opexMode: 'auto',
  mgrPct: null,
  norms: DEFAULT_NORMS,
};

/** Обмеження файлів замовлення (ТЗ розділ 1). */
export const MAX_FILE_MB = 50;
export const FILE_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff', 'svg',
  'pdf', 'dwg', 'dxf', 'b3d', 'pro100', 'sto', 'zip', 'rar', 'doc', 'docx', 'xls', 'xlsx',
  'skp', '3ds', 'max',
] as const;

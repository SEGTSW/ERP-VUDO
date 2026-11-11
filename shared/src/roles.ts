/** Ролі, доступ і меню (ТЗ розділ 2). Цей модуль — єдине джерело правил і для сервера, і для інтерфейсу. */

export const ROLES = ['Адмін', 'Менеджер', 'Замірник', 'Конструктор', 'Технолог', 'Цех', 'Монтажник'] as const;
export type Role = (typeof ROLES)[number];

/** Коротко, що бачить роль (форма користувача, 13.1). */
export const ROLE_HINTS: Record<Role, string> = {
  'Адмін': 'власник: усе, включно з фінансовою звітністю',
  'Менеджер': 'замовлення, клієнти, CRM, прорахунки, оплати — без фінансової звітності',
  'Замірник': 'Мій день: заміри; замовлення — перегляд',
  'Конструктор': 'конструктив; замовлення — перегляд, склад залишків',
  'Технолог': 'технологія; замовлення — перегляд, склад залишків',
  'Цех': 'збірка; замовлення — перегляд, склад залишків',
  'Монтажник': 'Мій день: монтаж і доставка; замовлення — перегляд',
};

export interface RoleHolder {
  roles: readonly Role[];
}

const has = (u: RoleHolder, r: Role) => u.roles.includes(r);

/** Власник = роль Адмін: бачить усе, включно з фінансовою звітністю. */
export const isOwner = (u: RoleHolder) => has(u, 'Адмін');
/** Офіс (менеджер або власник): замовлення, прорахунки, оплати, налаштування, користувачі. */
export const isOffice = (u: RoleHolder) => has(u, 'Адмін') || has(u, 'Менеджер');
/** Виїзні виконавці: «Мій день». */
export const isField = (u: RoleHolder) => has(u, 'Монтажник') || has(u, 'Замірник');
/** Цех / конструктор / технолог: склад залишків. */
export const isShop = (u: RoleHolder) => has(u, 'Цех') || has(u, 'Конструктор') || has(u, 'Технолог');

/**
 * Рівень доступу до грошей:
 *  - report — уся фінансова звітність (лише власник);
 *  - pay — прорахунки, ціни, оплати і борги (менеджер);
 *  - none — жодних сум (виконавці).
 */
export type MoneyAccess = 'report' | 'pay' | 'none';
export function moneyAccess(u: RoleHolder): MoneyAccess {
  if (isOwner(u)) return 'report';
  if (isOffice(u)) return 'pay';
  return 'none';
}

export type Section =
  | 'myday' | 'orders' | 'crm' | 'plan' | 'stock' | 'clients' | 'finance'
  | 'stats' | 'time' | 'kb' | 'notes' | 'settings';

export interface NavItem {
  key: Section;
  label: string;
}

/** Меню у порядку з ТЗ (розділи 2 і 8А). Права визначає найширша роль. */
export function navFor(u: RoleHolder): NavItem[] {
  if (isOffice(u)) {
    return [
      { key: 'orders', label: 'Замовлення' },
      { key: 'crm', label: 'CRM' },
      { key: 'plan', label: 'Планування' },
      { key: 'stock', label: 'Склад залишків' },
      { key: 'myday', label: 'Виїзди' },
      { key: 'clients', label: 'Клієнти' },
      { key: 'finance', label: isOwner(u) ? 'Фінанси' : 'Оплати' },
      { key: 'stats', label: 'Аналітика' },
      { key: 'time', label: 'Табель' },
      { key: 'kb', label: 'База знань' },
      { key: 'notes', label: 'Повідомлення' },
      { key: 'settings', label: 'Налаштування' },
    ];
  }
  const items: NavItem[] = [];
  if (isField(u)) items.push({ key: 'myday', label: 'Мій день' });
  items.push({ key: 'orders', label: 'Замовлення' });
  if (isShop(u)) items.push({ key: 'stock', label: 'Склад залишків' });
  items.push({ key: 'plan', label: 'Планування' }, { key: 'kb', label: 'База знань' }, { key: 'notes', label: 'Повідомлення' });
  return items;
}

export const canSee = (u: RoleHolder, s: Section) => navFor(u).some((n) => n.key === s);

/** Розділ після входу за замовчуванням (ТЗ розділ 1). */
export function defaultStart(u: RoleHolder): Section {
  if (isOffice(u)) return 'orders';
  if (isField(u)) return 'myday';
  return 'orders';
}

/** Розділ після входу з урахуванням профілю: збережений, якщо він ще доступний. */
export function startSection(u: RoleHolder & { startSection?: string | null }): Section {
  const s = u.startSection as Section | null | undefined;
  return s && s !== 'settings' && canSee(u, s) ? s : defaultStart(u);
}

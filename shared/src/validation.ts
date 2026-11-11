/** Правила полів користувача (ТЗ 13.1). */

export const LOGIN_RE = /^[a-z0-9._-]{3,}$/;
/** У робочій системі пароль — щонайменше 8 символів. */
export const PASSWORD_MIN = 8;

export const normalizeLogin = (s: string) => s.trim().toLowerCase();

export const MSG = {
  badCredentials: 'Невірний логін або пароль',
  disabled: 'Доступ вимкнено. Зверніться до адміністратора.',
  loginRule: 'Логін: щонайменше 3 символи, латиниця, цифри, крапка, дефіс.',
  loginTaken: 'Такий логін уже зайнятий.',
  nameRequired: "Вкажіть ім'я.",
  rolesRequired: 'Виберіть хоча б одну роль.',
  passwordRule: `Пароль: щонайменше ${PASSWORD_MIN} символів.`,
  lastAdminOff: 'Не можна вимкнути останнього адміна.',
  lastAdminRole: 'Це останній адмін — роль «Адмін» прибрати не можна.',
  selfOff: 'Не можна вимкнути доступ самому собі.',
  pwWrongCurrent: 'Поточний пароль неправильний.',
  pwMismatch: 'Нові паролі не збігаються.',
  pwSame: 'Новий пароль такий самий, як старий.',
} as const;

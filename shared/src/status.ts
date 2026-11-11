/** Статуси і переходи (ТЗ розділ 4). Спільні для сервера (перевірка) і інтерфейсу (кнопки, вікна). */
import { CLAIM, CONTRACT_INDEX, REFUSAL, STATUSES, statusIndex, type PlanStage, type Status } from './constants.js';

/** Кнопки «Перевести в»: наступний крок, Відмова (до договору), Рекламація (після монтажу). */
export function nextStatuses(s: Status): Status[] {
  if (s === REFUSAL) return [];
  if (s === CLAIM) return ['Закрито'];
  const i = statusIndex(s);
  const r: Status[] = [];
  if (i < STATUSES.length) r.push(STATUSES[i]!);
  if (i < CONTRACT_INDEX) r.push(REFUSAL);
  if (i >= 13) r.push(CLAIM);
  return r;
}

/** Чи доступний статус у перемикачі (Відмова — лише до договору, Рекламація — лише з 13–14). */
export function switchAllowed(from: Status, to: Status): boolean {
  const i = statusIndex(from);
  if (to === REFUSAL) return from !== REFUSAL && i >= 1 && i < CONTRACT_INDEX;
  if (to === CLAIM) return from === CLAIM || i >= 13;
  return true;
}

export type MoveFieldKind = 'text' | 'date' | 'measurer' | 'installers' | 'check' | 'area';
export interface MoveField {
  key: 'address' | 'measureDate' | 'measurerId' | 'installDate' | 'installerIds' | 'ok' | 'refuseReason' | 'claimText' | 'claimFix';
  label: string;
  kind: MoveFieldKind;
}

/** Обов'язкові поля вікна переходу в цільовий статус. */
export function moveFields(from: Status, to: Status): MoveField[] {
  if (from === CLAIM && to === 'Закрито') return [{ key: 'claimFix', label: 'Як виправлено (рішення)', kind: 'area' }];
  switch (to) {
    case 'Замір призначено':
      return [
        { key: 'address', label: "Адреса об'єкта", kind: 'text' },
        { key: 'measureDate', label: 'Дата заміру', kind: 'date' },
        { key: 'measurerId', label: 'Замірник', kind: 'measurer' },
      ];
    case 'Проєкт погоджено':
      return [{ key: 'ok', label: 'Деталювання заповнене, проєкт погоджено з клієнтом', kind: 'check' }];
    case 'Доставка / монтаж призначено':
      return [
        { key: 'installDate', label: 'Дата доставки / монтажу', kind: 'date' },
        { key: 'installerIds', label: 'Монтажники', kind: 'installers' },
      ];
    case 'Змонтовано':
      return [{ key: 'ok', label: 'Монтаж виконано, фото результату додано у «Файли»', kind: 'check' }];
    case REFUSAL:
      return [{ key: 'refuseReason', label: 'Причина відмови', kind: 'area' }];
    case CLAIM:
      return [{ key: 'claimText', label: 'Опис проблеми', kind: 'area' }];
    default:
      return [];
  }
}

/** Перехід у статус ставить відповідному етапу плану 100 %. */
export const STATUS_COMPLETES: Partial<Record<Status, PlanStage>> = {
  'Замір виконано': 'Замір',
  'Очікує рішення клієнта': 'Прорахунок',
  'Проєкт погоджено': 'Конструктив',
  'Готово до відвантаження': 'Збірка',
  'Змонтовано': 'Монтаж',
};

/** Етап уже пройдено за статусом (створюється виконаним) — за статусом, що його завершує (STATUS_COMPLETES). */
export function stagePassed(s: Status, stage: PlanStage): boolean {
  if (s === CLAIM) return true;
  const by = Object.entries(STATUS_COMPLETES).find(([, st]) => st === stage)?.[0] as Status | undefined;
  return !!by && statusIndex(s) >= statusIndex(by);
}

/** Статус «після договору» (Договір і далі, або Рекламація). */
export const afterContract = (s: Status) => s === CLAIM || statusIndex(s) >= CONTRACT_INDEX;
/** Після монтажу (Змонтовано, Закрито, Рекламація). */
export const afterInstall = (s: Status) => s === CLAIM || statusIndex(s) >= 13;

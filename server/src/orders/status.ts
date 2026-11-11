/** Переходи статусів (ТЗ розділ 4): умови входу, вікна переходу, автоматичні дії. Уся перевірка — тут, на сервері. */
import {
  CLAIM,
  CONTRACT_INDEX,
  REFUSAL,
  STATUSES,
  STATUS_COMPLETES,
  kyivToday,
  money,
  moveFields,
  nextStatuses,
  statusIndex,
  switchAllowed,
  type MainStatus,
  type MoveField,
  type Settings,
  type Status,
} from '@vudo/shared';
import type pg from 'pg';
import { badRequest } from '../errors.js';
import { writeLog } from '../audit.js';
import { compute, type OrderAgg } from './repo.js';
import { completeStage, makeMissingPlans, syncMeasureTasks } from './plan.js';

/** Умова входу в статус; повертає текст, що зробити, або null. */
export function precheck(o: OrderAgg, to: Status, s: Settings): string | null {
  const { calc, items } = compute(o, s);
  switch (to) {
    case 'Замір виконано':
      if (!o.items.length && !o.files.length)
        return 'Додайте хоча б один виріб у вкладці «Попередній прорахунок» або прикріпіть фото/файл заміру.';
      return null;
    case 'Очікує рішення клієнта': {
      if (!o.items.length) return 'Додайте хоча б один виріб із ціною.';
      const no = o.items.filter((i) => !((items.get(i.id)?.price ?? 0) > 0));
      if (no.length) return `Немає ціни у виробах: ${no.map((i) => `«${i.name}»`).join(', ')}.`;
      return null;
    }
    case 'Договір / аванс отримано': {
      if (calc.price <= 0) return 'Ціна замовлення 0 грн — спершу вкажіть ціни виробів.';
      const need = Math.round(((calc.price * s.avansPct) / 100) * 100) / 100;
      if (calc.avans < need)
        return `Потрібен аванс щонайменше ${s.avansPct}% — ${money(need)}. Зараз внесено авансом ${money(calc.avans)}. Додайте оплату типу «аванс» у вкладці «Оплати».`;
      return null;
    }
    case 'Закрито':
      if (calc.debt > 0) return `Закрити не можна: борг клієнта ${money(calc.debt)}. Внесіть доплату у вкладці «Оплати».`;
      return null;
    default:
      return null;
  }
}

export interface MoveValues {
  address?: string;
  measureDate?: string;
  measurerId?: number;
  installDate?: string;
  installerIds?: number[];
  ok?: boolean;
  refuseReason?: string;
  claimText?: string;
  claimFix?: string;
}

export interface MoveRequest {
  to: Status;
  /** step — кнопка «Перевести в» / перетягування (лише дозволені кроки); jump — перемикач «Статус». */
  mode: 'step' | 'jump';
  values: MoveValues;
}

function checkFields(fields: MoveField[], v: MoveValues) {
  for (const f of fields) {
    const val = v[f.key];
    const empty =
      f.kind === 'check' ? val !== true : f.kind === 'installers' ? !Array.isArray(val) || !val.length : val == null || String(val).trim() === '';
    if (empty) throw badRequest(f.kind === 'check' ? `Підтвердьте: ${f.label.toLowerCase()}.` : `Заповніть поле «${f.label}».`, f.key);
  }
}

/** Перевіряє і виконує перехід. Викликати в транзакції з заблокованим замовленням. */
export async function moveStatus(
  c: pg.PoolClient,
  o: OrderAgg,
  req: MoveRequest,
  s: Settings,
  userId: number,
  validateUser: (id: number, role: 'Замірник' | 'Монтажник') => Promise<void>,
): Promise<string> {
  const from = o.status;
  const to = req.to;
  if (to === from) throw badRequest('Замовлення вже в цьому статусі.');
  const fi = statusIndex(from);
  const ti = statusIndex(to);

  if (req.mode === 'step') {
    const allowed = nextStatuses(from);
    if (!allowed.includes(to)) {
      throw badRequest(`Із «${from}» можна перейти лише в: ${allowed.map((x) => `«${x}»`).join(', ') || '—'}.`);
    }
    const err = precheck(o, to, s);
    if (err) throw badRequest(err);
  } else {
    if (to === REFUSAL && !switchAllowed(from, to)) throw badRequest('Відмова можлива лише до договору. Після договору — «Рекламація» або архів.');
    if (to === CLAIM && !switchAllowed(from, to)) throw badRequest('Рекламацію можна відкрити лише після монтажу.');
    if (fi > 0 && ti > fi) {
      for (let k = fi + 1; k <= ti; k++) {
        const err = precheck(o, STATUSES[k - 1]!, s);
        if (err) throw badRequest(`Щоб перейти в «${to}»: ${err}`);
      }
    } else if (to === 'Закрито' || (fi === 0 && ti > 0)) {
      // з Відмови/Рекламації в основний статус — перевіряємо умову цільового
      const err = precheck(o, to, s);
      if (err) throw badRequest(err);
    }
  }

  const fields = req.mode === 'jump' && fi > 0 && ti > 0 && ti < fi ? [] : moveFields(from, to);
  checkFields(fields, req.values);
  const v = req.values;
  if (v.measurerId != null && fields.some((f) => f.key === 'measurerId')) await validateUser(v.measurerId, 'Замірник');
  if (v.installerIds && fields.some((f) => f.key === 'installerIds')) for (const id of v.installerIds) await validateUser(id, 'Монтажник');

  const today = kyivToday();
  const { calc } = compute(o, s, today);
  const sets: string[] = ['status = $2', 'status_since = $3'];
  const params: unknown[] = [o.id, to, today];
  const set = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  for (const f of fields) {
    if (f.key === 'address') set('address', v.address!.trim());
    if (f.key === 'measureDate') set('measure_date', v.measureDate);
    if (f.key === 'measurerId') set('measurer_id', v.measurerId);
    if (f.key === 'installDate') set('install_date', v.installDate);
    if (f.key === 'installerIds') set('installer_ids', v.installerIds);
    if (f.key === 'refuseReason') set('refuse_reason', v.refuseReason!.trim());
    if (f.key === 'claimText') set('claim_text', v.claimText!.trim());
    if (f.key === 'claimFix') set('claim_text', `${o.claimText ?? ''} — Рішення: ${v.claimFix!.trim()}`);
  }

  // Пройдені статуси: від наступного після поточного до цільового (вперед) або лише цільовий.
  const crossed: Status[] = fi > 0 && ti > fi ? (STATUSES.slice(fi, ti) as MainStatus[]) : [to];

  const contractNow = (ti >= CONTRACT_INDEX || to === CLAIM) && !o.contractDate;
  if (contractNow) {
    set('contract_date', today);
    set('contract_price', calc.price);
  }
  if (to === 'Закрито') {
    set('closed_date', today);
    set('closed_cost', calc.cost);
  }
  await c.query(`UPDATE orders SET ${sets.join(', ')} WHERE id = $1`, params);

  const people = {
    id: o.id,
    status: to,
    managerId: o.managerId,
    measurerId: fields.some((f) => f.key === 'measurerId') ? v.measurerId! : o.measurerId,
    constructorId: o.constructorId,
    installerIds: fields.some((f) => f.key === 'installerIds') ? v.installerIds! : o.installerIds,
    measureDate: fields.some((f) => f.key === 'measureDate') ? v.measureDate! : o.measureDate,
  };
  if (fields.some((f) => f.key === 'measureDate')) await syncMeasureTasks(c, o.id, v.measureDate!);
  if (contractNow) {
    const made = await makeMissingPlans(c, people, today);
    if (made.length) {
      await writeLog(c, {
        userId,
        orderId: o.id,
        folder: 'plan',
        text: `Створено план етапів: ${made.join(', ')}. Відповідальні мають вказати кількість днів.`,
      });
    }
  }
  for (const cs of crossed) {
    const st = STATUS_COMPLETES[cs];
    if (st) await completeStage(c, o.id, st, today);
  }

  let text = `Статус «${from}» → «${to}»`;
  if (fi > 0 && ti > 0 && ti < fi) text += ' (повернуто назад)';
  if (crossed.length > 1) text += ` (пропущено етапів: ${crossed.length - 1})`;
  if (v.refuseReason && to === REFUSAL) text += `. Причина: ${v.refuseReason.trim()}`;
  if (v.claimText && to === CLAIM) text += `. Проблема: ${v.claimText.trim()}`;
  if (v.claimFix && from === CLAIM) text += `. Рішення: ${v.claimFix.trim()}`;
  await writeLog(c, { userId, orderId: o.id, folder: statusFolder(from, to), text });
  if (contractNow) {
    await writeLog(c, { userId, orderId: o.id, folder: 'fin', finScope: 'pay', text: `Договір: ціна зафіксована ${money(calc.price)}` });
  }

  // Записи-сповіщення менеджеру
  if (to === 'Замір виконано') await writeLog(c, { userId, orderId: o.id, folder: 'zamir', text: 'Сповіщення менеджеру: замір виконано' });
  if (to === 'Готово до відвантаження')
    await writeLog(c, { userId, orderId: o.id, folder: 'mont', text: 'Сповіщення менеджеру: готово до відвантаження' });
  if (to === 'Змонтовано') {
    if (calc.debt > 0)
      await writeLog(c, {
        userId,
        orderId: o.id,
        folder: 'fin',
        finScope: 'pay',
        text: `Сповіщення менеджеру: змонтовано, борг ${money(calc.debt)}`,
      });
    else await writeLog(c, { userId, orderId: o.id, folder: 'mont', text: 'Сповіщення менеджеру: змонтовано' });
  }
  return to;
}

/** Папка запису про зміну статусу (порядок ТЗ розділ 12): замір → монтаж і доставка → замовлення і статуси. */
function statusFolder(from: Status, to: Status): 'zamir' | 'mont' | 'order' {
  // Повернення з Рекламації («Як виправлено») — теж монтаж і доставка.
  const t = from === CLAIM ? `${from} ${to}` : to;
  if (/замір/i.test(t)) return 'zamir';
  if (/монтаж|змонтован|доставк|рекламац|відвантаж/i.test(t)) return 'mont';
  return 'order';
}

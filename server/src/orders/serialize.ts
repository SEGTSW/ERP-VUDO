/**
 * Форма даних замовлення для кожної ролі. Фільтрує сервер: заборонені поля в API не передаються взагалі.
 *  - офіс (менеджер, власник): усе, крім звітності; власник — ще маржа і чистий прибуток;
 *  - виконавці: жодних сум, цін, оплат; без файлів «Прорахунки / специфікації» та історії.
 */
import { afterContract, isOwner, kyivToday, money, statusIndex, type Settings } from '@vudo/shared';
import type { Db } from '../db.js';
import { visibleLogSql } from '../audit.js';
import type { User } from '../users.js';
import { compute, ownerFigures, taskSchedule, type OrderAgg } from './repo.js';

/** Відкриті проблеми (брак / нестача) замовлення — блок угорі картки. */
async function openIssues(db: Db, orderId: number) {
  const r = await db.query(
    `SELECT i.id, i.type, i.text, i.qty, i.urgent, i.status, i.created_at AS "createdAt", u.name AS "byName",
            it.name AS "itemName", i.photo_file_id AS "photoId"
       FROM issues i LEFT JOIN users u ON u.id = i.created_by LEFT JOIN items it ON it.id = i.item_id
      WHERE i.order_id = $1 AND i.status <> 'вирішено' ORDER BY i.id`,
    [orderId],
  );
  return r.rows;
}

/** Зі складу зарезервовано під замовлення. */
async function reserved(db: Db, orderId: number) {
  const r = await db.query(
    `SELECT id, kind, material, thick, w, h, qty, unit, place FROM stock_items WHERE res_order_id = $1 AND status = 'резерв' ORDER BY id`,
    [orderId],
  );
  return r.rows;
}

const firstName = (n: string | null | undefined) => (n ?? '—').split(' ')[0] ?? '—';
const ddmm = (d: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '—');

async function peopleNames(db: Db, ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const r = await db.query<{ id: number; name: string }>('SELECT id, name FROM users WHERE id = ANY($1)', [ids]);
  return new Map(r.rows.map((u) => [u.id, u.name]));
}

/** «Що далі» для картки CRM (ТЗ розділ 7). */
export function nextStep(o: OrderAgg, s: Settings, names: Map<number, string>, today = kyivToday()): { text: string; cls: '' | 'warn' | 'late' } {
  const { calc, late, items } = compute(o, s, today);
  if (o.status === 'Змонтовано' && calc.debt > 0) return { text: `Отримати доплату ${money(calc.debt)}`, cls: 'warn' };
  if (statusIndex(o.status) >= 6 && o.status !== 'Закрито') {
    const sch = taskSchedule(o, today);
    const open = o.tasks
      .filter((t) => t.progress < 100)
      .sort((a, b) => a.idx - b.idx || (sch.get(a.id)?.start ?? '').localeCompare(sch.get(b.id)?.start ?? ''));
    const t = open[0];
    if (t) {
      const r = sch.get(t.id)!;
      const who = firstName(t.assigneeName);
      return r.planned
        ? { text: `${t.stage} · ${who} · до ${ddmm(r.last)}${r.late ? ` (+${r.lateBy} дн.)` : ''}`, cls: r.late ? 'late' : '' }
        : { text: `${t.stage} · ${who} має вказати дні`, cls: 'warn' };
    }
  }
  const noPrice = !o.items.length || o.items.some((i) => !((items.get(i.id)?.price ?? 0) > 0));
  const installers = o.installerIds.map((id) => names.get(id)).filter(Boolean).join(', ');
  const map: Record<string, string> = {
    'Звернення': 'Призначити замір',
    'Замір призначено': `Замір ${ddmm(o.measureDate)}${o.measurerId ? ` · ${names.get(o.measurerId) ?? ''}` : ''}`,
    'Замір виконано': 'Зробити прорахунок',
    'Прорахунок': noPrice ? 'Вказати ціни виробів' : 'Надіслати пропозицію',
    'Очікує рішення клієнта': 'Зателефонувати клієнту',
    'Договір / аванс отримано': 'Передати в проєктування',
    'Готово до відвантаження': 'Призначити доставку й монтаж',
    'Доставка / монтаж призначено': `Монтаж ${ddmm(o.installDate)}${installers ? ` · ${installers}` : ''}`,
    'Змонтовано': 'Закрити замовлення',
    'Закрито': 'Завершено',
    'Рекламація': 'Вирішити рекламацію',
  };
  return { text: map[o.status] ?? 'Перевести на наступний етап', cls: late ? 'late' : '' };
}

/** Рядок списку / картка CRM для офісу. */
export async function officeList(db: Db, orders: OrderAgg[], s: Settings) {
  const today = kyivToday();
  const names = await peopleNames(db, [...new Set(orders.flatMap((o) => [...o.installerIds, o.measurerId ?? 0]))].filter(Boolean));
  return orders.map((o) => {
    const { calc, late } = compute(o, s, today);
    return {
      id: o.id,
      num: o.num,
      createdDate: o.createdDate,
      client: { id: o.client.id, name: o.client.name, phone: o.client.phone },
      status: o.status,
      statusSince: o.statusSince,
      late,
      managerId: o.managerId,
      managerName: o.managerName,
      source: o.source,
      archived: o.archived,
      itemNames: o.items.map((i) => i.name),
      price: calc.price,
      paid: calc.paid,
      debt: calc.debt,
      contractDate: o.contractDate,
      next: nextStep(o, s, names, today),
    };
  });
}

/** Рядок списку для виконавців (5.5). */
export function execList(orders: OrderAgg[], me: User) {
  return orders.map((o) => ({
    id: o.id,
    num: o.num,
    client: { name: o.client.name, phone: o.client.phone },
    address: o.address,
    status: o.status,
    itemNames: o.items.map((i) => i.name),
    myStages: o.tasks.filter((t) => t.assigneeId === me.id && t.progress < 100).map((t) => t.stage),
    installDate: o.installDate,
  }));
}

async function comments(db: Db, orderId: number) {
  const r = await db.query(
    `SELECT c.id, c.text, c.created_at AS "createdAt", u.name AS "byName"
       FROM order_comments c LEFT JOIN users u ON u.id = c.created_by WHERE c.order_id = $1 ORDER BY c.id DESC`,
    [orderId],
  );
  return r.rows;
}

function tasksView(o: OrderAgg) {
  const sch = taskSchedule(o);
  return o.tasks.map((t) => ({ ...t, itemName: o.items.find((i) => i.id === t.itemId)?.name ?? '', sched: sch.get(t.id)! }));
}

/** Останній день етапу «Монтаж» за планом працівників (підказка біля дати монтажу). */
function planInstall(o: OrderAgg): string | null {
  const sch = taskSchedule(o);
  let e: string | null = null;
  for (const t of o.tasks) {
    if (t.stage !== 'Монтаж') continue;
    const r = sch.get(t.id);
    if (r?.planned && r.last && (!e || r.last > e)) e = r.last;
  }
  return e;
}

const fileView = (f: OrderAgg['files'][number]) => ({
  id: f.id,
  category: f.category,
  name: f.name,
  size: f.size,
  mime: f.mime,
  createdAt: f.createdAt,
  byName: f.byName,
});

/** Повна картка замовлення для менеджера/власника. */
export async function officeCard(db: Db, o: OrderAgg, s: Settings, me: User) {
  const { calc, items, late } = compute(o, s);
  const history = await db.query(
    `SELECT l.id, l.at, l.text, COALESCE(u.name, 'Система') AS "byName"
       FROM audit_log l LEFT JOIN users u ON u.id = l.user_id
      WHERE l.order_id = $1 AND ${visibleLogSql(me)} ORDER BY l.id DESC`,
    [o.id],
  );
  const designer = o.designer
    ? { id: o.designer.id, name: o.designer.name, company: o.designer.company, phone: o.designer.phone, bonusPct: o.designer.bonusPct ?? s.designerPct }
    : null;
  return {
    view: 'office' as const,
    id: o.id,
    num: o.num,
    createdDate: o.createdDate,
    status: o.status,
    statusSince: o.statusSince,
    late,
    client: o.client,
    address: o.address,
    managerId: o.managerId,
    managerName: o.managerName,
    source: o.source,
    designer,
    measureDate: o.measureDate,
    measurerId: o.measurerId,
    constructorId: o.constructorId,
    installerIds: o.installerIds,
    readyDate: o.readyDate,
    installDate: o.installDate,
    planInstall: planInstall(o),
    delivery: o.delivery,
    discount: o.discount,
    discountType: o.discountType,
    contractDate: o.contractDate,
    contractPrice: o.contractPrice,
    closedDate: o.closedDate,
    refuseReason: o.refuseReason,
    claimText: o.claimText,
    comment: o.comment,
    archived: o.archived,
    items: o.items.map((i) => ({ ...i, calc: items.get(i.id)! })),
    payments: o.payments.map((p) => ({ id: p.id, sum: p.sum, type: p.type, method: p.method, date: p.date, comment: p.comment, byName: p.byName })),
    files: o.files.map(fileView),
    comments: await comments(db, o.id),
    tasks: tasksView(o),
    history: history.rows,
    issues: await openIssues(db, o.id),
    reserved: await reserved(db, o.id),
    sums: calc,
    owner: isOwner(me) ? ownerFigures(o, calc, s) : null,
    markupPct: s.markupPct,
  };
}

/** Картка для виконавців — лише перегляд, без жодних сум (5.5). */
export async function execCard(db: Db, o: OrderAgg, me: User) {
  const names = await peopleNames(db, [...o.installerIds, o.measurerId ?? 0].filter(Boolean));
  return {
    view: 'exec' as const,
    id: o.id,
    num: o.num,
    createdDate: o.createdDate,
    status: o.status,
    statusSince: o.statusSince,
    client: {
      name: o.client.name,
      phone: o.client.phone,
      messenger: o.client.messenger,
      email: o.client.email,
      addresses: o.client.addresses,
      comment: o.client.comment,
    },
    designer: o.source === 'дизайнер' && o.designer ? { name: o.designer.name, company: o.designer.company, phone: o.designer.phone } : null,
    address: o.address,
    managerName: o.managerName,
    comment: o.comment,
    measureDate: o.measureDate,
    measurerName: o.measurerId ? (names.get(o.measurerId) ?? null) : null,
    readyDate: o.readyDate,
    installDate: o.installDate,
    installerNames: o.installerIds.map((id) => names.get(id)).filter(Boolean),
    claimText: o.status === 'Рекламація' ? o.claimText : null,
    afterContract: afterContract(o.status),
    items: o.items.map((i) => ({ id: i.id, name: i.name, type: i.type, description: i.description })),
    files: o.files.filter((f) => f.category !== 'spec').map(fileView),
    comments: await comments(db, o.id),
    tasks: tasksView(o),
    myStages: o.tasks.filter((t) => t.assigneeId === me.id).map((t) => t.stage),
    issues: await openIssues(db, o.id),
    reserved: await reserved(db, o.id),
  };
}

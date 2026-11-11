/**
 * Завантаження замовлень разом із виробами, оплатами, файлами й етапами плану
 * та розрахунок сум за формулами ТЗ (розділ 14). Суми рахуються на сервері з первинних даних.
 */
import {
  calcItem,
  calcOrder,
  kyivToday,
  lateDays,
  netProfit,
  schedule,
  type Components,
  type ItemCalc,
  type OrderCalc,
  type PlanStage,
  type Settings,
  type Status,
  type TaskSchedule,
} from '@vudo/shared';
import type { Db } from '../db.js';

export interface ClientRef {
  id: number;
  name: string;
  phone: string | null;
  type: string;
  source: string | null;
  email: string | null;
  messenger: string | null;
  company: string | null;
  bonusPct: number | null;
  addresses: string[];
  comment: string | null;
  archived: boolean;
}

export interface ItemRow {
  id: number;
  orderId: number;
  name: string;
  type: string;
  description: string | null;
  pre: Components;
  exact: Components | null;
  designerPct: number | null;
  markupPct: number;
  createdAt: string;
}

export interface PaymentRow {
  id: number;
  orderId: number;
  sum: number;
  type: string;
  method: string;
  date: string;
  comment: string | null;
  createdAt: string;
  createdBy: number | null;
  byName: string | null;
}

export interface FileRow {
  id: number;
  orderId: number;
  category: 'design' | 'spec' | 'constr' | 'other';
  name: string;
  size: number;
  mime: string | null;
  createdAt: string;
  createdBy: number | null;
  byName: string | null;
}

export interface TaskRow {
  id: number;
  orderId: number;
  itemId: number;
  stage: PlanStage;
  idx: number;
  assigneeId: number | null;
  assigneeName: string | null;
  startDate: string | null;
  days: number | null;
  progress: number;
  comment: string | null;
}

export interface OrderRow {
  id: number;
  num: string;
  clientId: number;
  address: string | null;
  managerId: number;
  managerName: string;
  source: string | null;
  designerId: number | null;
  status: Status;
  statusSince: string;
  measureDate: string | null;
  measurerId: number | null;
  constructorId: number | null;
  installerIds: number[];
  readyDate: string | null;
  installDate: string | null;
  delivery: number;
  discount: number;
  discountType: 'грн' | '%';
  contractDate: string | null;
  contractPrice: number | null;
  closedDate: string | null;
  closedCost: number | null;
  opex: number | null;
  refuseReason: string | null;
  claimText: string | null;
  comment: string | null;
  archived: boolean;
  createdAt: string;
  createdDate: string;
}

export interface OrderAgg extends OrderRow {
  client: ClientRef;
  designer: ClientRef | null;
  items: ItemRow[];
  payments: PaymentRow[];
  files: FileRow[];
  tasks: TaskRow[];
}

export const CLIENT_COLS = (a: string) => `${a}.id, ${a}.name, ${a}.phone, ${a}.type, ${a}.source, ${a}.email, ${a}.messenger,
  ${a}.company, ${a}.bonus_pct AS "bonusPct", ${a}.addresses, ${a}.comment, ${a}.archived`;

const ORDER_COLS = `o.id, o.num, o.client_id AS "clientId", o.address, o.manager_id AS "managerId", m.name AS "managerName",
  o.source, o.designer_id AS "designerId", o.status, o.status_since AS "statusSince", o.measure_date AS "measureDate",
  o.measurer_id AS "measurerId", o.constructor_id AS "constructorId", o.installer_ids AS "installerIds",
  o.ready_date AS "readyDate", o.install_date AS "installDate", o.delivery, o.discount, o.discount_type AS "discountType",
  o.contract_date AS "contractDate", o.contract_price AS "contractPrice", o.closed_date AS "closedDate",
  o.closed_cost AS "closedCost", o.opex, o.refuse_reason AS "refuseReason", o.claim_text AS "claimText", o.comment,
  o.archived, o.created_at AS "createdAt", (o.created_at AT TIME ZONE 'Europe/Kyiv')::date AS "createdDate"`;

/** Завантажує замовлення за умовою (SQL з alias o) з усіма пов'язаними даними. */
export async function fetchOrders(db: Db, where: string, params: unknown[] = []): Promise<OrderAgg[]> {
  const r = await db.query<OrderRow>(
    `SELECT ${ORDER_COLS} FROM orders o JOIN users m ON m.id = o.manager_id WHERE ${where} ORDER BY o.id DESC`,
    params,
  );
  if (!r.rows.length) return [];
  const ids = r.rows.map((o) => o.id);
  const clientIds = [...new Set(r.rows.flatMap((o) => [o.clientId, o.designerId].filter((x): x is number => x != null)))];

  const [clients, items, payments, files, tasks] = await Promise.all([
    db.query<ClientRef>(`SELECT ${CLIENT_COLS('c')} FROM clients c WHERE c.id = ANY($1)`, [clientIds]),
    db.query<ItemRow>(
      `SELECT id, order_id AS "orderId", name, type, description, pre, exact, designer_pct AS "designerPct",
              markup_pct AS "markupPct", created_at AS "createdAt"
         FROM items WHERE order_id = ANY($1) ORDER BY id`,
      [ids],
    ),
    db.query<PaymentRow>(
      `SELECT p.id, p.order_id AS "orderId", p.sum, p.type, p.method, p.date, p.comment, p.created_at AS "createdAt",
              p.created_by AS "createdBy", u.name AS "byName"
         FROM payments p LEFT JOIN users u ON u.id = p.created_by WHERE p.order_id = ANY($1) ORDER BY p.date, p.id`,
      [ids],
    ),
    db.query<FileRow>(
      `SELECT f.id, f.order_id AS "orderId", f.category, f.name, f.size, f.mime, f.created_at AS "createdAt",
              f.created_by AS "createdBy", u.name AS "byName"
         FROM order_files f LEFT JOIN users u ON u.id = f.created_by WHERE f.order_id = ANY($1) ORDER BY f.id DESC`,
      [ids],
    ),
    db.query<TaskRow>(
      `SELECT t.id, t.order_id AS "orderId", t.item_id AS "itemId", t.stage, t.idx, t.assignee_id AS "assigneeId",
              u.name AS "assigneeName", t.start_date AS "startDate", t.days, t.progress, t.comment
         FROM plan_tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.order_id = ANY($1) ORDER BY t.item_id, t.idx`,
      [ids],
    ),
  ]);

  const cById = new Map(clients.rows.map((c) => [c.id, c]));
  const group = <T extends { orderId: number }>(rows: T[]) => {
    const m = new Map<number, T[]>();
    for (const x of rows) {
      const l = m.get(x.orderId);
      if (l) l.push(x);
      else m.set(x.orderId, [x]);
    }
    return m;
  };
  const gi = group(items.rows);
  const gp = group(payments.rows);
  const gf = group(files.rows);
  const gt = group(tasks.rows);

  return r.rows.map((o) => ({
    ...o,
    client: cById.get(o.clientId)!,
    designer: o.designerId ? (cById.get(o.designerId) ?? null) : null,
    items: gi.get(o.id) ?? [],
    payments: gp.get(o.id) ?? [],
    files: gf.get(o.id) ?? [],
    tasks: gt.get(o.id) ?? [],
  }));
}

export async function fetchOrder(db: Db, id: number, lock = false): Promise<OrderAgg | null> {
  if (lock) await db.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [id]);
  return (await fetchOrders(db, 'o.id = $1', [id]))[0] ?? null;
}

/* ---------- Розрахунки ---------- */

/** % бонусу дизайнера-партнера: лише джерело «дизайнер» і вибрано дизайнера (з картки, інакше з налаштувань). */
export function partnerBonusPct(o: OrderAgg, s: Settings): number | null {
  if (o.source !== 'дизайнер' || !o.designer) return null;
  return o.designer.bonusPct ?? s.designerPct;
}

export interface Computed {
  calc: OrderCalc;
  items: Map<number, ItemCalc>;
  late: number;
}

export function compute(o: OrderAgg, s: Settings, today = kyivToday()): Computed {
  const inputs = o.items.map((i) => ({ pre: i.pre, exact: i.exact, designerTakesPct: i.designerPct, markupPct: i.markupPct }));
  const calc = calcOrder(
    {
      items: inputs,
      delivery: o.delivery,
      discount: o.discount,
      discountType: o.discountType,
      payments: o.payments,
      partnerBonusPct: partnerBonusPct(o, s),
    },
    s.markupPct,
  );
  const items = new Map(o.items.map((i, k) => [i.id, calcItem(inputs[k]!, s.markupPct)]));
  return { calc, items, late: lateDays(o.statusSince, s.norms[o.status as keyof Settings['norms']], today) };
}

/** Постійні витрати замовлення: вказане вручну, інакше ціна × частка % (авто-частка з'явиться з розділом «Постійні витрати»). */
export const opexOf = (o: OrderAgg, price: number, s: Settings) =>
  o.opex != null ? o.opex : Math.round((price * s.opexPct) / 100);

/** Маржа і чистий прибуток (лише для власника). Фактичні витрати з обліку додадуться на етапі «Фінанси». */
export function ownerFigures(o: OrderAgg, c: OrderCalc, s: Settings) {
  const opex = opexOf(o, c.price, s);
  const np = netProfit({
    price: c.price,
    cost: c.cost,
    designer: c.designer,
    opex,
    materialsFact: 0,
    collabFact: 0,
    status: o.status,
  });
  return { margin: c.margin, marginPct: c.marginPct, opex, opexAuto: o.opex == null, netProfit: np.profit, netPct: np.pct };
}

export function taskSchedule(o: OrderAgg, today = kyivToday()): Map<number, TaskSchedule> {
  return schedule(o.tasks, () => o.createdDate, today);
}

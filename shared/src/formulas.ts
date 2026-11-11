/**
 * Формули ТЗ (розділ 14). Ціни виробів округлюються до гривні на кожному кроці.
 * На кожну формулу є автотест на прикладах розділу 15.1 (formulas.test.ts).
 */
import { COMPONENTS, type Components, type Status } from './constants.js';
import { daysBetween, round2 } from './format.js';

/* ---------- Виріб ---------- */

/** (1) Собівартість = корпус + фасади + стільниця + фурнітура + підсвітка + профіль. */
export function componentsSum(c: Components | null | undefined): number {
  if (!c) return 0;
  return COMPONENTS.reduce((s, [k]) => s + (Number(c[k]) || 0), 0);
}

/** (2) З нашою націнкою = собівартість × (1 + націнка % / 100), до гривні. */
export function withMarkup(cost: number, markupPct: number): number {
  return Math.round(cost * (1 + (Number(markupPct) || 0) / 100));
}

/** (3) Ціна = з націнкою × (1 + «дизайнер бере» % / 100), до гривні. */
export function priceFromCost(cost: number, markupPct: number, designerTakesPct: number): number {
  return Math.round(withMarkup(cost, markupPct) * (1 + (Number(designerTakesPct) || 0) / 100));
}

export interface ItemInput {
  /** Попередній прорахунок */
  pre: Components | null;
  /** Точний прорахунок (null або всі нулі — немає) */
  exact: Components | null;
  /** «Дизайнер бере з нас, %» */
  designerTakesPct: number | null;
  /** Націнка, зафіксована у виробі при збереженні прорахунку (інакше — з налаштувань) */
  markupPct?: number | null;
}

export interface ItemCalc {
  preCost: number;
  exactCost: number | null;
  /** Собівартість для розрахунків: точна, якщо є, інакше попередня */
  cost: number;
  prePrice: number;
  exactPrice: number | null;
  price: number;
  /** (4) Частка дизайнера в ціні виробу */
  designerShare: number;
}

export function calcItem(i: ItemInput, defaultMarkupPct: number): ItemCalc {
  const markupPct = i.markupPct ?? defaultMarkupPct;
  const dp = Number(i.designerTakesPct) || 0;
  const preCost = componentsSum(i.pre);
  const ex = componentsSum(i.exact);
  const exactCost = ex > 0 ? ex : null;
  const cost = exactCost ?? preCost;
  const prePrice = priceFromCost(preCost, markupPct, dp);
  const exactPrice = exactCost != null ? priceFromCost(exactCost, markupPct, dp) : null;
  const price = exactPrice ?? prePrice;
  return { preCost, exactCost, cost, prePrice, exactPrice, price, designerShare: price - withMarkup(cost, markupPct) };
}

/* ---------- Замовлення ---------- */

export interface PaymentInput {
  type: string;
  sum: number;
}

export interface OrderInput {
  items: ItemInput[];
  delivery: number | null;
  discount: number | null;
  discountType: 'грн' | '%';
  payments: PaymentInput[];
  /** % бонусу дизайнера-партнера; null — джерело не «дизайнер» або дизайнера не вибрано */
  partnerBonusPct: number | null;
}

export interface OrderCalc {
  /** (5) Σ цін виробів */
  items: number;
  gross: number;
  discount: number;
  /** (6) Ціна замовлення */
  price: number;
  /** (7) */
  paid: number;
  debt: number;
  avans: number;
  /** (8) */
  cost: number;
  /** (9) */
  partnerBonus: number;
  designerShares: number;
  /** (10) Дизайнеру (план) */
  designer: number;
  /** (11) Маржа (план) */
  margin: number;
  marginPct: number;
}

export const paymentSign = (type: string) => (type === 'повернення' ? -1 : 1);

export function calcOrder(o: OrderInput, markupPct: number): OrderCalc {
  const calcs = o.items.map((i) => calcItem(i, markupPct));
  const items = calcs.reduce((s, c) => s + c.price, 0);
  const gross = items + (Number(o.delivery) || 0);
  const discount = round2(o.discountType === '%' ? (gross * (Number(o.discount) || 0)) / 100 : Number(o.discount) || 0);
  const price = round2(Math.max(0, gross - discount));
  const paid = round2(o.payments.reduce((s, p) => s + paymentSign(p.type) * (Number(p.sum) || 0), 0));
  const avans = round2(o.payments.filter((p) => p.type === 'аванс').reduce((s, p) => s + (Number(p.sum) || 0), 0));
  const cost = calcs.reduce((s, c) => s + c.cost, 0);
  const partnerBonus = o.partnerBonusPct != null ? round2((price * o.partnerBonusPct) / 100) : 0;
  const designerShares = calcs.reduce((s, c) => s + c.designerShare, 0);
  const designer = Math.max(partnerBonus, designerShares);
  const margin = round2(price - cost - designer);
  return {
    items,
    gross,
    discount,
    price,
    paid,
    debt: round2(price - paid),
    avans,
    cost,
    partnerBonus,
    designerShares,
    designer,
    margin,
    marginPct: price ? (margin / price) * 100 : 0,
  };
}

export interface NetProfitInput {
  price: number;
  /** Собівартість за прорахунком */
  cost: number;
  /** Дизайнеру (план) */
  designer: number;
  /** Постійні витрати замовлення, грн */
  opex: number;
  /** Фактичні витрати-матеріали (усе, крім рядка P&L «Співпраці») */
  materialsFact: number;
  /** Фактичні «Співпраці» */
  collabFact: number;
  status: Status;
}

/** (14) Чистий прибуток (наш) і %. */
export function netProfit(n: NetProfitInput): { cost: number; designer: number; profit: number; pct: number } {
  const cost = n.status === 'Закрито' && n.materialsFact > 0 ? n.materialsFact : Math.max(n.cost, n.materialsFact);
  const designer = Math.max(n.designer, n.collabFact);
  const profit = round2(n.price - cost - designer - n.opex);
  return { cost, designer, profit, pct: n.price ? (profit / n.price) * 100 : 0 };
}

/** (15) Залишилось витратити = собівартість − матеріали факт. */
export const leftToSpend = (cost: number, materialsFact: number) => round2(cost - materialsFact);

/** Різниця точної і попередньої вартості: сума та % від попередньої з одним знаком. */
export function priceDiff(pre: number, exact: number): { diff: number; pct: number | null } {
  const diff = round2(exact - pre);
  return { diff, pct: pre ? Math.round((diff / pre) * 1000) / 10 : null };
}

/** (16) Прострочення = днів у статусі − норма (якщо > 0). */
export function lateDays(statusSince: string, norm: number | null | undefined, today: string): number {
  if (!norm) return 0;
  const d = daysBetween(statusSince.slice(0, 10), today);
  return d > norm ? d - norm : 0;
}

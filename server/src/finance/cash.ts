/**
 * Облік руху коштів (ТЗ 10.1): ручні операції + автоматичні рядки з оплат клієнтів
 * (і з виплат дизайнерам — з наступною частиною). Рядок P&L кожної операції — зі статейника.
 */
import { lineFor, type ArticleRule, type PnlLine } from '@vudo/shared';
import type { Db } from '../db.js';

export interface Article extends ArticleRule {
  id: number;
  defaultCp: string;
  toOrder: boolean;
  hidden: boolean;
}

export async function loadArticles(db: Db): Promise<Article[]> {
  const r = await db.query<Article>(
    `SELECT id, type, cat, obj, default_cp AS "defaultCp", line, to_order AS "toOrder", hidden FROM articles ORDER BY id`,
  );
  return r.rows;
}

export interface CashRow {
  /** «c12» — ручна операція, «p7» — оплата клієнта (не редагується тут) */
  key: string;
  opId: number | null;
  date: string;
  type: string;
  cat: string;
  obj: string;
  orderId: number | null;
  counterparty: string;
  note: string;
  account: 'Карта' | 'Готівка';
  sum: number;
  line: PnlLine;
  derived: null | 'оплата' | 'дизайнер';
  updatedAt: string | null;
  updatedByName: string | null;
}

/** Усі рядки обліку (новіші вгорі). where — умова на дату для обох джерел (alias x.date). */
export async function cashRows(db: Db, opts: { orderId?: number; from?: string; to?: string } = {}): Promise<CashRow[]> {
  const arts = await loadArticles(db);
  const p: unknown[] = [opts.orderId ?? null, opts.from ?? null, opts.to ?? null];
  const r = await db.query<Omit<CashRow, 'line'>>(
    `SELECT * FROM (
       SELECT 'c' || c.id AS key, c.id AS "opId", c.date, c.type, c.cat, c.obj, c.order_id AS "orderId", c.counterparty,
              c.note, c.account, c.sum, NULL AS derived, c.updated_at AS "updatedAt", u.name AS "updatedByName", c.id AS ord
         FROM cash_ops c LEFT JOIN users u ON u.id = c.updated_by
       UNION ALL
       SELECT 'p' || p.id, NULL, p.date,
              CASE WHEN p.type = 'повернення' THEN 'Витрата' ELSE 'Дохід' END, 'Замовлення',
              '№' || o.num || ' · ' || cl.name, o.id, 'Замовник',
              p.type || CASE WHEN coalesce(p.comment, '') <> '' THEN ' · ' || p.comment ELSE '' END,
              CASE WHEN p.method = 'готівка' THEN 'Готівка' ELSE 'Карта' END,
              CASE WHEN p.type = 'повернення' THEN -p.sum ELSE p.sum END,
              'оплата', NULL, NULL, p.id
         FROM payments p JOIN orders o ON o.id = p.order_id JOIN clients cl ON cl.id = o.client_id
     ) x
     WHERE ($1::bigint IS NULL OR x."orderId" = $1) AND ($2::date IS NULL OR x.date >= $2) AND ($3::date IS NULL OR x.date <= $3)
     ORDER BY x.date DESC, x.ord DESC`,
    p,
  );
  return r.rows.map((x) => ({ ...x, line: lineFor(arts, x.type, x.cat, x.obj) }));
}

/** Залишки за весь час: карта (картка + рахунок), готівка, разом. */
export async function balances(db: Db) {
  const r = await db.query<{ account: string; s: number }>(
    `SELECT account, sum(s)::numeric AS s FROM (
       SELECT account, sum AS s FROM cash_ops
       UNION ALL
       SELECT CASE WHEN method = 'готівка' THEN 'Готівка' ELSE 'Карта' END,
              CASE WHEN type = 'повернення' THEN -sum ELSE sum END FROM payments
     ) x GROUP BY account`,
  );
  const card = r.rows.find((x) => x.account === 'Карта')?.s ?? 0;
  const cash = r.rows.find((x) => x.account === 'Готівка')?.s ?? 0;
  return { card, cash, total: Math.round((card + cash) * 100) / 100 };
}

/**
 * Фактичні витрати замовлення (ТЗ 14, п. 12): усі витрати обліку з прив'язкою до замовлення;
 * «матеріали» — усе, крім рядка P&L «Співпраці»; «співпраці» — рядок «Співпраці».
 */
export async function orderFacts(db: Db, orderId: number) {
  const rows = (await cashRows(db, { orderId })).filter((r) => r.derived == null);
  let fact = 0;
  let materials = 0;
  let collab = 0;
  const byCat = new Map<string, number>();
  for (const r of rows) {
    if (r.sum >= 0) continue;
    const v = -r.sum;
    fact += v;
    if (r.line === 'collab') collab += v;
    else materials += v;
    byCat.set(r.cat || '—', (byCat.get(r.cat || '—') ?? 0) + v);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return { rows, fact: round(fact), materials: round(materials), collab: round(collab), byCat: [...byCat.entries()].map(([cat, sum]) => ({ cat, sum: round(sum) })) };
}

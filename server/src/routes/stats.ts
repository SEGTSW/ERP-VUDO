/**
 * 11. Аналітика — менеджер і власник; маржу бачить лише власник. Рахуються всі замовлення, разом з архівом.
 * Звернення — за датою створення; договір — за датою і ціною договору (без Відмов); відмова — за датою переходу в «Відмова».
 */
import { Router } from 'express';
import { z } from 'zod';
import { REFUSAL, afterInstall, daysBetween, isOwner, kyivToday } from '@vudo/shared';
import { pool } from '../db.js';
import { me, requireSection } from '../auth/middleware.js';
import { getSettings } from '../settings.js';
import { compute, fetchOrders, type OrderAgg } from '../orders/repo.js';

export const statsRouter = Router();

const MON = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'];

function range(period: string, today: string): [string, string, string] {
  const y = today.slice(0, 4);
  const m = Number(today.slice(5, 7));
  if (period === 'month') return [`${today.slice(0, 8)}01`, today, 'цей місяць'];
  if (period === 'quarter') return [`${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`, today, 'цей квартал'];
  if (period === 'all') return ['0000-01-01', today, 'весь час'];
  return [`${y}-01-01`, today, 'цей рік'];
}

statsRouter.get('/stats', requireSection('stats'), async (req, res) => {
  const period = z.enum(['month', 'quarter', 'year', 'all']).default('year').parse(req.query.period);
  const owner = isOwner(me(req));
  const today = kyivToday();
  const [from, to, label] = range(period, today);
  const inP = (d: string | null | undefined) => !!d && d >= from && d <= to;
  const s = await getSettings(pool);
  const all = await fetchOrders(pool, 'TRUE');
  const calc = new Map(all.map((o) => [o.id, compute(o, s)]));
  const price = (o: OrderAgg) => o.contractPrice ?? calc.get(o.id)!.calc.price;
  const margin = (o: OrderAgg) => calc.get(o.id)!.calc.margin;
  const sum = (os: OrderAgg[]) => os.reduce((t, o) => t + price(o), 0);
  const mar = (os: OrderAgg[]) => os.reduce((t, o) => t + margin(o), 0);

  const leads = all.filter((o) => inP(o.createdDate));
  const won = all.filter((o) => inP(o.contractDate) && o.status !== REFUSAL);
  const lost = all.filter((o) => o.status === REFUSAL && inP(o.statusSince));
  const wonSum = sum(won);
  // (22) Конверсія = звернення періоду з датою договору / усі звернення періоду × 100
  const conv = leads.length ? (leads.filter((o) => o.contractDate && o.status !== REFUSAL).length / leads.length) * 100 : null;

  // Договори по місяцях — завжди останні 12 місяців
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 12 + i, 1));
    const key = d.toISOString().slice(0, 7);
    const os = all.filter((o) => o.status !== REFUSAL && o.contractDate?.slice(0, 7) === key);
    return { key, label: MON[d.getUTCMonth()]!, y: d.getUTCFullYear(), n: os.length, v: sum(os) };
  });

  const group = (keyf: (o: OrderAgg) => string) => {
    const r = new Map<string, { name: string; leads: number; won: OrderAgg[]; wonFromLeads: number }>();
    for (const o of all) {
      const k = keyf(o);
      const e = r.get(k) ?? { name: k, leads: 0, won: [], wonFromLeads: 0 };
      if (inP(o.createdDate)) {
        e.leads++;
        if (o.contractDate && o.status !== REFUSAL) e.wonFromLeads++;
      }
      if (inP(o.contractDate) && o.status !== REFUSAL) e.won.push(o);
      r.set(k, e);
    }
    return [...r.values()]
      .filter((e) => e.leads || e.won.length)
      .map((e) => ({
        name: e.name,
        leads: e.leads,
        won: e.won.length,
        conv: e.leads ? (e.wonFromLeads / e.leads) * 100 : null,
        sum: sum(e.won),
        ...(owner ? { marginPct: sum(e.won) ? (mar(e.won) / sum(e.won)) * 100 : null } : {}),
      }))
      .sort((a, b) => b.sum - a.sum || b.leads - a.leads);
  };

  // Що продаємо: тип виробу, шт., сума цін виробів (без доставки і знижок)
  const types = new Map<string, { type: string; n: number; sum: number; cost: number }>();
  for (const o of won) {
    const k = calc.get(o.id)!.items;
    for (const i of o.items) {
      const e = types.get(i.type) ?? { type: i.type, n: 0, sum: 0, cost: 0 };
      e.n++;
      e.sum += k.get(i.id)!.price;
      e.cost += k.get(i.id)!.cost;
      types.set(i.type, e);
    }
  }

  const reasons = new Map<string, number>();
  for (const o of lost) {
    const k = (o.refuseReason ?? '').trim() || 'не вказано';
    reasons.set(k, (reasons.get(k) ?? 0) + 1);
  }
  const avgDays = (vals: (number | null)[]) => {
    const v = vals.filter((x): x is number => x != null && x >= 0);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };

  res.json({
    label,
    leads: leads.length,
    wonCount: won.length,
    wonSum,
    avg: won.length ? wonSum / won.length : 0,
    ...(owner ? { margin: mar(won), marginPct: wonSum ? (mar(won) / wonSum) * 100 : null } : {}),
    conv,
    lost: lost.length,
    months,
    sources: group((o) => o.source ?? 'не вказано'),
    managers: group((o) => o.managerName),
    types: [...types.values()]
      .sort((a, b) => b.sum - a.sum)
      .map((t) => ({ type: t.type, n: t.n, sum: t.sum, ...(owner ? { marginPct: t.sum ? ((t.sum - t.cost) / t.sum) * 100 : null } : {}) })),
    reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([reason, n]) => ({ reason, n })),
    leadToContract: avgDays(won.map((o) => daysBetween(o.createdDate, o.contractDate!))),
    contractToInstall: avgDays(
      all.filter((o) => inP(o.contractDate) && afterInstall(o.status) && (o.installDate || o.closedDate)).map((o) => daysBetween(o.contractDate!, (o.installDate ?? o.closedDate)!)),
    ),
  });
});

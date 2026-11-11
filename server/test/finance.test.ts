import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { kyivToday } from '@vudo/shared';
import { pool } from '../src/db.js';
import { loginAs, logTexts, makeUser, resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => pool.end());

const today = kyivToday();
const norm = (t: string) => t.replace(/\s/g, ' ');

async function setup() {
  const ids = { admin: await makeUser('admin', ['Адмін'], { name: 'Власник' }), iryna: await makeUser('iryna', ['Менеджер'], { name: 'Ірина' }) };
  const a = await loginAs('admin');
  const o = (await a.post('/api/orders', { phone: '+380671112233', name: 'Олена', source: 'сайт', managerId: ids.iryna })).body;
  // ціна 15 000, собівартість 10 000
  await a.post(`/api/orders/${o.id}/items`, { name: 'Шафа', type: 'інше', description: '', pre: { korpus: 10000 }, designerPct: null });
  await a.post(`/api/orders/${o.id}/payments`, { sum: 6000, type: 'аванс', method: 'готівка', date: today });
  return { ids, a, o };
}

const expense = (orderId: number | null, amount: number, extra: object = {}) => ({
  date: today, type: 'Витрата', cat: 'Замовлення', obj: '', orderId, counterparty: 'Віяр', note: 'ДСП', account: 'Карта', amount, ...extra,
});

describe('облік (10.1)', () => {
  it('лише власник; менеджеру сервер не віддає облік навіть за прямим посиланням', async () => {
    await setup();
    const m = await loginAs('iryna');
    expect((await m.get('/api/finance/cash')).status).toBe(403);
    expect((await m.get('/api/finance/articles')).status).toBe(403);
    expect((await m.post('/api/finance/cash', expense(null, 100))).status).toBe(403);
  });

  it('витрата на замовлення: знак за статтею, об’єкт «№ · клієнт», оплата — автоматичний рядок; залишки по касах', async () => {
    const { a, o } = await setup();
    expect((await a.post('/api/finance/cash', expense(o.id, 4000))).status).toBe(201);
    expect((await a.post('/api/finance/cash', expense(null, 100))).body.error).toBe('Виберіть замовлення.');
    const r = (await a.get('/api/finance/cash')).body;
    const exp = r.rows.find((x: { derived: string | null }) => !x.derived);
    expect(exp).toMatchObject({ sum: -4000, obj: `№${o.num} · Олена`, line: 'orderCost', account: 'Карта' });
    const pay = r.rows.find((x: { derived: string | null }) => x.derived === 'оплата');
    expect(pay).toMatchObject({ sum: 6000, type: 'Дохід', cat: 'Замовлення', account: 'Готівка', line: 'income', counterparty: 'Замовник' });
    expect(r.balances).toEqual({ card: -4000, cash: 6000, total: 2000 });
    expect(r).toMatchObject({ inflow: 6000, outflow: -4000 });
    expect(norm((await logTexts()).at(-1)!)).toBe('Облік: Витрата/Замовлення -4 000 грн · ДСП'.replace('-', '−').replace('−', '-'));
  });

  it('редагування: «поле: було → стало» у журналі й історії замовлення; видалення', async () => {
    const { a, o } = await setup();
    await a.post('/api/finance/cash', expense(o.id, 4000));
    const id = (await a.get('/api/finance/cash')).body.rows.find((x: { derived: string | null }) => !x.derived).opId;
    expect((await a.patch(`/api/finance/cash/${id}`, expense(o.id, 4000))).body.error).toBe('Змін немає.');
    expect((await a.patch(`/api/finance/cash/${id}`, expense(o.id, 4500, { account: 'Готівка' }))).status).toBe(200);
    const t = norm((await logTexts()).at(-1)!);
    expect(t).toMatch(/^Облік: змінено операцію від \d\d\.\d\d\.\d{4} \(Замовлення · ДСП\) — каса: Карта → Готівка; сума: -?4 000 грн → -?4 500 грн$/);
    const card = (await a.get(`/api/orders/${o.id}`)).body;
    expect(norm(card.history[0].text)).toBe(t);
    const del = await a.agent.delete(`/api/finance/cash/${id}`).set('X-VUDO', '1');
    expect(del.status).toBe(200);
    expect((await a.get('/api/finance/cash')).body.rows.filter((x: { derived: string | null }) => !x.derived)).toHaveLength(0);
  });

  it('звітні записи обліку не бачить менеджер у Повідомленнях', async () => {
    const { a, o } = await setup();
    await a.post('/api/finance/cash', expense(o.id, 4000));
    const m = await loginAs('iryna');
    const texts = ((await m.get('/api/log')).body.entries as { text: string }[]).map((e) => e.text);
    expect(texts.some((t) => t.startsWith('Облік'))).toBe(false);
  });
});

describe('статейник (10.8)', () => {
  it('рядок P&L — найточніший збіг; зміна рядка одразу переносить операції', async () => {
    const { a } = await setup();
    await a.post('/api/finance/cash', { date: today, type: 'Витрата', cat: 'Адміністративні', obj: 'Цех', orderId: null, counterparty: '', note: 'Оренда', account: 'Карта', amount: 18000 });
    let row = (await a.get('/api/finance/cash')).body.rows.find((x: { cat: string }) => x.cat === 'Адміністративні');
    expect(row).toMatchObject({ line: 'admin', counterparty: 'Оренда', sum: -18000 });
    const arts = (await a.get('/api/finance/articles')).body;
    const art = arts.find((x: { cat: string; obj: string }) => x.cat === 'Адміністративні' && x.obj === 'Цех');
    expect(art.ops).toBe(1);
    await a.patch(`/api/finance/articles/${art.id}`, { line: 'other' });
    row = (await a.get('/api/finance/cash')).body.rows.find((x: { cat: string }) => x.cat === 'Адміністративні');
    expect(row.line).toBe('other');
    expect((await a.post('/api/finance/articles', { type: 'Витрата', cat: 'Адміністративні', obj: 'Цех', line: 'admin' })).body.error).toMatch(/уже є/);
  });
});

describe('витрати замовлення і чистий прибуток (5.4, 14)', () => {
  it('факт більший за план — собівартість за фактом; «Співпраці» йдуть у дизайнера', async () => {
    const { a, o } = await setup();
    await a.post('/api/finance/cash', expense(o.id, 12000));
    await a.post('/api/finance/cash', { ...expense(o.id, 500), cat: 'Співпраці', obj: 'Виплата', note: 'дизайнеру' });
    const c = (await a.get(`/api/finance/orders/${o.id}/costs`)).body;
    expect(c).toMatchObject({ fact: 12500, materials: 12000, collab: 500, plan: 10000, left: -2000, price: 15000 });
    // 15 000 − 12 000 (факт) − 500 (співпраці) − 2 250 (15 % постійних) = 250
    expect(c.figures).toMatchObject({ netCost: 12000, netCostSrc: 'факт (більше плану)', netDesigner: 500, opex: 2250, netProfit: 250 });
    await a.patch(`/api/finance/orders/${o.id}/opex`, { opex: 1000 });
    expect((await a.get(`/api/orders/${o.id}`)).body.owner.netProfit).toBe(1500);
    const m = await loginAs('iryna');
    expect((await m.get(`/api/finance/orders/${o.id}/costs`)).status).toBe(403);
  });
});

describe('P&L (10.2)', () => {
  it('факт за рядками статейника; план; залишок на кінець місяця', async () => {
    const { a, o } = await setup();
    await a.post('/api/finance/cash', expense(o.id, 4000));
    await a.post('/api/finance/cash', { date: today, type: 'Дохід', cat: 'Інші', obj: 'Обмін коштів', orderId: null, counterparty: '', note: '', account: 'Готівка', amount: 1000 });
    const m = today.slice(0, 7);
    expect((await a.agent.put('/api/finance/pnl/plan').set('X-VUDO', '1').send({ month: m, line: 'income', amount: 500000 })).status).toBe(200);
    const p = (await a.get(`/api/finance/pnl?year=${today.slice(0, 4)}`)).body;
    // дохід — оплата 6 000; витрати на замовлення −4 000; обмін коштів — «не в P&L», але в грошовому потоці
    expect(p.fact[m]).toMatchObject({ income: 6000, orderCost: -4000, none: 1000, net: 3000 });
    expect(p.plan[m]).toEqual({ income: 500000 });
    expect(p.opening).toBe(0);
    expect(norm((await logTexts()).at(-1)!)).toBe(`P&L план ${m} · Дохід: — → 500 000 грн`);
    const mgr = await loginAs('iryna');
    expect((await mgr.get('/api/finance/pnl')).status).toBe(403);
  });
});

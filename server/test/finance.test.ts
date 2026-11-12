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

describe('оплати, борги, дизайнерам, нарахування (10.3–10.6)', () => {
  it('оплати і борги бачить менеджер; борг — лише після договору', async () => {
    const { a, o } = await setup();
    const m = await loginAs('iryna');
    const p = (await m.get('/api/money/payments')).body;
    expect(p).toMatchObject({ total: 6000, count: 1, byMethod: { готівка: 6000 } });
    expect((await m.get('/api/money/debts')).body.rows).toHaveLength(0); // ще без договору
    await a.post(`/api/orders/${o.id}/status`, { to: 'Договір / аванс отримано', mode: 'jump' });
    const d = (await m.get('/api/money/debts')).body;
    expect(d.rows[0]).toMatchObject({ num: o.num, price: 15000, paid: 6000, debt: 9000, afterInstall: false });
    expect(d.total).toBe(9000);
    expect((await m.get('/api/money/designers')).status).toBe(403);
    expect((await m.get('/api/money/salaries')).status).toBe(403);
  });

  it('бонус дизайнеру нараховується з договором; виплата — в обліку як «Співпраці»', async () => {
    const { a, ids } = await setup();
    const des = (await a.post('/api/clients', { name: 'Оксана', type: 'дизайнер-партнер', company: 'Простір', bonusPct: 10 })).body;
    const o = (await a.post('/api/orders', { phone: '+380501112233', name: 'Ігор', source: 'дизайнер', designerId: des.id, managerId: ids.iryna })).body;
    await a.post(`/api/orders/${o.id}/items`, { name: 'Кухня', type: 'кухня', description: '', pre: { korpus: 20000 }, designerPct: null });
    let r = (await a.get('/api/money/designers')).body;
    expect(r.rows[0]).toMatchObject({ label: 'Оксана · Простір', accrued: 0, expected: 3000, contracts: 0 });
    await a.post(`/api/orders/${o.id}/payments`, { sum: 15000, type: 'аванс', method: 'картка', date: today });
    await a.post(`/api/orders/${o.id}/status`, { to: 'Договір / аванс отримано', mode: 'jump' });
    r = (await a.get('/api/money/designers')).body;
    expect(r.rows[0]).toMatchObject({ accrued: 3000, paid: 0, owe: 3000, contracts: 1, sales: 30000 });
    await a.post(`/api/money/designers/${des.id}/payouts`, { sum: 3000, method: 'рахунок', date: today });
    r = (await a.get('/api/money/designers')).body;
    expect(r.rows[0]).toMatchObject({ paid: 3000, owe: 0 });
    expect(r.paidThisMonth).toBe(3000);
    const cash = (await a.get('/api/finance/cash')).body;
    expect(cash.rows.find((x: { derived: string | null }) => x.derived === 'дизайнер')).toMatchObject({ sum: -3000, cat: 'Співпраці', line: 'collab', counterparty: 'Оксана · Простір' });
  });

  it('нарахування менеджерам: сума договорів × ставка', async () => {
    const { a, o } = await setup();
    await a.post(`/api/orders/${o.id}/status`, { to: 'Договір / аванс отримано', mode: 'jump' });
    let r = (await a.get('/api/money/salaries')).body;
    expect(r.rows.find((x: { name: string }) => x.name === 'Ірина')).toMatchObject({ contracts: 1, sales: 15000, pay: null });
    await a.patch('/api/settings', { mgrPct: 3 });
    r = (await a.get('/api/money/salaries')).body;
    expect(r.rows.find((x: { name: string }) => x.name === 'Ірина').pay).toBe(450);
    expect(r.total).toBe(450);
  });
});

describe('постійні витрати (10.7, формула 13)', () => {
  it('сума на місяць за періодичністю; «Сплатити» рахується за місяць; авто-частка від плану доходу', async () => {
    const { a, o } = await setup();
    let f = (await a.get('/api/finance/fixed')).body;
    // стартовий список: 165 900 + 9 000 / 3 (квартал) = 168 900... перевіряємо формулу на одному пункті
    const tool = f.rows.find((x: { name: string }) => x.name === 'Обслуговування інструменту');
    expect(tool).toMatchObject({ period: 'quarter', perMonth: 3000 });
    const rent = f.rows.find((x: { name: string }) => x.name === 'Оренда цеху');
    await a.post('/api/finance/cash', { date: today, type: 'Витрата', cat: rent.cat, obj: rent.obj, orderId: null, counterparty: 'Оренда', note: rent.name, account: 'Карта', amount: 18000, fixedId: rent.id });
    f = (await a.get('/api/finance/fixed')).body;
    expect(f.rows.find((x: { id: number }) => x.id === rent.id).paid).toBe(18000);
    // вимкнений пункт не рахується
    const before = f.total;
    await a.patch(`/api/finance/fixed/${tool.id}`, { active: false });
    f = (await a.get('/api/finance/fixed')).body;
    expect(f.total).toBe(before - 3000);
    // авто-частка: постійні на місяць / план доходу поточного місяця
    await a.agent.put('/api/finance/pnl/plan').set('X-VUDO', '1').send({ month: today.slice(0, 7), line: 'income', amount: f.total * 4 });
    f = (await a.get('/api/finance/fixed')).body;
    expect(f.info).toMatchObject({ autoPct: 25, pct: 25, base: { src: 'план доходу на цей місяць' } });
    // замовлення без ручних постійних — бере 25 %: 15 000 × 25 % = 3 750
    expect((await a.get(`/api/orders/${o.id}`)).body.owner.opex).toBe(3750);
    // режим «вручну» — % з налаштувань
    await a.patch('/api/settings', { opexMode: 'fixed' });
    expect((await a.get(`/api/orders/${o.id}`)).body.owner.opex).toBe(2250);
  });

  it('«Перенести в план P&L на 12 міс.» — суми на місяць за рядками', async () => {
    const { a } = await setup();
    expect((await a.post('/api/finance/fixed/to-plan')).body).toMatchObject({ ok: true, months: 12 });
    const p = (await a.get(`/api/finance/pnl?year=${today.slice(0, 4)}`)).body;
    const m = today.slice(0, 7);
    // ФОП 95 000 (Фіксована зарплата), маркетинг 6 000
    expect(p.plan[m]).toMatchObject({ payroll: 95000, marketing: 6000 });
  });
});

describe('аналітика (11)', () => {
  it('звернення, договори, середній чек, конверсія; маржа лише власнику; виконавцям — 403', async () => {
    const { a, o, ids } = await setup();
    const o2 = (await a.post('/api/orders', { phone: '+380509998877', name: 'Ігор', source: 'Instagram', managerId: ids.iryna })).body;
    await a.post(`/api/orders/${o2.id}/status`, { to: 'Відмова', mode: 'step', values: { refuseReason: 'Дорого' } });
    await a.post(`/api/orders/${o.id}/status`, { to: 'Договір / аванс отримано', mode: 'jump' });
    const st = (await a.get('/api/stats?period=month')).body;
    expect(st).toMatchObject({ leads: 2, wonCount: 1, wonSum: 15000, avg: 15000, conv: 50, lost: 1, margin: 5000 });
    expect(st.months).toHaveLength(12);
    expect(st.months.at(-1)).toMatchObject({ n: 1, v: 15000 });
    expect(st.sources.find((x: { name: string }) => x.name === 'сайт')).toMatchObject({ leads: 1, won: 1, conv: 100, sum: 15000 });
    expect(st.types[0]).toMatchObject({ type: 'інше', n: 1, sum: 15000 });
    expect(st.reasons).toEqual([{ reason: 'Дорого', n: 1 }]);
    const m = (await (await loginAs('iryna')).get('/api/stats?period=month')).body;
    expect(m).not.toHaveProperty('margin');
    expect(JSON.stringify(m)).not.toContain('marginPct');
    await makeUser('roman', ['Цех']);
    expect((await (await loginAs('roman')).get('/api/stats')).status).toBe(403);
  });
});

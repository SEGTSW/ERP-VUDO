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
    expect(r.balances).toEqual({ by: { 'Готівка': 6000, 'ТОВ': 0, 'Карта': -4000, 'ФОП': 0 }, total: 2000, usd: { usd: 0, uah: 0 } });
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

  it('борги без замовлень: менеджер додає, повернення йде доходом в облік, списання', async () => {
    const { a } = await setup();
    const m = await loginAs('iryna');
    expect((await m.post('/api/money/other-debts', { debtor: 'Петро', reason: 'позика', amount: 1000.55, date: '2026-11-01', dueDate: '2026-11-10' })).status).toBe(201);
    let d = (await m.get('/api/money/debts')).body;
    expect(d.other[0]).toMatchObject({ debtor: 'Петро', amount: 1000.55, left: 1000.55, status: 'Прострочено' });
    expect(d.otherTotal).toBe(1000.55);
    const id = d.other[0].id;
    expect((await m.post(`/api/money/other-debts/${id}/pay`, { date: '2026-11-20', sum: 2000, account: 'Готівка' })).status).toBe(400);
    expect((await m.post(`/api/money/other-debts/${id}/pay`, { date: '2026-11-20', sum: 400.55, account: 'Готівка' })).status).toBe(201);
    d = (await m.get('/api/money/debts')).body;
    expect(d.other[0]).toMatchObject({ paid: 400.55, left: 600, status: 'Прострочено' });
    const cash = (await a.get('/api/finance/cash?month=')).body;
    expect(cash.rows.find((r: { counterparty: string }) => r.counterparty === 'Петро')).toMatchObject({ type: 'Дохід', cat: 'Інші', sum: 400.55, account: 'Готівка' });
    expect((await m.del(`/api/money/other-debts/${id}`)).status).toBe(400); // є повернення
    expect((await m.patch(`/api/money/other-debts/${id}`, { writtenOff: true })).status).toBe(200);
    d = (await m.get('/api/money/debts')).body;
    expect(d.other[0].status).toBe('Списано');
    expect(d.otherTotal).toBe(0);
    await m.del(`/api/money/other-debt-payments/${d.other[0].payments[0].id}`);
    expect((await a.get('/api/finance/cash?month=')).body.rows.some((r: { counterparty: string }) => r.counterparty === 'Петро')).toBe(false);
    expect((await m.del(`/api/money/other-debts/${id}`)).status).toBe(200);
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
    await a.post(`/api/money/designers/${des.id}/payouts`, { sum: 3000, method: 'рахунок ТОВ', date: today });
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
    // усі активні працівники; без % — не продавцям; вимкнені не показуються
    await makeUser('roman', ['Цех'], { name: 'Роман' });
    await makeUser('old', ['Монтажник'], { name: 'Звільнений', disabled: true });
    r = (await a.get('/api/money/salaries')).body;
    expect(r.rows.find((x: { name: string }) => x.name === 'Роман')).toMatchObject({ roles: ['Цех'], seller: false, pay: null });
    expect(r.rows.some((x: { name: string }) => x.name === 'Звільнений')).toBe(false);
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

describe('валютна каса USD', () => {
  it('операція в доларах з курсом, залишок окремо, обмін валюти, P&L у гривнях', async () => {
    const { a } = await setup();
    expect((await a.post('/api/finance/cash', { date: '2026-11-20', type: 'Витрата', cat: 'Маркетинг', obj: 'Фейсбук', account: 'USD', amount: 100 })).status).toBe(400); // без курсу
    expect((await a.post('/api/finance/cash/exchange', { date: '2026-11-19', direction: 'buy', account: 'Готівка', usd: 1000, rate: 41.25 })).status).toBe(201);
    expect((await a.post('/api/finance/cash', { date: '2026-11-20', type: 'Витрата', cat: 'Маркетинг', obj: 'Фейсбук', account: 'USD', amount: 100.5, rate: 42 })).status).toBe(201);
    const cash = (await a.get('/api/finance/cash?month=')).body;
    expect(cash.balances.usd).toEqual({ usd: 899.5, uah: 41250 - 4221 });
    expect(cash.balances.by['Готівка']).toBe(6000 - 41250);
    expect(cash.balances.total).toBe(6000 - 41250); // без долара
    const fb = cash.rows.find((x: { cat: string; account: string }) => x.account === 'USD' && x.cat === 'Маркетинг');
    expect(fb).toMatchObject({ usd: -100.5, rate: 42, sum: -4221, line: 'marketing' });
    const ex = cash.rows.filter((x: { obj: string }) => x.obj === 'Обмін коштів');
    expect(ex.map((x: { line: string }) => x.line)).toEqual(['none', 'none']);
    // редагування: інша сума в доларах
    expect((await a.patch(`/api/finance/cash/${fb.opId}`, { date: '2026-11-20', type: 'Витрата', cat: 'Маркетинг', obj: 'Фейсбук', account: 'USD', amount: 50, rate: 40 })).status).toBe(200);
    const pnl = (await a.get('/api/finance/pnl?year=2026')).body;
    expect(pnl.fact['2026-11'].marketing).toBe(-2000);
    // продаж
    expect((await a.post('/api/finance/cash/exchange', { date: '2026-11-21', direction: 'sell', account: 'Карта', usd: 950, rate: 41 })).status).toBe(201);
    expect((await a.get('/api/finance/cash?month=')).body.balances.usd.usd).toBe(0);
  });
});

describe('імпорт з Excel (10.1, 10.2)', () => {
  async function xlsx(build: (ws: import('exceljs').Worksheet) => void, name = 'Облік') {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    build(wb.addWorksheet(name));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it('облік: дата текстом, рядки без дати, карта + готівка в одному рядку, повторний імпорт без дублів', async () => {
    const { a } = await setup();
    const buf = await xlsx((ws) => {
      ws.addRow(['Дата', 'Стаття', 'Підстаття', 'Обєкт', 'Контрагент ', 'Примітка', 'USD', 'UAH', 'UAH(готівка)']);
      ws.addRow(['Старт 15.07.2026', 'Дохід', 'Зведення обліку', 'VUDO', 'VUDO', 'Сума для зведення', null, 32072]);
      ws.addRow([new Date(Date.UTC(2026, 6, 21)), 'Витрата', 'Маркетинг', 'Фейсбук', 'VUDO', 'Реклама ФБ', null, -180]);
      ws.addRow([new Date(Date.UTC(2026, 6, 21)), 'Витрата', 'Маркетинг', 'Фейсбук', 'VUDO', 'Реклама ФБ', null, -180]);
      ws.addRow([null, 'Витрата', 'Адміністративні', 'Пальне', 'VUDO', 'Пальне', null, -500, -300]);
      ws.addRow(['Новий місяць 01.10.2026']);
      ws.addRow([new Date(Date.UTC(2026, 9, 2)), 'Позика+', 'Поповнення', 'VUDO', 'Єфімов', 'Позика', null, 6000]);
    });
    const r = await a.agent.post('/api/finance/cash/import').set('X-VUDO', '1').attach('file', buf, 'облік.xlsx');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ rows: 5, added: 6, duplicates: 0, skipped: [], byAccount: { 'Готівка': -300, 'ТОВ': 0, 'Карта': 37212, 'ФОП': 0 } });
    // однакові операції в одному файлі — обидві справжні
    expect((await a.get('/api/finance/cash?month=')).body.rows.filter((x: { note: string }) => x.note === 'Реклама ФБ')).toHaveLength(2);
    const cash = (await a.get('/api/finance/cash?month=')).body.rows.filter((x: { derived: string | null }) => !x.derived);
    const fuel = cash.filter((x: { note: string }) => x.note === 'Пальне');
    expect(fuel.map((x: { date: string; account: string; sum: number }) => [x.date, x.account, x.sum]).sort()).toEqual([
      ['2026-07-21', 'Готівка', -300],
      ['2026-07-21', 'Карта', -500],
    ]);
    expect(cash.find((x: { cat: string }) => x.cat === 'Зведення обліку')).toMatchObject({ date: '2026-07-15', line: 'none' });
    const again = await a.agent.post('/api/finance/cash/import').set('X-VUDO', '1').attach('file', buf, 'облік.xlsx');
    expect(again.body).toMatchObject({ added: 0, duplicates: 6 });
    const m = await loginAs('iryna');
    expect((await m.agent.post('/api/finance/cash/import').set('X-VUDO', '1').attach('file', buf, 'облік.xlsx')).status).toBe(403);
  });

  it('облік: колонка USD імпортується лише з курсом', async () => {
    const { a } = await setup();
    const buf = await xlsx((ws) => {
      ws.addRow(['Дата', 'Стаття', 'Підстаття', 'Обєкт', 'Контрагент ', 'Примітка', 'USD', 'UAH', 'UAH(готівка)', 'ТОВ ВУДО']);
      ws.addRow([new Date(Date.UTC(2026, 10, 20)), 'Позика+', 'Поповнення', 'VUDO', 'Єфімов', 'Позика 800$', 800]);
      ws.addRow([new Date(Date.UTC(2026, 10, 20)), 'Витрата', 'Фонд оплати праці', 'Заробітня плата', 'VUDO', 'СММ 800$', -800]);
      ws.addRow([new Date(Date.UTC(2026, 10, 21)), 'Витрата', 'Маркетинг', 'Фейсбук', 'VUDO', 'Реклама', null, -100]);
    });
    const r = await a.agent.post('/api/finance/cash/import').set('X-VUDO', '1').attach('file', buf, 'облік.xlsx');
    expect(r.body).toMatchObject({ added: 1, usd: 0 });
    expect(r.body.skipped).toHaveLength(2);
    const r2 = await a.agent.post('/api/finance/cash/import?usdRate=41.5').set('X-VUDO', '1').attach('file', buf, 'облік.xlsx');
    expect(r2.body).toMatchObject({ added: 2, duplicates: 1, usd: 0, skipped: [] });
    const rows = (await a.get('/api/finance/cash?month=')).body.rows.filter((x: { account: string }) => x.account === 'USD');
    expect(rows.map((x: { usd: number; rate: number; sum: number }) => [x.usd, x.rate, x.sum]).sort()).toEqual([[-800, 41.5, -33200], [800, 41.5, 33200]]);
    const again = await a.agent.post('/api/finance/cash/import?usdRate=42').set('X-VUDO', '1').attach('file', buf, 'облік.xlsx');
    expect(again.body).toMatchObject({ added: 0, duplicates: 3 });
  });

  it('план P&L: місяці з заголовка, назви рядків, витрати без знака', async () => {
    const { a } = await setup();
    const buf = await xlsx((ws) => {
      ws.addRow([null, 'До', '10.2026', new Date(Date.UTC(2026, 10, 1))]);
      ws.addRow(['Дохід ', 1750231, 952000, 1120000]);
      ws.addRow(['Витрати', -1577131, 680000, 800000]);
      ws.addRow(['Фонд оплати праці', null, -175000, -175000]);
      ws.addRow(['Майбутні витрати закриті', null, 321850, null]);
      ws.addRow(['Позика', null, 124587.7, null]);
    }, 'Аркуш 1');
    const r = await a.agent.post('/api/finance/pnl/import').set('X-VUDO', '1').attach('file', buf, 'pnl.xlsx');
    expect(r.body).toMatchObject({ months: ['2026-10', '2026-11'] });
    const p = (await a.get('/api/finance/pnl?year=2026')).body;
    expect(p.plan['2026-10']).toEqual({ income: 952000, orderCost: 680000, payroll: 175000, loan: 124587.7 });
    expect(p.futureClosed).toEqual({ '2026-10': 321850 });
    const put = (amount: number) => a.agent.put('/api/finance/pnl/plan').set('X-VUDO', '1').send({ month: '2026-11', line: 'futureClosed', amount });
    expect((await put(-5)).status).toBe(400);
    expect((await put(700)).status).toBe(200);
    expect((await a.get('/api/finance/pnl?year=2026')).body.futureClosed).toEqual({ '2026-10': 321850, '2026-11': 700 });
    expect(p.plan['2026-11']).toEqual({ income: 1120000, orderCost: 800000, payroll: 175000 });
  });
});

describe('договори', () => {
  it('лише власник: картка, файл, імпорт без дублів, експорт', async () => {
    const { a } = await setup();
    const ents = (await a.get('/api/contracts')).body.entities;
    expect(ents).toHaveLength(3);
    const entityId = ents[0].id;
    const { id } = (await a.post('/api/contracts', { entityId, counterparty: 'Тех', num: '№1', signedOn: '2026-10-08', status: 'Діючий' })).body;
    expect((await a.agent.put(`/api/contracts/${id}`).set('X-VUDO', '1').send({ entityId, counterparty: 'Тех', num: '№2', scanUrl: 'javascript:x' })).status).toBe(400);
    expect((await a.agent.put(`/api/contracts/${id}`).set('X-VUDO', '1').send({ entityId, counterparty: 'Тех', num: '№2' })).status).toBe(200);
    expect((await a.agent.post(`/api/contracts/${id}/files`).set('X-VUDO', '1').attach('files', Buffer.from('%PDF-1'), 'договір.pdf')).status).toBe(201);
    let row = (await a.get('/api/contracts')).body.rows[0];
    expect(row).toMatchObject({ num: '№2', signedOn: null, files: [{ name: 'договір.pdf' }] });
    const fid = row.files[0].id;
    expect((await a.get(`/api/contracts/files/${fid}`)).status).toBe(200);
    const m = await loginAs('iryna');
    for (const u of ['/api/contracts', `/api/contracts/files/${fid}`, '/api/export/contracts']) expect((await m.get(u)).status).toBe(403);
    expect((await a.del(`/api/contracts/files/${fid}`)).status).toBe(200);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Аркуш1');
    ws.addRow(['ТОВ', 'Контрагент', 'Відповідальний ', 'Предмет договору', 'Сума договору', 'Номер договору ', 'Дата підписання', 'Дата завершення', 'Діючий/завершений', 'ПРИМІТКИ  (історія)', 'Відсканований договір ']);
    ws.addRow(['ТОВ "ВУДО"']);
    ws.addRow([null, 'Вибір', 'ЄД', 'Купівля', '65000,05 грн.', '№7', new Date(Date.UTC(2026, 9, 22)), '31.12.2026 до виконання', 'Діючий ', 'прим', { text: 'a.pdf', hyperlink: 'https://example.com/a' }]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const up = () => a.agent.post(`/api/contracts/import/${entityId}`).set('X-VUDO', '1').attach('files', buf, 'd.xlsx');
    expect((await up()).body).toEqual({ added: 1, duplicates: 0 });
    expect((await up()).body).toEqual({ added: 0, duplicates: 1 });
    row = (await a.get('/api/contracts')).body.rows.find((x: { counterparty: string }) => x.counterparty === 'Вибір');
    expect(row).toMatchObject({ responsible: 'ЄД', amountText: '65000,05 грн.', num: '№7', signedOn: '2026-10-22', status: 'Діючий', note: 'прим', scanUrl: 'https://example.com/a' });
  });
});

describe('P&L з файлу замовника', () => {
  it('факт, «До», примітки: місяці з фактом беруть дані з файлу до копійки; можна повернути облік', async () => {
    const { a, o } = await setup();
    await a.post('/api/finance/cash', { ...expense(o.id, 4000), date: '2026-08-10' });
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Аркуш 1');
    for (const r of [
      [null, 'До', '07.2026', '09.2026', '12.2027'],
      ['Дохід ', 100, 500.4, 770, 900],
      [null, null, 148.5, 947.41],
      ['Витрати', -60, 414.29, 550, 600],
      [null, 21.75, 75.48, 299.49],
      ['Майбутні витрати закриті', null, 0, 321.5],
      ['Адміністративні витрати', -5, -23, -23, -23],
      [null, null, -18.25, -40.77],
      ['Оборотні кошти ', null, null, null, 'Купівля буса'],
      [null, null, null, null, -300],
      ['Інвестиції +', 7, 134.1],
      ['Позика', null, null, 124.7],
    ]) ws.addRow(r);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    expect((await a.agent.post('/api/finance/pnl/import').set('X-VUDO', '1').attach('file', buf, 'pnl.xlsx')).status).toBe(200);
    const p = (await a.get('/api/finance/pnl?year=2026')).body;
    expect(p.fixed.map((x: { month: string }) => x.month)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(p.fact['2026-07']).toEqual({ income: 148.5, orderCost: -75.48, admin: -18.25, invPlus: 134.1, net: 188.87 });
    expect(p.fact['2026-08']).toEqual({ net: 0 });
    expect(p.fact['2026-09']).toEqual({ income: 947.41, orderCost: -620.99, admin: -40.77, loan: 124.7, net: 410.35 });
    expect(p.futureClosed).toEqual({ '2026-09': 321.5 });
    expect(p.before).toEqual({ plan: { income: 100, orderCost: -60, admin: -5, invPlus: 7 }, fact: { orderCost: 21.75 } });
    const p27 = (await a.get('/api/finance/pnl?year=2027')).body;
    expect(p27.plan['2027-12']).toEqual({ income: 900, orderCost: 600, admin: 23, working: 300 });
    expect(p27.notes).toEqual([{ month: '2027-12', line: 'working', text: 'Купівля буса' }]);
    expect(p27.before).toBe(null);
    expect((await a.del('/api/finance/pnl/fixed/2026-08')).status).toBe(200);
    expect((await a.get('/api/finance/pnl?year=2026')).body.fact['2026-08'].orderCost).toBe(-4000);
  });
});

describe('позики і рахунки до оплати', () => {
  it('позика: надходження й повернення пишуться в облік; борг, прострочення; не більше боргу', async () => {
    const { a } = await setup();
    await a.post('/api/finance/loans', { lender: 'Єфімов Дем’ян', contract: 'ПФД №1', limit: 50000 });
    const id = (await a.get('/api/finance/loans')).body.rows[0].id;
    await a.post(`/api/finance/loans/${id}/ops`, { date: '2026-10-10', kind: 'in', sum: 6000, method: 'ТОВ', dueDate: '2026-10-15' });
    await a.post(`/api/finance/loans/${id}/ops`, { date: '2026-10-12', kind: 'in', sum: 4000, method: 'Готівка', dueDate: '2099-01-01', toCash: false });
    expect((await a.post(`/api/finance/loans/${id}/ops`, { date: today, kind: 'out', sum: 20000, method: 'Готівка' })).body.error).toMatch(/не більше боргу ТОВ/);
    await a.post(`/api/finance/loans/${id}/ops`, { date: today, kind: 'out', sum: 1000, method: 'ТОВ' });
    const r = (await a.get('/api/finance/loans')).body;
    expect(r.rows[0]).toMatchObject({ deposited: 10000, returned: 1000, debt: 9000, overdue: 5000, limitLeft: 41000 });
    expect(r).toMatchObject({ debt: 9000, overdue: 5000 });
    // в облік: +6 000 (Позика+) і −1 000 (Позика-); 4 000 — без запису
    const cash = (await a.get('/api/finance/cash?month=')).body.rows.filter((x: { type: string }) => x.type.startsWith('Позика'));
    expect(cash.map((x: { sum: number }) => x.sum).sort((p: number, q: number) => p - q)).toEqual([-1000, 6000]);
    expect(cash.every((x: { line: string }) => x.line === 'loan')).toBe(true);
    const m = await loginAs('iryna');
    expect((await m.get('/api/finance/loans')).status).toBe(403);
  });

  it('рахунок до оплати: часткова оплата, статус, витрата в облік на замовлення', async () => {
    const { a, o } = await setup();
    expect((await a.post('/api/finance/payables', { counterparty: 'Віяр', amount: 100, iban: 'UA12' })).body.error).toBe('IBAN: UA і 27 цифр.');
    await a.post('/api/finance/payables', {
      counterparty: 'Віяр', iban: 'UA21 3223 1300 0002 6007 2335 6600 1', purpose: 'за ДСП', invoice: '№55', amount: 12000, vat: 2000, dueDate: '2026-01-01', orderId: o.id,
    });
    let r = (await a.get('/api/finance/payables')).body;
    expect(r.rows[0]).toMatchObject({ status: 'Прострочено', left: 12000, iban: 'UA213223130000026007233566001' });
    expect(r.rows[0].purposeText.replace(/\s/g, ' ')).toBe('Оплата за ДСП згідно рах. №55, у т.ч. ПДВ 2 000,00 грн');
    const id = r.rows[0].id;
    expect((await a.post(`/api/finance/payables/${id}/pay`, { date: today, sum: 20000, account: 'Карта' })).body.error).toMatch(/Залишок до сплати/);
    await a.post(`/api/finance/payables/${id}/pay`, { date: today, sum: 5000, account: 'Карта' });
    r = (await a.get('/api/finance/payables')).body;
    expect(r.rows[0]).toMatchObject({ left: 7000, status: 'Прострочено' });
    expect(r.toPay).toBe(7000);
    const costs = (await a.get(`/api/finance/orders/${o.id}/costs`)).body;
    expect(costs).toMatchObject({ fact: 5000, materials: 5000 });
    await a.post(`/api/finance/payables/${id}/pay`, { date: today, sum: 7000, account: 'Готівка' });
    expect((await a.get('/api/finance/payables')).body.rows[0]).toMatchObject({ left: 0, status: 'Сплачено' });
  });

  it('каси ТОВ і ФОП: залишки окремо; оплата клієнта на рахунок ТОВ', async () => {
    const { a, o } = await setup();
    await a.post(`/api/orders/${o.id}/payments`, { sum: 2500, type: 'аванс', method: 'рахунок ТОВ', date: today });
    await a.post(`/api/orders/${o.id}/payments`, { sum: 700, type: 'аванс', method: 'рахунок ФОП', date: today });
    await a.post('/api/finance/cash', expense(o.id, 500, { account: 'ТОВ' }));
    expect((await a.get('/api/finance/cash')).body.balances).toEqual({ by: { 'Готівка': 6000, 'ТОВ': 2000, 'Карта': 0, 'ФОП': 700 }, total: 8700, usd: { usd: 0, uah: 0 } });
  });

  it('«Рекламація» — окремий рядок P&L', async () => {
    const { a } = await setup();
    await a.post('/api/finance/cash', { date: today, type: 'Витрата', cat: 'Рекламація', obj: 'Переробка', orderId: null, counterparty: '', note: '', account: 'ФОП', amount: 900 });
    const p = (await a.get(`/api/finance/pnl?year=${today.slice(0, 4)}`)).body;
    expect(p.fact[today.slice(0, 7)].claim).toBe(-900);
  });

  it('майбутні витрати: незакриті рахунки (не реєстр) і сплачене за місяць', async () => {
    const { a } = await setup();
    await (await import('../src/db.js')).pool.query('UPDATE fixed_costs SET active = false');
    const m = today.slice(0, 7);
    const get = async () => (await a.get(`/api/finance/pnl?year=${today.slice(0, 4)}`)).body.future[m];
    expect(await get()).toEqual({ paid: 0, unpaid: 0 });
    const bill = { counterparty: 'Майстер', purpose: 'за роботу', amount: 1000, cat: 'Інші', obj: 'Цех' };
    await a.post('/api/finance/payables', { ...bill, dueDate: today });
    await a.post('/api/finance/payables', { ...bill, amount: 300, kind: 'registry', invoice: '7', invoiceDate: '2026-11-20' });
    expect(await get()).toEqual({ paid: 0, unpaid: 1000 });
    const bills = (await a.get('/api/finance/payables')).body.rows;
    expect(bills).toHaveLength(1);
    await a.post(`/api/finance/payables/${bills[0].id}/pay`, { date: today, sum: 400, account: 'ТОВ' });
    expect(await get()).toEqual({ paid: 400, unpaid: 600 });
    const reg = (await a.get('/api/finance/payables?kind=registry')).body.rows;
    expect(reg).toHaveLength(1);
    expect(reg[0]).toMatchObject({ no: 1, left: 300, status: 'До сплати', purposeText: 'Оплата за роботу згідно рах. 7 від 20.11.2026, без ПДВ' });
    await (await import('../src/db.js')).pool.query('UPDATE fixed_costs SET active = true');
  });

  it('позика: примітка і спосіб змінюються, каса в обліку — теж', async () => {
    const { a } = await setup();
    await a.post('/api/finance/loans', { lender: 'Єфімов', limit: null });
    const id = (await a.get('/api/finance/loans')).body.rows[0].id;
    await a.post(`/api/finance/loans/${id}/ops`, { date: today, kind: 'in', sum: 500, method: 'Карта', note: 'на ДСП' });
    const op = (await a.get('/api/finance/loans')).body.rows[0].ops[0];
    expect(op).toMatchObject({ method: 'Карта', note: 'на ДСП' });
    expect((await a.patch(`/api/finance/loan-ops/${op.id}`, { note: 'на фурнітуру', method: 'ТОВ' })).status).toBe(200);
    expect((await a.get('/api/finance/loans')).body.rows[0].ops[0]).toMatchObject({ method: 'ТОВ', note: 'на фурнітуру' });
    expect((await a.get('/api/finance/cash')).body.balances.by['ТОВ']).toBe(500);
  });
});

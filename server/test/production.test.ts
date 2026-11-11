import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays, kyivToday } from '@vudo/shared';
import { pool } from '../src/db.js';
import { loginAs, logTexts, makeUser, resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => pool.end());

const today = kyivToday();

async function setup() {
  const ids = {
    iryna: await makeUser('iryna', ['Менеджер'], { name: 'Ірина Коваль' }),
    taras: await makeUser('taras', ['Замірник', 'Монтажник'], { name: 'Тарас Лисенко' }),
    oleh: await makeUser('oleh', ['Монтажник'], { name: 'Олег Кравець' }),
    maria: await makeUser('maria', ['Конструктор'], { name: 'Марія Ткач' }),
    roman: await makeUser('roman', ['Цех'], { name: 'Роман Савчук' }),
  };
  const m = await loginAs('iryna');
  const o = (
    await m.post('/api/orders', { phone: '+380671112233', name: 'Олена Петренко', source: 'сайт', managerId: ids.iryna, comment: 'Поверх 5' })
  ).body;
  await m.post(`/api/orders/${o.id}/items`, { name: 'Шафа-купе', type: 'шафа-купе', description: '', pre: { korpus: 10000 }, designerPct: null });
  const card = (await m.get(`/api/orders/${o.id}`)).body;
  const task = (stage: string) => card.tasks.find((t: { stage: string }) => t.stage === stage);
  return { ids, m, o, card, task };
}

describe('планування (розділ 8)', () => {
  it('відповідальний вказує дні; ланцюжок дат; журнал', async () => {
    const { task, o } = await setup();
    const mr = await loginAs('maria');
    const calc = task('Прорахунок');
    const m = await loginAs('iryna');
    expect((await m.patch(`/api/plan/tasks/${calc.id}`, { days: 2, startDate: today, progress: 0, comment: '' })).status).toBe(200);
    const zamir = task('Замір');
    const t = await loginAs('taras');
    expect((await t.patch(`/api/plan/tasks/${zamir.id}`, { days: 3, startDate: null, progress: 50, comment: '' })).status).toBe(200);
    // Конструктор не може змінити чужий етап
    expect((await mr.patch(`/api/plan/tasks/${zamir.id}`, { days: 5, startDate: null, progress: 0, comment: '' })).status).toBe(403);
    const plan = (await t.get('/api/plan')).body;
    const z = plan.tasks.find((x: { id: number }) => x.id === zamir.id);
    // Замір починається одразу після Прорахунку (2 дні від сьогодні)
    expect(z.sched).toMatchObject({ planned: true, start: addDays(today, 2), last: addDays(today, 4) });
    expect(z.orderNum).toBe(o.num);
    expect(JSON.stringify(plan)).not.toMatch(/price|грн/);
    expect((await logTexts()).at(-1)).toBe('План «Шафа-купе» · Замір: днів — → 3, виконано 50%');
  });

  it('прострочений етап червоний; наступні починаються не раніше за сьогодні', async () => {
    const { task, m } = await setup();
    await m.patch(`/api/plan/tasks/${task('Прорахунок').id}`, { days: 2, startDate: addDays(today, -10), progress: 30, comment: '' });
    await m.patch(`/api/plan/tasks/${task('Замір').id}`, { days: 1, startDate: null, progress: 0, comment: '' });
    const plan = (await m.get('/api/plan')).body;
    const calc = plan.tasks.find((x: { stage: string }) => x.stage === 'Прорахунок');
    const zam = plan.tasks.find((x: { stage: string }) => x.stage === 'Замір');
    expect(calc.sched).toMatchObject({ late: true, lateBy: 9 });
    expect(zam.sched.start).toBe(today);
  });

  it('відповідального змінює лише менеджер; виконано — кроком 10 %', async () => {
    const { task, ids, m } = await setup();
    const t = await loginAs('taras');
    const zamir = task('Замір');
    expect((await t.patch(`/api/plan/tasks/${zamir.id}`, { days: 1, startDate: null, progress: 0, comment: '', assigneeId: ids.oleh })).status).toBe(403);
    expect((await t.patch(`/api/plan/tasks/${zamir.id}`, { days: 1, startDate: null, progress: 55, comment: '' })).body.error).toBe('Виконано — кроком 10 %.');
    expect((await m.patch(`/api/plan/tasks/${zamir.id}`, { days: 1, startDate: null, progress: 0, comment: '', assigneeId: ids.oleh })).status).toBe(200);
    expect((await logTexts()).at(-1)).toContain('відповідальний: Олег Кравець');
  });
});

describe('Мій день (8А.3)', () => {
  it('монтажник бачить виїзд за датою монтажу і позначає «Змонтовано ✓»', async () => {
    const { o, card, m, ids } = await setup();
    await m.patch(`/api/orders/${o.id}`, {
      clientId: card.client.id, address: 'Київ, Хрещатик 1', source: 'сайт', designerId: null, managerId: ids.iryna, measurerId: ids.taras,
      constructorId: null, installerIds: [ids.oleh], measureDate: null, installDate: addDays(today, 3), readyDate: null, delivery: 0, discount: 0,
      discountType: 'грн', comment: 'Поверх 5',
    });
    const ol = await loginAs('oleh');
    let day = (await ol.get('/api/myday')).body;
    expect(day.visits).toHaveLength(0);
    expect(day.upcoming[0]).toMatchObject({ date: addDays(today, 3), visits: [{ stage: 'Монтаж', address: 'Київ, Хрещатик 1' }] });
    day = (await ol.get(`/api/myday?date=${addDays(today, 3)}`)).body;
    const v = day.visits[0];
    expect(v).toMatchObject({ stage: 'Монтаж', clientName: 'Олена Петренко', phone: '+380671112233', done: false });
    expect(JSON.stringify(day)).not.toMatch(/price|грн/);
    // чужі виїзди не видно
    expect((await ol.get(`/api/myday?user=${ids.taras}`)).status).toBe(403);
    expect((await ol.post('/api/myday/done', { taskIds: v.taskIds })).status).toBe(200);
    day = (await ol.get(`/api/myday?date=${addDays(today, 3)}`)).body;
    expect(day.visits[0].done).toBe(true);
    expect((await logTexts()).at(-1)).toBe('План «Шафа-купе» · Монтаж: виконано 100%');
    // менеджер дивиться виїзди будь-якого працівника
    const mm = (await m.get(`/api/myday?user=${ids.oleh}&date=${addDays(today, 3)}`)).body;
    expect(mm.visits).toHaveLength(1);
    expect(mm.people.map((p: { name: string }) => p.name)).toEqual(['Олег Кравець', 'Тарас Лисенко']);
  });

  it('цех не має розділу «Мій день»', async () => {
    await setup();
    const r = await loginAs('roman');
    expect((await r.get('/api/myday')).status).toBe(403);
  });
});

describe('брак і нестачі (8А.2)', () => {
  it('виконавець надсилає з фото; менеджер: нове → замовлено → вирішено', async () => {
    const { o, card, m } = await setup();
    const t = await loginAs('taras');
    const r = await t.agent
      .post(`/api/orders/${o.id}/issues`)
      .set('X-VUDO', '1')
      .field('type', 'Брак деталі')
      .field('itemId', String(card.items[0].id))
      .field('qty', '1 шт')
      .field('text', 'Фасад 716×396, скол на крайці')
      .field('urgent', 'true')
      .attach('photo', Buffer.from('jpeg'), 'скол.jpg');
    expect(r.status).toBe(201);
    expect((await logTexts()).at(-1)).toBe('Брак деталі: Фасад 716×396, скол на крайці — 1 шт («Шафа-купе»). ТЕРМІНОВО, зупиняє роботу. Потрібне дозамовлення');
    const c1 = (await t.get(`/api/orders/${o.id}`)).body;
    expect(c1.issues[0]).toMatchObject({ type: 'Брак деталі', urgent: true, status: 'нове', itemName: 'Шафа-купе', byName: 'Тарас Лисенко' });
    expect(c1.files[0]).toMatchObject({ name: `брак_${o.num}_скол.jpg`, category: 'other' });
    const id = c1.issues[0].id;
    expect((await t.patch(`/api/issues/${id}`, { status: 'вирішено' })).status).toBe(403);
    await m.patch(`/api/issues/${id}`, { status: 'замовлено' });
    expect((await m.get(`/api/orders/${o.id}`)).body.issues[0].status).toBe('замовлено');
    await m.patch(`/api/issues/${id}`, { status: 'вирішено' });
    expect((await m.get(`/api/orders/${o.id}`)).body.issues).toHaveLength(0);
    expect((await logTexts()).at(-1)).toBe('Проблема «Фасад 716×396, скол на крайці»: вирішено');
    // папка «Брак і нестачі» доступна всім
    const notes = (await t.get('/api/log?folder=issue')).body.entries;
    expect(notes).toHaveLength(3);
  });

  it('без тексту — помилка', async () => {
    const { o } = await setup();
    const t = await loginAs('taras');
    const r = await t.agent.post(`/api/orders/${o.id}/issues`).set('X-VUDO', '1').field('type', 'Не вистачає').field('text', '');
    expect(r.body.error).toBe('Опишіть, чого не вистачає або що за брак.');
  });
});

describe('склад залишків (8А.4)', () => {
  const plate = { kind: 'Плита', material: 'ДСП Egger W1000 білий', thick: 18, w: 1200, h: 600, qty: 2, unit: 'шт', place: 'Стелаж А-1', fromOrderId: null, note: '' };

  it('цех додає; виконавці виїзду не мають доступу; плита вимагає розмірів', async () => {
    await setup();
    const r = await loginAs('roman');
    expect((await r.post('/api/stock', plate)).status).toBe(201);
    expect((await r.post('/api/stock', { ...plate, w: null })).body.error).toBe('Для плити вкажіть ширину і висоту обрізка.');
    expect((await r.post('/api/stock', { ...plate, kind: 'Фурнітура', material: 'Петля Blum', w: null, h: null, thick: null, qty: 10 })).status).toBe(201);
    const list = (await r.get('/api/stock')).body;
    expect(list).toHaveLength(2);
    expect(JSON.stringify(list)).not.toMatch(/price|грн/);
    const t = await loginAs('taras');
    expect((await t.get('/api/stock')).status).toBe(403);
    expect(await logTexts()).toContain('Склад: додано плита «ДСП Egger W1000 білий» 1200×600×18 — 2 шт · Стелаж А-1');
  });

  it('резерв під замовлення видно в картці; часткове списання залишає решту', async () => {
    const { o, m } = await setup();
    await m.post('/api/stock', plate);
    const id = (await m.get('/api/stock')).body[0].id;
    await m.post(`/api/stock/${id}/reserve`, { orderId: o.id });
    const c = (await (await loginAs('taras')).get(`/api/orders/${o.id}`)).body;
    expect(c.reserved[0]).toMatchObject({ material: 'ДСП Egger W1000 білий', qty: 2, place: 'Стелаж А-1' });
    await m.post(`/api/stock/${id}/use`, { qty: 1, orderId: o.id });
    const list = (await m.get('/api/stock')).body;
    const left = list.find((x: { id: number }) => x.id === id);
    const used = list.find((x: { status: string }) => x.status === 'використано');
    expect(left).toMatchObject({ qty: 1, status: 'вільний' });
    expect(used).toMatchObject({ qty: 1, resNum: o.num });
    expect((await m.post(`/api/stock/${id}/use`, { qty: 5 })).body.error).toBe('На складі лише 1 шт.');
    expect((await logTexts()).at(-1)).toBe(`Склад: використано плита «ДСП Egger W1000 білий» 1200×600×18 — 1 шт для №${o.num}`);
    const del = await m.agent.delete(`/api/stock/${id}`).set('X-VUDO', '1');
    expect(del.status).toBe(200);
    // записи складу — у папці «Склад»
    expect((await m.get('/api/log?folder=stock')).body.entries.length).toBeGreaterThanOrEqual(4);
  });
});

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { kyivToday } from '@vudo/shared';
import { pool } from '../src/db.js';
import { loginAs, logTexts, makeUser, resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => pool.end());

type S = Awaited<ReturnType<typeof loginAs>>;

/** Команда: власник, менеджер, замірник, конструктор, цех, монтажник. */
async function team() {
  const ids = {
    admin: await makeUser('admin', ['Адмін'], { name: 'Марк Власник' }),
    iryna: await makeUser('iryna', ['Менеджер'], { name: 'Ірина Коваль' }),
    taras: await makeUser('taras', ['Замірник', 'Монтажник'], { name: 'Тарас Лисенко' }),
    maria: await makeUser('maria', ['Конструктор'], { name: 'Марія Ткач' }),
    roman: await makeUser('roman', ['Цех'], { name: 'Роман Савчук' }),
  };
  return { ids, m: await loginAs('iryna') };
}

async function newOrder(m: S, managerId: number, phone = '+380 67 111 22 33', name = 'Олена Петренко') {
  const r = await m.post('/api/orders', { phone, name, type: 'фізособа', source: 'Instagram', managerId, comment: 'Шафа-купе' });
  expect(r.status).toBe(201);
  return r.body;
}

const pre = (korpus: number) => ({ korpus });

describe('нове звернення (5.2)', () => {
  it('створює клієнта і замовлення з номером РРРР-NNNN; журнал', async () => {
    const { ids, m } = await team();
    const o = await newOrder(m, ids.iryna);
    expect(o.num).toBe(`${kyivToday().slice(0, 4)}-0001`);
    expect(o.status).toBe('Звернення');
    expect(o.client.name).toBe('Олена Петренко');
    const o2 = await newOrder(m, ids.iryna, '+380 50 000 00 00', 'Інший');
    expect(o2.num).toBe(`${kyivToday().slice(0, 4)}-0002`);
    expect(await logTexts()).toContain(`Створено звернення №${o.num}`);
  });

  it('телефон існуючого клієнта — звернення додається до нього (за останніми 10 цифрами)', async () => {
    const { ids, m } = await team();
    const o1 = await newOrder(m, ids.iryna, '+380671112233');
    const o2 = await newOrder(m, ids.iryna, '067 111-22-33', 'Хтось інший');
    expect(o2.client.id).toBe(o1.client.id);
    const n = await pool.query('SELECT count(*)::int AS n FROM clients');
    expect(n.rows[0].n).toBe(1);
  });

  it('новий дизайнер-партнер створюється разом зі зверненням', async () => {
    const { ids, m } = await team();
    const r = await m.post('/api/orders', {
      phone: '+380671112233', name: 'Клієнт', source: 'дизайнер', managerId: ids.iryna,
      newDesigner: { name: 'Оксана Лис', company: 'Студія «Простір»', phone: '+380 99 123 45 67' },
    });
    expect(r.status).toBe(201);
    expect(r.body.designer).toMatchObject({ name: 'Оксана Лис', company: 'Студія «Простір»', bonusPct: 10 });
    expect(await logTexts()).toContain('Створено звернення №' + r.body.num + ' · дизайнер «Оксана Лис · Студія «Простір»»');
  });

  it('помилки: короткий телефон, без імені', async () => {
    const { ids, m } = await team();
    expect((await m.post('/api/orders', { phone: '123', name: 'X', source: 'сайт', managerId: ids.iryna })).body.error).toBe(
      'Вкажіть телефон клієнта (щонайменше 9 цифр).',
    );
    expect((await m.post('/api/orders', { phone: '+380671112233', source: 'сайт', managerId: ids.iryna })).body.error).toBe('Вкажіть ПІБ клієнта.');
  });
});

describe('прорахунок (розділ 6)', () => {
  it('ціна виробу рахується з компонентів; план із 5 етапів; відповідальні з картки', async () => {
    const { ids, m } = await team();
    const o = await newOrder(m, ids.iryna);
    const r = await m.post(`/api/orders/${o.id}/items`, { name: 'Шафа-купе', type: 'шафа-купе', description: '', pre: { korpus: 10000, facade: 5000 }, designerPct: null });
    expect(r.status).toBe(201);
    const i = r.body.items[0];
    expect(i.calc).toMatchObject({ preCost: 15000, prePrice: 22500, price: 22500 });
    expect(r.body.sums.price).toBe(22500);
    expect(r.body.tasks.map((t: { stage: string }) => t.stage)).toEqual(['Прорахунок', 'Замір', 'Конструктив', 'Збірка', 'Монтаж']);
    const who = Object.fromEntries(r.body.tasks.map((t: { stage: string; assigneeName: string }) => [t.stage, t.assigneeName]));
    expect(who).toEqual({ 'Прорахунок': 'Ірина Коваль', 'Замір': 'Тарас Лисенко', 'Конструктив': 'Марія Ткач', 'Збірка': 'Роман Савчук', 'Монтаж': 'Тарас Лисенко' });
  });

  it('дизайнер бере 10 % → 24 750; точний прорахунок має пріоритет', async () => {
    const { ids, m } = await team();
    const o = await newOrder(m, ids.iryna);
    const a = await m.post(`/api/orders/${o.id}/items`, { name: 'Кухня', type: 'кухня', description: '', pre: pre(15000), designerPct: 10 });
    const itemId = a.body.items[0].id;
    expect(a.body.items[0].calc.price).toBe(24750);
    expect(a.body.sums.designer).toBe(2250);
    const b = await m.agent.put(`/api/orders/${o.id}/items/${itemId}/exact`).set('X-VUDO', '1').send({ exact: { korpus: 16000 } });
    expect(b.body.items[0].calc).toMatchObject({ exactCost: 16000, price: 26400, prePrice: 24750 });
    expect((await logTexts()).at(-1)).toMatch(/Точний прорахунок «Кухня»: собівартість 16.000 грн, точна вартість 26.400 грн \(було 24.750 грн\)/);
    // порожній точний — очищає
    const c = await m.agent.put(`/api/orders/${o.id}/items/${itemId}/exact`).set('X-VUDO', '1').send({ exact: {} });
    expect(c.body.items[0].calc.exactCost).toBeNull();
  });

  it('зміна націнки в налаштуваннях не змінює вже пораховані вироби', async () => {
    const { ids, m } = await team();
    const o = await newOrder(m, ids.iryna);
    await m.post(`/api/orders/${o.id}/items`, { name: 'Шафа', type: 'інше', description: '', pre: pre(10000), designerPct: null });
    await m.patch('/api/settings', { markupPct: 60 });
    const card = await m.get(`/api/orders/${o.id}`);
    expect(card.body.items[0].calc.price).toBe(15000);
  });

  it('доставка і знижка: ціна = вироби + доставка − знижка', async () => {
    const { ids, m } = await team();
    const o = await newOrder(m, ids.iryna);
    const c = await m.post(`/api/orders/${o.id}/items`, { name: 'Шафа', type: 'інше', description: '', pre: pre(400000), designerPct: null });
    const body = { ...mainOf(c.body), delivery: 5000 };
    const r = await m.patch(`/api/orders/${o.id}`, body);
    expect(r.status).toBe(200);
    expect(r.body.sums).toMatchObject({ items: 600000, price: 605000 });
    expect((await logTexts()).map((t) => t.replace(/\s/g, ' '))).toContain('Змінено. Доставка: 0 грн → 5 000 грн');
  });
});

function mainOf(card: Record<string, unknown> & { client: { id: number } }) {
  return {
    clientId: card.client.id,
    address: card.address ?? '',
    source: card.source,
    designerId: (card.designer as { id: number } | null)?.id ?? null,
    managerId: card.managerId,
    measurerId: card.measurerId,
    constructorId: card.constructorId,
    installerIds: card.installerIds,
    measureDate: card.measureDate,
    installDate: card.installDate,
    readyDate: card.readyDate,
    delivery: card.delivery,
    discount: card.discount,
    discountType: card.discountType,
    comment: card.comment ?? '',
  };
}

describe('статуси (розділ 4)', () => {
  async function toPricing(m: S, managerId: number, measurerId: number) {
    const o = await newOrder(m, managerId);
    let r = await m.post(`/api/orders/${o.id}/status`, { to: 'Замір призначено', mode: 'step', values: {} });
    expect(r.body.error).toBe("Заповніть поле «Адреса об'єкта».");
    r = await m.post(`/api/orders/${o.id}/status`, {
      to: 'Замір призначено', mode: 'step', values: { address: 'Київ, Хрещатик 1', measureDate: '2026-11-12', measurerId },
    });
    expect(r.body.status).toBe('Замір призначено');
    expect(r.body.address).toBe('Київ, Хрещатик 1');
    r = await m.post(`/api/orders/${o.id}/status`, { to: 'Замір виконано', mode: 'step' });
    expect(r.body.error).toMatch(/Додайте хоча б один виріб/);
    await m.post(`/api/orders/${o.id}/items`, { name: 'Шафа', type: 'інше', description: '', pre: pre(10000), designerPct: null });
    r = await m.post(`/api/orders/${o.id}/status`, { to: 'Замір виконано', mode: 'step' });
    expect(r.body.status).toBe('Замір виконано');
    expect(r.body.tasks.find((t: { stage: string }) => t.stage === 'Замір').progress).toBe(100);
    return o;
  }

  it('крок вперед з умовами; договір вимагає аванс ≥ 30 % і фіксує дату та ціну', async () => {
    const { ids, m } = await team();
    const o = await toPricing(m, ids.iryna, ids.taras);
    await m.post(`/api/orders/${o.id}/status`, { to: 'Прорахунок', mode: 'step' });
    await m.post(`/api/orders/${o.id}/status`, { to: 'Очікує рішення клієнта', mode: 'step' });
    let r = await m.post(`/api/orders/${o.id}/status`, { to: 'Договір / аванс отримано', mode: 'step' });
    expect(r.body.error).toMatch(/Потрібен аванс щонайменше 30% — 4.500 грн/);
    await m.post(`/api/orders/${o.id}/payments`, { sum: 4500, type: 'аванс', method: 'картка', date: kyivToday() });
    r = await m.post(`/api/orders/${o.id}/status`, { to: 'Договір / аванс отримано', mode: 'step' });
    expect(r.body.status).toBe('Договір / аванс отримано');
    expect(r.body.contractDate).toBe(kyivToday());
    expect(r.body.contractPrice).toBe(15000);
    // після договору виріб не прибирається
    const del = await m.agent.delete(`/api/orders/${o.id}/items/${r.body.items[0].id}`).set('X-VUDO', '1');
    expect(del.body.error).toMatch(/Після договору вироби не прибираються/);
    // Відмова — лише до договору
    const ref = await m.post(`/api/orders/${o.id}/status`, { to: 'Відмова', mode: 'jump', values: { refuseReason: 'дорого' } });
    expect(ref.body.error).toMatch(/Відмова можлива лише до договору/);
  });

  it('кнопкою — лише наступний крок; перемикачем — пропуск з перевіркою умов усіх пропущених', async () => {
    const { ids, m } = await team();
    const o = await toPricing(m, ids.iryna, ids.taras);
    let r = await m.post(`/api/orders/${o.id}/status`, { to: 'Очікує рішення клієнта', mode: 'step' });
    expect(r.body.error).toMatch(/можна перейти лише в/);
    r = await m.post(`/api/orders/${o.id}/status`, { to: 'Договір / аванс отримано', mode: 'jump' });
    expect(r.body.error).toMatch(/^Щоб перейти в «Договір \/ аванс отримано»: Потрібен аванс/);
    await m.post(`/api/orders/${o.id}/payments`, { sum: 15000, type: 'аванс', method: 'готівка', date: kyivToday() });
    r = await m.post(`/api/orders/${o.id}/status`, { to: 'Проєкт погоджено', mode: 'jump', values: { ok: true } });
    expect(r.body.status).toBe('Проєкт погоджено');
    expect(r.body.contractDate).toBe(kyivToday());
    const done = r.body.tasks.filter((t: { progress: number }) => t.progress === 100).map((t: { stage: string }) => t.stage);
    expect(done).toEqual(['Прорахунок', 'Замір', 'Конструктив']);
    expect((await logTexts()).find((t) => t.startsWith('Статус «Замір виконано»'))).toBe(
      'Статус «Замір виконано» → «Проєкт погоджено» (пропущено етапів: 4)',
    );
    // назад — без умов, дата договору лишається
    r = await m.post(`/api/orders/${o.id}/status`, { to: 'Прорахунок', mode: 'jump' });
    expect(r.body.status).toBe('Прорахунок');
    expect(r.body.contractDate).toBe(kyivToday());
    expect((await logTexts()).at(-1)).toBe('Статус «Проєкт погоджено» → «Прорахунок» (повернуто назад)');
  });

  it('закрити можна лише без боргу; відмова з причиною', async () => {
    const { ids, m } = await team();
    const o = await toPricing(m, ids.iryna, ids.taras);
    await m.post(`/api/orders/${o.id}/payments`, { sum: 5000, type: 'аванс', method: 'готівка', date: kyivToday() });
    let r = await m.post(`/api/orders/${o.id}/status`, {
      to: 'Змонтовано', mode: 'jump', values: { ok: true },
    });
    expect(r.body.status).toBe('Змонтовано');
    r = await m.post(`/api/orders/${o.id}/status`, { to: 'Закрито', mode: 'step' });
    expect(r.body.error).toMatch(/борг клієнта 10.000 грн/);
    const logs = (await logTexts()).map((t) => t.replace(/\s/g, ' '));
    expect(logs).toContain('Сповіщення менеджеру: змонтовано, борг 10 000 грн');
    expect(logs).toContain('Статус «Замір виконано» → «Змонтовано» (пропущено етапів: 9)');
    const folder = await pool.query(`SELECT folder FROM audit_log WHERE text LIKE 'Статус «Замір виконано» → «Змонтовано»%'`);
    expect(folder.rows[0].folder).toBe('mont');

    const o2 = await newOrder(m, ids.iryna, '+380501234567', 'Інший');
    r = await m.post(`/api/orders/${o2.id}/status`, { to: 'Відмова', mode: 'step', values: {} });
    expect(r.body.error).toBe('Заповніть поле «Причина відмови».');
    r = await m.post(`/api/orders/${o2.id}/status`, { to: 'Відмова', mode: 'step', values: { refuseReason: 'Дорого' } });
    expect(r.body).toMatchObject({ status: 'Відмова', refuseReason: 'Дорого' });
  });

  it('виконавці не змінюють статус', async () => {
    const { ids, m } = await team();
    const o = await newOrder(m, ids.iryna);
    const t = await loginAs('taras');
    expect((await t.post(`/api/orders/${o.id}/status`, { to: 'Відмова', mode: 'step', values: { refuseReason: 'x' } })).status).toBe(403);
  });
});

describe('оплати', () => {
  it('оплати 200 000 і повернення 20 000 → оплачено 180 000; оплати не видаляються', async () => {
    const { ids, m } = await team();
    const o = await newOrder(m, ids.iryna);
    await m.post(`/api/orders/${o.id}/items`, { name: 'Шафа', type: 'інше', description: '', pre: pre(400000), designerPct: null });
    await m.post(`/api/orders/${o.id}/payments`, { sum: 200000, type: 'аванс', method: 'рахунок', date: kyivToday() });
    const r = await m.post(`/api/orders/${o.id}/payments`, { sum: 20000, type: 'повернення', method: 'картка', date: kyivToday() });
    expect(r.body.card.sums).toMatchObject({ paid: 180000, debt: 600000 - 180000, avans: 200000 });
    expect(r.body.message).toMatch(/^Внесено 20.000 грн. Оплачено 180.000 грн, борг 420.000 грн$/);
    expect((await m.post(`/api/orders/${o.id}/payments`, { sum: 0, type: 'аванс', method: 'картка', date: kyivToday() })).body.error).toBe(
      'Вкажіть суму оплати більше 0.',
    );
  });
});

describe('права на суми (розділ 2)', () => {
  it('виконавці не отримують жодних сум ні в картці, ні в списку, ні в журналі', async () => {
    const { ids, m } = await team();
    const o = await newOrder(m, ids.iryna);
    await m.post(`/api/orders/${o.id}/items`, { name: 'Шафа', type: 'інше', description: 'дзеркала', pre: pre(10000), designerPct: null });
    await m.post(`/api/orders/${o.id}/payments`, { sum: 1000, type: 'аванс', method: 'картка', date: kyivToday() });
    const t = await loginAs('taras');
    const card = await t.get(`/api/orders/${o.id}`);
    expect(card.status).toBe(200);
    expect(card.body.view).toBe('exec');
    const json = JSON.stringify(card.body);
    for (const k of ['price', 'paid', 'debt', 'sums', 'payments', 'pre', 'exact', 'calc', 'markupPct', 'contractPrice', 'history', 'owner'])
      expect(json).not.toContain(`"${k}":`);
    expect(json).not.toMatch(/грн|\d{4,}\.\d|"sum"/);
    expect(card.body.items[0]).toEqual({ id: expect.any(Number), name: 'Шафа', type: 'інше', description: 'дзеркала' });
    const list = await t.get('/api/orders');
    expect(JSON.stringify(list.body)).not.toMatch(/price|paid|debt/);
    const log = await t.get('/api/log');
    expect(JSON.stringify(log.body)).not.toMatch(/грн/);
    expect((await t.patch(`/api/orders/${o.id}`, {})).status).toBe(403);
    expect((await t.get('/api/clients')).status).toBe(403);
  });

  it('маржа і чистий прибуток — лише власнику', async () => {
    const { ids, m } = await team();
    const o = await newOrder(m, ids.iryna);
    await m.post(`/api/orders/${o.id}/items`, { name: 'Шафа', type: 'інше', description: '', pre: pre(10000), designerPct: null });
    expect((await m.get(`/api/orders/${o.id}`)).body.owner).toBeNull();
    const a = await loginAs('admin');
    const own = (await a.get(`/api/orders/${o.id}`)).body.owner;
    // ціна 15 000, собівартість 10 000, постійні 15 % = 2 250
    expect(own).toMatchObject({ margin: 5000, opex: 2250, netProfit: 2750 });
  });
});

describe('коментарі й файли', () => {
  it('виконавець додає коментар і файл «Інші», але не «Прорахунки / специфікації»', async () => {
    const { ids, m } = await team();
    const o = await newOrder(m, ids.iryna);
    const t = await loginAs('taras');
    const c = await t.post(`/api/orders/${o.id}/comments`, { text: 'Домофон не працює' });
    expect(c.body.comments[0]).toMatchObject({ text: 'Домофон не працює', byName: 'Тарас Лисенко' });

    const up = await t.agent.post(`/api/orders/${o.id}/files`).set('X-VUDO', '1').field('category', 'other').attach('files', Buffer.from('jpegdata'), 'фото заміру.jpg');
    expect(up.status).toBe(201);
    expect(up.body.files[0]).toMatchObject({ name: 'фото заміру.jpg', category: 'other', size: 8 });

    const spec = await t.agent.post(`/api/orders/${o.id}/files`).set('X-VUDO', '1').field('category', 'spec').attach('files', Buffer.from('x'), 'кп.pdf');
    expect(spec.status).toBe(403);

    const ms = await m.agent.post(`/api/orders/${o.id}/files`).set('X-VUDO', '1').field('category', 'spec').attach('files', Buffer.from('%PDF'), 'кп.pdf');
    expect(ms.status).toBe(201);
    const specId = ms.body.files.find((f: { category: string }) => f.category === 'spec').id;
    expect((await t.get(`/api/files/${specId}`)).status).toBe(403);
    const dl = await m.get(`/api/files/${specId}`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/^inline/);
    // виконавець не бачить spec у картці
    expect((await t.get(`/api/orders/${o.id}`)).body.files.map((f: { category: string }) => f.category)).toEqual(['other']);
    expect(await logTexts()).toContain('Додано файл «фото заміру.jpg» (Інші файли)');
  });

  it('непідтримуваний тип файлу відхиляється з назвою', async () => {
    const { ids, m } = await team();
    const o = await newOrder(m, ids.iryna);
    const r = await m.agent.post(`/api/orders/${o.id}/files`).set('X-VUDO', '1').field('category', 'other').attach('files', Buffer.from('x'), 'virus.exe');
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/virus\.exe/);
  });
});

describe('клієнти й дизайнери (розділ 9)', () => {
  it('помилки й унікальність телефону', async () => {
    const { m } = await team();
    const bad = async (b: object) => (await m.post('/api/clients', b)).body.error;
    expect(await bad({ name: '', phone: '+380671112233' })).toBe('Вкажіть ПІБ або назву клієнта.');
    expect(await bad({ name: 'X', phone: '12345' })).toBe('Вкажіть телефон (щонайменше 9 цифр).');
    expect((await m.post('/api/clients', { name: 'Олена', phone: '+380671112233' })).status).toBe(201);
    expect(await bad({ name: 'Дубль', phone: '0671112233' })).toBe('Клієнт із цим телефоном уже є: Олена.');
    // дизайнер без телефону — можна
    expect((await m.post('/api/clients', { name: 'Оксана', type: 'дизайнер-партнер', company: 'Студія' })).status).toBe(201);
  });

  it('довідник дизайнерів: бонус «заг.», замовлення, у роботі; бонус — окремий запис у Фінанси', async () => {
    const { ids, m } = await team();
    const d = await m.post('/api/clients', { name: 'Оксана Лис', type: 'дизайнер-партнер', company: 'Простір' });
    await m.post('/api/orders', { phone: '+380671112233', name: 'Клієнт', source: 'дизайнер', designerId: d.body.id, managerId: ids.iryna });
    const list = await m.get('/api/clients?kind=designers');
    expect(list.body[0]).toMatchObject({ name: 'Оксана Лис', bonusPct: null, effectiveBonusPct: 10, ordersCount: 1, activeCount: 1 });
    await m.patch(`/api/clients/${d.body.id}`, { bonusPct: 12 });
    expect((await logTexts()).at(-1)).toBe('Бонус дизайнера «Оксана Лис · Простір»: заг. → 12%');
  });

  it('архів клієнта', async () => {
    const { m } = await team();
    const c = await m.post('/api/clients', { name: 'Олена', phone: '+380671112233' });
    await m.patch(`/api/clients/${c.body.id}`, { archived: true });
    expect((await m.get('/api/clients')).body).toHaveLength(0);
    expect((await m.get('/api/clients?archived=1')).body).toHaveLength(1);
    expect((await logTexts()).at(-1)).toBe('Клієнт «Олена» в архіві');
  });
});

describe('список замовлень', () => {
  it('пошук за номером, ПІБ і телефоном (від 3 цифр); виконавці — лише активні', async () => {
    const { ids, m } = await team();
    const a = await newOrder(m, ids.iryna, '+380671112233', 'Олена Петренко');
    await newOrder(m, ids.iryna, '+380509998877', 'Ігор Бойко');
    expect((await m.get('/api/orders?q=петрен')).body.map((o: { id: number }) => o.id)).toEqual([a.id]);
    expect((await m.get('/api/orders?q=998')).body).toHaveLength(1);
    expect((await m.get('/api/orders?q=-0001')).body.map((o: { id: number }) => o.id)).toEqual([a.id]);
    await m.post(`/api/orders/${a.id}/status`, { to: 'Відмова', mode: 'step', values: { refuseReason: 'x' } });
    const t = await loginAs('taras');
    expect((await t.get('/api/orders')).body).toHaveLength(1);
  });
});

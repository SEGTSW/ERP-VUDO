import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { kyivToday, monthDays, parseTimeValue, timeTotals } from '@vudo/shared';
import { pool } from '../src/db.js';
import { loginAs, logTexts, makeUser, resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => pool.end());

describe('табель (12В)', () => {
  it('значення клітинки: години, кома, позначки; неправильне — null', () => {
    expect(parseTimeValue('7,5')).toBe('7.5');
    expect(parseTimeValue(' вп ')).toBe('ВП');
    expect(parseTimeValue('25')).toBeNull();
    expect(parseTimeValue('abc')).toBeNull();
    expect(parseTimeValue('')).toBe('');
    expect(timeTotals(['8', '7.5', 'В', 'Л', 'ВП', 'П', '0'])).toEqual({ days: 2, hours: 15.5, sick: 1, vacation: 1, absent: 1 });
  });

  it('менеджер веде табель; виконавець — 403; «заповнити будні» не чіпає внесене; у журнал не пишеться', async () => {
    const m = await makeUser('iryna', ['Менеджер']);
    const r = await makeUser('roman', ['Цех']);
    const s = await loginAs('iryna');
    const month = kyivToday().slice(0, 7);
    const first = monthDays(month).find((d) => !d.weekend)!.date;
    expect((await s.agent.put('/api/time').set('X-VUDO', '1').send({ userId: r, date: first, value: '4,5' })).body).toEqual({ value: '4.5' });
    expect((await s.agent.put('/api/time').set('X-VUDO', '1').send({ userId: r, date: first, value: 'X' })).body.error).toBe('Години (0–24) або В, Л, ВП, П.');
    const fill = await s.post('/api/time/fill', { month });
    const workdays = monthDays(month).filter((d) => !d.weekend).length;
    expect(fill.body.filled).toBe(workdays * 2 - 1);
    const t = (await s.get(`/api/time?month=${month}`)).body;
    expect(t.values[r][first]).toBe('4.5');
    expect(t.users.map((u: { id: number }) => u.id).sort()).toEqual([m, r].sort());
    expect(await logTexts()).toEqual([]);
    expect((await (await loginAs('roman')).get('/api/time')).status).toBe(403);
  });
});

describe('база знань (12Б)', () => {
  it('стартові чернетки; «лише офіс» не бачать виконавці; ознайомлення і лічильник; повторне ознайомлення', async () => {
    await makeUser('iryna', ['Менеджер'], { name: 'Ірина' });
    await makeUser('roman', ['Цех'], { name: 'Роман' });
    const m = await loginAs('iryna');
    const r = await loginAs('roman');
    await m.post('/api/kb', { title: 'Місія', cat: 'Компанія', body: '…', vis: 'all', pinned: true, draft: true });
    expect((await r.get('/api/kb')).body.map((a: { title: string }) => a.title)).toEqual(['Місія']);
    expect((await r.get('/api/kb-unread')).body.total).toBe(0); // чернетки не потребують ознайомлення
    const pub = (await m.post('/api/kb', { title: 'Стандарти спілкування', cat: 'Клієнт', body: '# Стандарти\n- **ввічливо**', vis: 'all', pinned: false, draft: false })).body.id;
    const off = (await m.post('/api/kb', { title: 'Ціноутворення', cat: 'Регламенти', body: 'тільки офіс', vis: 'office', pinned: false, draft: false })).body.id;
    expect((await r.get('/api/kb-unread')).body.total).toBe(1);
    expect((await r.get(`/api/kb/${off}`)).status).toBe(404);
    expect((await r.post('/api/kb', { title: 'x', cat: 'Клієнт', body: '', vis: 'all', pinned: false, draft: false })).status).toBe(403);
    await r.post(`/api/kb/${pub}/read`);
    expect((await r.get('/api/kb-unread')).body.total).toBe(0);
    const det = (await m.get(`/api/kb/${pub}`)).body;
    expect(det.readers.find((x: { name: string }) => x.name === 'Роман').readAt).toBeTruthy();
    await m.patch(`/api/kb/${pub}`, { title: 'Стандарти спілкування', cat: 'Клієнт', body: 'нове', vis: 'all', pinned: false, draft: false, rereq: true });
    expect((await r.get('/api/kb-unread')).body.total).toBe(1);
    expect(await logTexts()).toContain('База знань: оновлено «Стандарти спілкування» — попрошено ознайомитись знову');
    const up = await m.agent.post(`/api/kb/${pub}/files`).set('X-VUDO', '1').attach('files', Buffer.from('%PDF'), 'стандарти.pdf');
    expect(up.status).toBe(201);
    const fid = (await r.get(`/api/kb/${pub}`)).body.files[0].id;
    expect((await r.get(`/api/kb-files/${fid}`)).status).toBe(200);
    expect((await m.agent.delete(`/api/kb/${off}`).set('X-VUDO', '1')).status).toBe(200);
  });
});

describe('експорт в Excel (12А)', () => {
  async function sheetsOf(buf: Buffer) {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    return wb;
  }
  const bin = (r: import('supertest').Test) =>
    r.buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

  it('замовлення: колонки за правами ролі; суми — числами; запис у журнал', async () => {
    const admin = await makeUser('admin', ['Адмін']);
    await makeUser('iryna', ['Менеджер']);
    await makeUser('roman', ['Цех']);
    const a = await loginAs('admin');
    const o = (await a.post('/api/orders', { phone: '+380671112233', name: 'Олена', source: 'сайт', managerId: admin })).body;
    await a.post(`/api/orders/${o.id}/items`, { name: 'Шафа', type: 'інше', description: '', pre: { korpus: 10000 }, designerPct: null });

    const ra = await bin(a.agent.get('/api/export/orders'));
    expect(ra.status).toBe(200);
    expect(decodeURIComponent(String(ra.headers['content-disposition']))).toMatch(/VUDO_Замовлення_\d{4}-\d{2}-\d{2}\.xlsx/);
    const wa = await sheetsOf(ra.body);
    const head = (ws: import('exceljs').Worksheet) => (ws.getRow(1).values as unknown[]).slice(1);
    expect(wa.worksheets.map((w) => w.name)).toEqual(['Замовлення', 'Вироби']);
    expect(head(wa.getWorksheet('Замовлення')!)).toEqual(expect.arrayContaining(['Ціна', 'Чистий прибуток']));
    const priceCol = head(wa.getWorksheet('Замовлення')!).indexOf('Ціна') + 1;
    expect(wa.getWorksheet('Замовлення')!.getRow(2).getCell(priceCol).value).toBe(15000);
    expect(wa.getWorksheet('Замовлення')!.autoFilter).toBeTruthy();

    const m = await loginAs('iryna');
    const hm = head((await sheetsOf((await bin(m.agent.get('/api/export/orders'))).body)).getWorksheet('Замовлення')!);
    expect(hm).toContain('Ціна');
    expect(hm).not.toContain('Чистий прибуток');

    const r = await loginAs('roman');
    const wr = await sheetsOf((await bin(r.agent.get('/api/export/orders'))).body);
    expect(wr.worksheets.map((w) => w.name)).toEqual(['Замовлення']);
    expect(head(wr.getWorksheet('Замовлення')!).join()).not.toMatch(/Ціна|Оплачено|Борг/);
    expect((await r.get('/api/export/finance')).status).toBe(403);
    expect(await logTexts()).toContain('Експорт в Excel: Замовлення');
  });

  it('фінанси: власник — 7 аркушів, менеджер — 2', async () => {
    await makeUser('admin', ['Адмін']);
    await makeUser('iryna', ['Менеджер']);
    const a = await loginAs('admin');
    const wa = await sheetsOf((await bin(a.agent.get('/api/export/finance'))).body);
    expect(wa.worksheets.map((w) => w.name)).toEqual(['Облік', 'P&L', 'Оплати', 'Борги', 'Дизайнерам', 'Постійні витрати', 'Статейник']);
    const m = await loginAs('iryna');
    const wm = await sheetsOf((await bin(m.agent.get('/api/export/finance'))).body);
    expect(wm.worksheets.map((w) => w.name)).toEqual(['Оплати', 'Борги']);
  });
});

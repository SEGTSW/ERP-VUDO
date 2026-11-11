import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { writeLog } from '../src/audit.js';
import { loginAs, logTexts, makeUser, resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => pool.end());

describe('налаштування (13)', () => {
  it('значення за замовчуванням з ТЗ', async () => {
    await makeUser('admin', ['Адмін']);
    const s = await loginAs('admin');
    const res = await s.get('/api/settings');
    expect(res.body).toMatchObject({ avansPct: 30, markupPct: 50, designerPct: 10, opexPct: 15, opexMode: 'auto', mgrPct: null });
    expect(res.body.norms['У виробництві']).toBe(14);
  });

  it('менеджер не бачить і не змінює полів звітності', async () => {
    await makeUser('iryna', ['Менеджер']);
    const s = await loginAs('iryna');
    const res = await s.get('/api/settings');
    expect(res.body).not.toHaveProperty('opexPct');
    expect(res.body).not.toHaveProperty('mgrPct');
    expect((await s.patch('/api/settings', { opexPct: 20 })).status).toBe(403);
    const ok = await s.patch('/api/settings', { avansPct: 40, markupPct: 55 });
    expect(ok.status).toBe(200);
    expect(ok.body.avansPct).toBe(40);
    expect(await logTexts()).toEqual(['Мінімальний аванс: 30% → 40%', 'Наша націнка: 50% → 55%']);
  });

  it('виконавці не мають доступу до налаштувань', async () => {
    await makeUser('stepan', ['Цех']);
    const s = await loginAs('stepan');
    expect((await s.get('/api/settings')).status).toBe(403);
  });

  it('норми: зміна і «без норми»; некоректні значення відхиляються', async () => {
    await makeUser('admin', ['Адмін']);
    const s = await loginAs('admin');
    const res = await s.patch('/api/settings', { norms: { 'Звернення': 2, 'Замір виконано': 4 } });
    expect(res.body.norms).toEqual({ 'Звернення': 2, 'Замір виконано': 4 });
    expect((await logTexts()).at(-1)).toContain('«Звернення»: 1 → 2');
    expect((await s.patch('/api/settings', { avansPct: 150 })).status).toBe(400);
    expect((await s.patch('/api/settings', { unknown: 1 })).status).toBe(400);
  });
});

describe('журнал і повідомлення (12)', () => {
  async function seedLog(by: number) {
    await writeLog(pool, { userId: by, folder: 'order', text: 'Статус «Звернення» → «Замір призначено»' });
    await writeLog(pool, { userId: by, folder: 'fin', finScope: 'pay', text: 'Внесено 10 000 грн' });
    await writeLog(pool, { userId: by, folder: 'fin', finScope: 'report', text: 'Облік: Витрата/Цех −5 000 грн' });
  }

  it('сервер фільтрує фінансові записи за роллю', async () => {
    const admin = await makeUser('admin', ['Адмін']);
    await makeUser('iryna', ['Менеджер']);
    await makeUser('stepan', ['Цех']);
    await seedLog(admin);
    const texts = async (login: string) =>
      ((await (await loginAs(login)).get('/api/log')).body.entries as { text: string }[]).map((e) => e.text);
    expect(await texts('admin')).toHaveLength(3);
    expect(await texts('iryna')).toEqual(['Внесено 10 000 грн', 'Статус «Звернення» → «Замір призначено»']);
    expect(await texts('stepan')).toEqual(['Статус «Звернення» → «Замір призначено»']);
  });

  it('лічильники нових: власні записи не нові; відкриття папки позначає прочитаним', async () => {
    const admin = await makeUser('admin', ['Адмін']);
    await makeUser('iryna', ['Менеджер']);
    await seedLog(admin);
    const m = await loginAs('iryna');
    expect((await m.get('/api/log/unread')).body.total).toBe(2);
    const a = await loginAs('admin');
    expect((await a.get('/api/log/unread')).body.total).toBe(0);

    const list = await m.get('/api/log?folder=fin');
    expect(list.body.entries[0].isNew).toBe(true);
    await m.post('/api/log/read', { folder: 'fin', upTo: list.body.entries[0].id });
    expect((await m.get('/api/log/unread')).body.total).toBe(1);
    await m.post('/api/log/read', { folder: 'all' });
    expect((await m.get('/api/log/unread')).body.total).toBe(0);
  });

  it('новий користувач не бачить стару історію як нову', async () => {
    const admin = await makeUser('admin', ['Адмін']);
    await seedLog(admin);
    const a = await loginAs('admin');
    await a.post('/api/users', { name: 'Новий', login: 'newbie', password: 'secret123', roles: ['Менеджер'] });
    const n = await loginAs('newbie', 'secret123');
    expect((await n.get('/api/log/unread')).body.total).toBe(0);
  });

  it('пагінація: before + hasMore', async () => {
    const admin = await makeUser('admin', ['Адмін']);
    for (let i = 0; i < 5; i++) await writeLog(pool, { userId: admin, folder: 'other', text: `запис ${i}` });
    const a = await loginAs('admin');
    const p1 = await a.get('/api/log?limit=3');
    expect(p1.body.entries.map((e: { text: string }) => e.text)).toEqual(['запис 4', 'запис 3', 'запис 2']);
    expect(p1.body.hasMore).toBe(true);
    const p2 = await a.get(`/api/log?limit=3&before=${p1.body.entries[2].id}`);
    expect(p2.body.entries).toHaveLength(2);
    expect(p2.body.hasMore).toBe(false);
  });

  it('запис у папку «Фінанси» без рівня доступу — помилка програміста', async () => {
    await expect(writeLog(pool, { userId: null, folder: 'fin', text: 'x' })).rejects.toThrow();
  });
});

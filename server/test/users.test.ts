import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { loginAs, logTexts, makeUser, resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => pool.end());

describe('користувачі (13.1)', () => {
  it('менеджер створює користувача; логін у нижньому регістрі; запис у журнал', async () => {
    await makeUser('iryna', ['Менеджер'], { name: 'Ірина' });
    const s = await loginAs('iryna');
    const res = await s.post('/api/users', { name: 'Степан Гнатюк', login: 'Stepan', password: 'secret123', roles: ['Цех'] });
    expect(res.status).toBe(201);
    expect(res.body.login).toBe('stepan');
    expect(await logTexts()).toContain('Новий користувач «Степан Гнатюк», ролі: Цех');
    // новий користувач може увійти
    await loginAs('stepan', 'secret123');
  });

  it('валідація: логін, пароль, ролі, унікальність', async () => {
    await makeUser('admin', ['Адмін']);
    const s = await loginAs('admin');
    const bad = async (body: object) => (await s.post('/api/users', body)).body.error;
    expect(await bad({ name: 'X', login: 'ab', password: 'secret123', roles: ['Цех'] })).toMatch(/Логін/);
    expect(await bad({ name: 'X', login: 'Іван', password: 'secret123', roles: ['Цех'] })).toMatch(/Логін/);
    expect(await bad({ name: 'X', login: 'ivan', password: '123', roles: ['Цех'] })).toMatch(/Пароль/);
    expect(await bad({ name: 'X', login: 'ivan', password: 'secret123', roles: [] })).toMatch(/роль/);
    expect(await bad({ name: 'X', login: 'admin', password: 'secret123', roles: ['Цех'] })).toBe('Такий логін уже зайнятий.');
  });

  it('виконавці не можуть створювати користувачів (немає самореєстрації)', async () => {
    await makeUser('maria', ['Конструктор']);
    const s = await loginAs('maria');
    expect((await s.post('/api/users', { name: 'X', login: 'xxx', password: 'secret123', roles: ['Адмін'] })).status).toBe(403);
    expect((await s.get('/api/users')).status).toBe(403);
  });

  it('вимкнення доступу завершує сесії користувача', async () => {
    await makeUser('admin', ['Адмін']);
    const oleh = await makeUser('oleh', ['Монтажник'], { name: 'Олег' });
    const a = await loginAs('admin');
    const o = await loginAs('oleh');
    expect((await o.get('/api/auth/me')).status).toBe(200);
    const res = await a.patch(`/api/users/${oleh}`, { disabled: true });
    expect(res.status).toBe(200);
    expect((await o.get('/api/auth/me')).status).toBe(401);
    expect(await logTexts()).toContain('Користувач «Олег»: доступ вимкнено');
  });

  it('останнього активного адміна не можна вимкнути чи зняти з нього роль', async () => {
    const admin = await makeUser('admin', ['Адмін']);
    await makeUser('iryna', ['Менеджер']);
    const m = await loginAs('iryna');
    expect((await m.patch(`/api/users/${admin}`, { disabled: true })).body.error).toBe('Не можна вимкнути останнього адміна.');
    expect((await m.patch(`/api/users/${admin}`, { roles: ['Менеджер'] })).body.error).toBe(
      'Це останній адмін — роль «Адмін» прибрати не можна.',
    );
    // з другим адміном — можна
    await makeUser('boss2', ['Адмін']);
    expect((await m.patch(`/api/users/${admin}`, { roles: ['Менеджер'] })).status).toBe(200);
  });

  it('не можна вимкнути самого себе', async () => {
    const admin = await makeUser('admin', ['Адмін']);
    await makeUser('boss2', ['Адмін']);
    const a = await loginAs('admin');
    expect((await a.patch(`/api/users/${admin}`, { disabled: true })).body.error).toBe('Не можна вимкнути доступ самому собі.');
  });

  it('зміни пишуться «поле: було → стало», пароль у журнал не потрапляє', async () => {
    await makeUser('admin', ['Адмін']);
    const id = await makeUser('roman', ['Цех'], { name: 'Роман' });
    const a = await loginAs('admin');
    await a.patch(`/api/users/${id}`, { login: 'roman.s', roles: ['Цех', 'Монтажник'], password: 'newsecret1' });
    const t = await logTexts();
    expect(t.at(-1)).toBe('Користувач «Роман»: логін: roman → roman.s; ролі: Цех → Цех, Монтажник; пароль змінено');
    expect(t.join()).not.toContain('newsecret1');
  });

  it('список людей для вибору доступний усім ролям', async () => {
    await makeUser('maria', ['Конструктор']);
    const s = await loginAs('maria');
    const res = await s.get('/api/people');
    expect(res.status).toBe(200);
    expect(res.body[0]).not.toHaveProperty('login');
  });
});

describe('мій профіль', () => {
  it('зберігає тему, стартовий розділ і рядків у списку', async () => {
    await makeUser('iryna', ['Менеджер']);
    const s = await loginAs('iryna');
    const res = await s.patch('/api/profile', { theme: 'dark', startSection: 'crm', ordersRows: 50, phone: '+380671112233' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ theme: 'dark', startSection: 'crm', ordersRows: 50 });
    expect(res.body.start).toBe('crm');
  });

  it('не можна вибрати стартовим розділ, недоступний ролі', async () => {
    await makeUser('maria', ['Конструктор']);
    const s = await loginAs('maria');
    expect((await s.patch('/api/profile', { startSection: 'finance' })).status).toBe(400);
  });

  it('зміна пароля: перевірка поточного, інші сесії завершуються', async () => {
    await makeUser('iryna', ['Менеджер'], { name: 'Ірина' });
    const s1 = await loginAs('iryna');
    const s2 = await loginAs('iryna');
    expect((await s1.post('/api/profile/password', { current: 'wrong', next: 'newpass123' })).body.error).toBe(
      'Поточний пароль неправильний.',
    );
    expect((await s1.post('/api/profile/password', { current: 'password1', next: 'newpass123' })).status).toBe(200);
    expect((await s1.get('/api/auth/me')).status).toBe(200);
    expect((await s2.get('/api/auth/me')).status).toBe(401);
    await loginAs('iryna', 'newpass123');
    expect(await logTexts()).toContain('Користувач «Ірина»: пароль змінено');
  });
});

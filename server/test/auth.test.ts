import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { pool } from '../src/db.js';
import { app, loginAs, makeUser, resetDb, PASS } from './helpers.js';

beforeEach(resetDb);
afterAll(() => pool.end());

const login = (body: object) => request(app).post('/api/auth/login').set('X-VUDO', '1').send(body);

describe('вхід і сесія', () => {
  it('успішний вхід ставить httpOnly-cookie і повертає меню та стартовий розділ', async () => {
    await makeUser('taras', ['Замірник', 'Монтажник']);
    const res = await login({ login: 'TARAS', password: PASS });
    expect(res.status).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/vudo_sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(res.body.start).toBe('myday');
    expect(res.body.money).toBe('none');
    expect(res.body.user).not.toHaveProperty('password_hash');
  });

  it('невірний пароль і неіснуючий логін — однакова відповідь', async () => {
    await makeUser('iryna', ['Менеджер']);
    const a = await login({ login: 'iryna', password: 'wrong' });
    const b = await login({ login: 'nobody', password: 'wrong' });
    expect(a.status).toBe(401);
    expect(a.body.error).toBe('Невірний логін або пароль');
    expect(b.body).toEqual(a.body);
  });

  it('вимкнений користувач не входить', async () => {
    await makeUser('oleh', ['Монтажник'], { disabled: true });
    const res = await login({ login: 'oleh', password: PASS });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Доступ вимкнено. Зверніться до адміністратора.');
  });

  it('після 10 невдалих спроб вхід блокується', async () => {
    await makeUser('iryna', ['Менеджер']);
    for (let i = 0; i < 10; i++) await login({ login: 'iryna', password: 'x' });
    const res = await login({ login: 'iryna', password: PASS });
    expect(res.status).toBe(429);
  });

  it('вихід завершує сесію', async () => {
    await makeUser('admin', ['Адмін']);
    const s = await loginAs('admin');
    expect((await s.get('/api/auth/me')).status).toBe(200);
    await s.post('/api/auth/logout');
    expect((await s.get('/api/auth/me')).status).toBe(401);
  });

  it('без сесії API відповідає 401', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  it('змінювальний запит без заголовка X-VUDO відхиляється (CSRF)', async () => {
    await makeUser('admin', ['Адмін']);
    const res = await request(app).post('/api/auth/login').send({ login: 'admin', password: PASS });
    expect(res.status).toBe(403);
  });

  it('у БД зберігається лише хеш пароля і хеш токена', async () => {
    await makeUser('admin', ['Адмін']);
    await loginAs('admin');
    const u = await pool.query('SELECT password_hash FROM users');
    expect(u.rows[0].password_hash).toMatch(/^\$argon2id\$/);
    const s = await pool.query('SELECT token_hash FROM sessions');
    expect(Buffer.isBuffer(s.rows[0].token_hash)).toBe(true);
  });
});

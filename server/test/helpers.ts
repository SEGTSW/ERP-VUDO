import request from 'supertest';
import type { Role } from '@vudo/shared';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { hashPassword } from '../src/auth/password.js';
import { resetLoginLimits } from '../src/auth/rateLimit.js';

export const app = createApp();

export const PASS = 'password1';

/** Очищає дані між тестами. */
export async function resetDb() {
  await pool.query(`TRUNCATE timesheet, designer_payouts, pnl_plan, cash_ops, issues, stock_items, plan_tasks, order_comments, order_files, payments, items, audit_log, orders, clients,
    log_reads, sessions, settings, users RESTART IDENTITY CASCADE`);
  await pool.query('ALTER SEQUENCE order_num_seq RESTART');
  resetLoginLimits();
}

let cachedHash: string | null = null;
export async function makeUser(login: string, roles: Role[], extra: { name?: string; disabled?: boolean } = {}) {
  cachedHash ??= await hashPassword(PASS);
  const r = await pool.query<{ id: number }>(
    `INSERT INTO users (name, login, password_hash, roles, disabled) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [extra.name ?? login, login, cachedHash, roles, extra.disabled ?? false],
  );
  return r.rows[0]!.id;
}

/** Агент із cookie сесії і заголовком X-VUDO на кожному запиті. */
export async function loginAs(login: string, password = PASS) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set('X-VUDO', '1').send({ login, password });
  if (res.status !== 200) throw new Error(`login ${login}: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    agent,
    get: (url: string) => agent.get(url),
    post: (url: string, body?: object) => agent.post(url).set('X-VUDO', '1').send(body ?? {}),
    patch: (url: string, body?: object) => agent.patch(url).set('X-VUDO', '1').send(body ?? {}),
  };
}

export async function logTexts(): Promise<string[]> {
  const r = await pool.query<{ text: string }>('SELECT text FROM audit_log ORDER BY id');
  return r.rows.map((x) => x.text);
}

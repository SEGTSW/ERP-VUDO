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

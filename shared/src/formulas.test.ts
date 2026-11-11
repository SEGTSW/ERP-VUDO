import { describe, expect, it } from 'vitest';
import { calcItem, calcOrder, lateDays, netProfit, priceDiff, priceFromCost, type ItemInput } from './formulas.js';
import { money, fmtDate, fmtDateTime, kyivToday, phoneKey } from './format.js';
import { navFor, startSection, moneyAccess } from './roles.js';
import { STATUSES, statusGroup } from './constants.js';
import { afterContract, nextStatuses, stagePassed } from './status.js';

const item = (pre: number, exact: number | null = null, dp = 0): ItemInput => ({
  pre: { korpus: pre },
  exact: exact == null ? null : { korpus: exact },
  designerTakesPct: dp,
});

describe('ТЗ 15.1 — контрольні приклади', () => {
  it('собівартість 15 000, націнка 50 %, дизайнер 0 % → ціна 22 500', () => {
    expect(priceFromCost(15000, 50, 0)).toBe(22500);
    expect(calcItem(item(15000), 50).designerShare).toBe(0);
  });

  it('те саме з «дизайнер бере» 10 % → ціна 24 750, частка дизайнера 2 250', () => {
    const c = calcItem(item(15000, null, 10), 50);
    expect(c.price).toBe(24750);
    expect(c.designerShare).toBe(2250);
  });

  it('попередня 385 000 → точна 409 300: +24 300 грн, +6,3 %', () => {
    expect(priceDiff(385000, 409300)).toEqual({ diff: 24300, pct: 6.3 });
    expect(priceDiff(577814, 614264)).toEqual({ diff: 36450, pct: 6.3 });
  });

  it('вироби 600 000 + доставка 5 000 − знижка 0 → ціна 605 000', () => {
    const c = calcOrder(
      { items: [item(400000)], delivery: 5000, discount: 0, discountType: 'грн', payments: [], partnerBonusPct: null },
      50,
    );
    expect(c.items).toBe(600000);
    expect(c.price).toBe(605000);
  });

  it('ціна 605 000, собівартість 319 000, дизайнеру 60 500, постійні 90 750 → прибуток 134 750 (22,3 %)', () => {
    const r = netProfit({ price: 605000, cost: 319000, designer: 60500, opex: 90750, materialsFact: 0, collabFact: 0, status: 'У виробництві' });
    expect(r.profit).toBe(134750);
    expect(Math.round(r.pct * 10) / 10).toBe(22.3);
  });

  it('оплати 200 000 і повернення 20 000 → оплачено 180 000, борг = ціна − 180 000', () => {
    const c = calcOrder(
      {
        items: [item(400000)],
        delivery: 5000,
        discount: 0,
        discountType: 'грн',
        payments: [{ type: 'аванс', sum: 200000 }, { type: 'повернення', sum: 20000 }],
        partnerBonusPct: null,
      },
      50,
    );
    expect(c.paid).toBe(180000);
    expect(c.debt).toBe(605000 - 180000);
    expect(c.avans).toBe(200000);
  });
});

describe('формули розділу 14', () => {
  it('точний прорахунок має пріоритет над попереднім', () => {
    const c = calcItem(item(10000, 12000), 50);
    expect(c.cost).toBe(12000);
    expect(c.prePrice).toBe(15000);
    expect(c.price).toBe(18000);
  });

  it('точний з усіма нулями вважається відсутнім', () => {
    const c = calcItem({ pre: { korpus: 10000 }, exact: { korpus: 0, top: 0 }, designerTakesPct: 0 }, 50);
    expect(c.exactCost).toBeNull();
    expect(c.price).toBe(15000);
  });

  it('знижка у % рахується від (вироби + доставка), ціна не менше 0', () => {
    const base = { items: [item(10000)], delivery: 1000, payments: [], partnerBonusPct: null };
    expect(calcOrder({ ...base, discount: 10, discountType: '%' }, 50).price).toBe(14400);
    expect(calcOrder({ ...base, discount: 99999, discountType: 'грн' }, 50).price).toBe(0);
  });

  it('дизайнеру (план) = більше з бонусу партнера і часток у цінах', () => {
    const c = calcOrder(
      { items: [item(15000, null, 10)], delivery: 0, discount: 0, discountType: 'грн', payments: [], partnerBonusPct: 5 },
      50,
    );
    expect(c.partnerBonus).toBe(1237.5);
    expect(c.designerShares).toBe(2250);
    expect(c.designer).toBe(2250);
    expect(c.margin).toBe(24750 - 15000 - 2250);
  });

  it('чистий прибуток: факт матеріалів більший за план; у «Закрито» — лише факт', () => {
    const base = { price: 100000, cost: 50000, designer: 0, opex: 10000, materialsFact: 60000, collabFact: 0 };
    expect(netProfit({ ...base, status: 'У виробництві' }).profit).toBe(30000);
    expect(netProfit({ ...base, materialsFact: 40000, status: 'Закрито' }).profit).toBe(50000);
    expect(netProfit({ ...base, materialsFact: 40000, status: 'У виробництві' }).profit).toBe(40000);
  });

  it('прострочення = днів у статусі − норма', () => {
    expect(lateDays('2026-11-01', 3, '2026-11-10')).toBe(6);
    expect(lateDays('2026-11-08', 3, '2026-11-10')).toBe(0);
    expect(lateDays('2026-01-01', undefined, '2026-11-10')).toBe(0);
  });
});

describe('формати і ролі', () => {
  it('гроші у форматі «40 000 грн»', () => {
    expect(money(40000).replace(/\s/g, ' ')).toBe('40 000 грн');
    expect(money(1234.567).replace(/\s/g, ' ')).toBe('1 234,57 грн');
  });

  it('дати за Києвом', () => {
    expect(fmtDate('2026-11-10')).toBe('10.11.2026');
    expect(fmtDateTime('2026-11-09T22:30:00Z')).toBe('10.11.2026 00:30');
    expect(kyivToday(new Date('2026-11-09T22:30:00Z'))).toBe('2026-11-10');
    expect(phoneKey('+38 (067) 123-45-67')).toBe('0671234567');
  });

  it('меню і стартовий розділ за ролями', () => {
    expect(navFor({ roles: ['Менеджер'] }).find((n) => n.key === 'finance')?.label).toBe('Оплати');
    expect(navFor({ roles: ['Адмін'] }).find((n) => n.key === 'finance')?.label).toBe('Фінанси');
    expect(navFor({ roles: ['Замірник', 'Монтажник'] }).map((n) => n.key)).toEqual(['myday', 'orders', 'plan', 'kb', 'notes']);
    expect(navFor({ roles: ['Цех'] }).map((n) => n.key)).toEqual(['orders', 'stock', 'plan', 'kb', 'notes']);
    expect(startSection({ roles: ['Монтажник'] })).toBe('myday');
    expect(startSection({ roles: ['Цех'], startSection: 'finance' })).toBe('orders');
    expect(moneyAccess({ roles: ['Цех', 'Менеджер'] })).toBe('pay');
  });
});

describe('порядок статусів (погоджено із замовником)', () => {
  it('Звернення → Прорахунок → Замір → Очікування → Проєктування → Договір', () => {
    expect(STATUSES.slice(0, 8)).toEqual([
      'Звернення', 'Прорахунок', 'Замір призначено', 'Замір виконано', 'Очікує рішення клієнта', 'Проєктування', 'Проєкт погоджено', 'Договір / аванс отримано',
    ]);
    expect(nextStatuses('Звернення')).toEqual(['Прорахунок', 'Відмова']);
    expect(nextStatuses('Проєкт погоджено')).toEqual(['Договір / аванс отримано', 'Відмова']);
    expect(nextStatuses('Договір / аванс отримано')).toEqual(['Закупівля матеріалів']);
  });

  it('до договору — продажі; договір фіксує «після договору»; етапи плану за статусами', () => {
    expect(statusGroup('Проєкт погоджено')).toBe('sale');
    expect(statusGroup('Договір / аванс отримано')).toBe('work');
    expect(afterContract('Проєкт погоджено')).toBe(false);
    expect(afterContract('Договір / аванс отримано')).toBe(true);
    expect(stagePassed('Замір виконано', 'Замір')).toBe(true);
    expect(stagePassed('Замір виконано', 'Прорахунок')).toBe(false);
    expect(stagePassed('Проєкт погоджено', 'Конструктив')).toBe(true);
    expect(stagePassed('Договір / аванс отримано', 'Збірка')).toBe(false);
  });
});

describe('P&L — формули 18–19', () => {
  it('виручка, маржа, результат, операційна маржа', async () => {
    const { pnlDerived, planSigned } = await import('./pnl.js');
    const d = pnlDerived({ income: 621284, orderCost: -321850, admin: -40413, payroll: -90386, marketing: -10000, credit: 5000 });
    expect(d.revenue).toBe(299434);
    expect(Math.round(d.margin! * 10) / 10).toBe(48.2);
    expect(d.result).toBe(299434 - 40413 - 90386 - 10000 + 5000);
    expect(planSigned('admin', 40413)).toBe(-40413);
    expect(planSigned('credit', -5000)).toBe(-5000);
    expect(planSigned('income', 100)).toBe(100);
  });
});

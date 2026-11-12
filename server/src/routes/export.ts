/**
 * 12А Експорт в Excel: файл VUDO_<розділ>_<дата>.xlsx. Суми — числами, дати — ДД.ММ.РРРР,
 * у кожному аркуші автофільтр і ширина колонок за вмістом. Кожен експорт — запис у журнал.
 *
 * Права: дані беруться через ті самі API-запити від імені користувача (його ж сесія),
 * тож у файл потрапляє лише те, що сервер віддає цій ролі. Колонки звітності — лише власнику.
 */
import { Router, type Request } from 'express';
import ExcelJS from 'exceljs';
import { addDays, folderLabel, isOffice, isOwner, kyivToday, lineLabel, moneyAccess, type LogFolder } from '@vudo/shared';
import { HttpError, badRequest, forbidden } from '../errors.js';
import { me } from '../auth/middleware.js';
import { writeLog } from '../audit.js';
import { pool } from '../db.js';
import type { User } from '../users.js';

type Kind = 'text' | 'money' | 'date' | 'int' | 'num' | 'pct';
interface Col {
  h: string;
  k: string;
  t?: Kind;
}
type Row = Record<string, unknown>;
interface Sheet {
  name: string;
  cols: Col[];
  rows: Row[];
}

/** Запит до власного API від імені користувача (та сама сесія — ті самі права). */
async function internal<T>(req: Request, path: string): Promise<T> {
  const port = req.socket.localPort;
  const r = await fetch(`http://127.0.0.1:${port}/api${path}`, { headers: { cookie: req.get('cookie') ?? '', 'X-VUDO': '1' } });
  if (r.status === 403) throw forbidden();
  if (!r.ok) throw new HttpError(r.status, 'Не вдалося сформувати файл. Спробуйте ще раз.');
  return (await r.json()) as T;
}

const toDate = (s: unknown) => {
  if (typeof s !== 'string' || !s) return null;
  const d = s.length === 10 ? new Date(`${s}T00:00:00Z`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

async function workbook(sheets: Sheet[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VUDO ERP';
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    ws.addRow(s.cols.map((c) => c.h)).font = { bold: true };
    for (const r of s.rows) {
      ws.addRow(
        s.cols.map((c) => {
          const v = r[c.k];
          if (v == null || v === '') return null;
          if (c.t === 'date') return toDate(v);
          if (c.t === 'money' || c.t === 'int' || c.t === 'num' || c.t === 'pct') return Number(v);
          return Array.isArray(v) ? v.join(', ') : String(v);
        }),
      );
    }
    s.cols.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      if (c.t === 'money') col.numFmt = '#,##0.00';
      if (c.t === 'date') col.numFmt = 'dd.mm.yyyy';
      if (c.t === 'pct') col.numFmt = '0.0';
      // ширина за вмістом
      let w = c.h.length;
      col.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        const len = v instanceof Date ? 10 : typeof v === 'number' ? String(Math.round(v)).length + 4 : String(v ?? '').length;
        w = Math.max(w, len);
      });
      col.width = Math.min(60, w + 2);
    });
    if (s.cols.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + s.rows.length, column: s.cols.length } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ---------- Розділи ---------- */

async function ordersSheets(req: Request, u: User): Promise<Sheet[]> {
  const qs = new URLSearchParams(req.query as Record<string, string>).toString();
  if (!isOffice(u)) {
    const list = await internal<Row[]>(req, `/orders?${qs}`);
    return [
      {
        name: 'Замовлення',
        cols: [
          { h: '№', k: 'num' },
          { h: 'Клієнт', k: 'client' },
          { h: 'Телефон', k: 'phone' },
          { h: 'Адреса', k: 'address' },
          { h: 'Статус', k: 'status' },
          { h: 'Вироби', k: 'itemNames' },
          { h: 'Мої етапи', k: 'myStages' },
          { h: 'Монтаж', k: 'installDate', t: 'date' },
        ],
        rows: list.map((o) => ({ ...o, client: (o.client as Row).name, phone: (o.client as Row).phone })),
      },
    ];
  }
  const list = await internal<{ id: number }[]>(req, `/orders?${qs}`);
  const owner = isOwner(u);
  const cards = await Promise.all(list.map((o) => internal<Row>(req, `/orders/${o.id}`)));
  const people = new Map((await pool.query<{ id: number; name: string }>('SELECT id, name FROM users')).rows.map((p) => [p.id, p.name]));
  const nm = (id: unknown) => (typeof id === 'number' ? (people.get(id) ?? '') : '');
  const rows = cards.map((c) => {
    const sums = c.sums as Row;
    const own = c.owner as Row | null;
    const client = c.client as Row;
    const des = c.designer as Row | null;
    return {
      num: c.num,
      created: c.createdDate,
      client: client.name,
      phone: client.phone,
      status: c.status,
      manager: c.managerName,
      source: c.source,
      designer: des ? [des.name, des.company].filter(Boolean).join(' · ') : '',
      address: c.address,
      measurer: nm(c.measurerId),
      constructor: nm(c.constructorId),
      installers: (c.installerIds as number[]).map(nm).join(', '),
      measureDate: c.measureDate,
      installDate: c.installDate,
      readyDate: c.readyDate,
      contractDate: c.contractDate,
      price: sums.price,
      paid: sums.paid,
      debt: sums.debt,
      cost: sums.cost,
      designerSum: sums.designer,
      opex: own?.opex,
      netProfit: own?.netProfit,
      netPct: own?.netPct,
    };
  });
  const cols: Col[] = [
    { h: '№', k: 'num' },
    { h: 'Створено', k: 'created', t: 'date' },
    { h: 'Клієнт', k: 'client' },
    { h: 'Телефон', k: 'phone' },
    { h: 'Статус', k: 'status' },
    { h: 'Менеджер', k: 'manager' },
    { h: 'Джерело', k: 'source' },
    { h: 'Дизайнер', k: 'designer' },
    { h: 'Адреса', k: 'address' },
    { h: 'Замірник', k: 'measurer' },
    { h: 'Конструктор', k: 'constructor' },
    { h: 'Монтажники', k: 'installers' },
    { h: 'Дата заміру', k: 'measureDate', t: 'date' },
    { h: 'Монтаж', k: 'installDate', t: 'date' },
    { h: 'Готовність', k: 'readyDate', t: 'date' },
    { h: 'Дата договору', k: 'contractDate', t: 'date' },
    { h: 'Ціна', k: 'price', t: 'money' },
    { h: 'Оплачено', k: 'paid', t: 'money' },
    { h: 'Борг', k: 'debt', t: 'money' },
    { h: 'Собівартість', k: 'cost', t: 'money' },
    { h: 'Дизайнеру', k: 'designerSum', t: 'money' },
    ...(owner
      ? ([
          { h: 'Постійні витрати', k: 'opex', t: 'money' },
          { h: 'Чистий прибуток', k: 'netProfit', t: 'money' },
          { h: 'Чистий прибуток, %', k: 'netPct', t: 'pct' },
        ] as Col[])
      : []),
  ];
  const items = cards.flatMap((c) =>
    (c.items as Row[]).map((i) => {
      const calc = i.calc as Row;
      const pre = (i.pre ?? {}) as Row;
      return {
        num: c.num,
        name: i.name,
        type: i.type,
        korpus: pre.korpus,
        facade: pre.facade,
        top: pre.top,
        furn: pre.furn,
        light: pre.light,
        profile: pre.profile,
        preCost: calc.preCost,
        exactCost: calc.exactCost,
        price: calc.price,
      };
    }),
  );
  return [
    { name: 'Замовлення', cols, rows },
    {
      name: 'Вироби',
      cols: [
        { h: '№ замовлення', k: 'num' },
        { h: 'Виріб', k: 'name' },
        { h: 'Тип', k: 'type' },
        { h: 'Корпус', k: 'korpus', t: 'money' },
        { h: 'Фасади', k: 'facade', t: 'money' },
        { h: 'Стільниця', k: 'top', t: 'money' },
        { h: 'Фурнітура', k: 'furn', t: 'money' },
        { h: 'Підсвітка', k: 'light', t: 'money' },
        { h: 'Профіль', k: 'profile', t: 'money' },
        { h: 'Собівартість (попер.)', k: 'preCost', t: 'money' },
        { h: 'Собівартість (точна)', k: 'exactCost', t: 'money' },
        { h: 'Ціна', k: 'price', t: 'money' },
      ],
      rows: items,
    },
  ];
}

async function clientsSheets(req: Request, kind: 'clients' | 'designers'): Promise<Sheet[]> {
  const rows = await internal<Row[]>(req, `/clients?kind=${kind}&archived=${req.query.archived === '1' ? '1' : '0'}`);
  if (kind === 'designers') {
    return [
      {
        name: 'Дизайнери-партнери',
        cols: [
          { h: "Ім'я", k: 'name' },
          { h: 'Компанія', k: 'company' },
          { h: 'Телефон', k: 'phone' },
          { h: 'Email', k: 'email' },
          { h: 'Бонус, %', k: 'effectiveBonusPct', t: 'num' },
          { h: 'Замовлень', k: 'ordersCount', t: 'int' },
          { h: 'У роботі', k: 'activeCount', t: 'int' },
        ],
        rows,
      },
    ];
  }
  return [
    {
      name: 'Клієнти',
      cols: [
        { h: 'Клієнт', k: 'name' },
        { h: 'Тип', k: 'type' },
        { h: 'Телефон', k: 'phone' },
        { h: 'Email', k: 'email' },
        { h: 'Джерело', k: 'source' },
        { h: 'Адреси', k: 'addresses' },
        { h: 'Замовлень', k: 'ordersCount', t: 'int' },
        { h: 'Сума договорів', k: 'purchases', t: 'money' },
        { h: 'Борг', k: 'debt', t: 'money' },
      ],
      rows,
    },
  ];
}

async function financeSheets(req: Request, u: User): Promise<Sheet[]> {
  const pay = await internal<{ rows: Row[] }>(req, '/money/payments');
  const debts = await internal<{ rows: Row[] }>(req, '/money/debts');
  const paySheet: Sheet = {
    name: 'Оплати',
    cols: [
      { h: 'Дата', k: 'date', t: 'date' },
      { h: '№', k: 'num' },
      { h: 'Клієнт', k: 'client' },
      { h: 'Тип', k: 'type' },
      { h: 'Спосіб', k: 'method' },
      { h: 'Менеджер', k: 'managerName' },
      { h: 'Вніс(ла)', k: 'byName' },
      { h: 'Сума', k: 'signed', t: 'money' },
    ],
    rows: pay.rows.map((p) => ({ ...p, signed: (p.type === 'повернення' ? -1 : 1) * Number(p.sum) })),
  };
  const debtSheet: Sheet = {
    name: 'Борги',
    cols: [
      { h: '№', k: 'num' },
      { h: 'Клієнт', k: 'client' },
      { h: 'Телефон', k: 'phone' },
      { h: 'Статус', k: 'status' },
      { h: 'Менеджер', k: 'managerName' },
      { h: 'Монтаж', k: 'installDate', t: 'date' },
      { h: 'Ціна', k: 'price', t: 'money' },
      { h: 'Оплачено', k: 'paid', t: 'money' },
      { h: 'Борг', k: 'debt', t: 'money' },
    ],
    rows: debts.rows,
  };
  // Менеджер: лише Оплати і Борги
  if (!isOwner(u)) return [paySheet, debtSheet];

  const cash = await internal<{ rows: Row[] }>(req, '/finance/cash?month=');
  const year = Number(kyivToday().slice(0, 4));
  const pnl = await internal<{ months: string[]; fact: Record<string, Row>; plan: Record<string, Row> }>(req, `/finance/pnl?year=${year}`);
  const des = await internal<{ rows: Row[] }>(req, '/money/designers');
  const fixed = await internal<{ rows: Row[] }>(req, '/finance/fixed');
  const arts = await internal<Row[]>(req, '/finance/articles');
  const lines = ['income', 'orderCost', 'admin', 'payroll', 'other', 'marketing', 'tax', 'logistics', 'collab', 'credit', 'working', 'invPlus', 'invMinus', 'dividends', 'loan'];
  return [
    {
      name: 'Облік',
      cols: [
        { h: 'Дата', k: 'date', t: 'date' },
        { h: 'Стаття', k: 'type' },
        { h: 'Підстаття', k: 'cat' },
        { h: "Об'єкт", k: 'obj' },
        { h: 'Контрагент', k: 'counterparty' },
        { h: 'Примітка', k: 'note' },
        { h: 'Рядок P&L', k: 'lineName' },
        { h: 'Карта, грн', k: 'card', t: 'money' },
        { h: 'Готівка, грн', k: 'cash', t: 'money' },
      ],
      rows: cash.rows.map((r) => ({
        ...r,
        lineName: lineLabel(String(r.line)),
        card: r.account === 'Карта' ? r.sum : null,
        cash: r.account === 'Готівка' ? r.sum : null,
      })),
    },
    {
      name: 'P&L',
      cols: [{ h: 'Рядок', k: 'line' }, { h: 'План / факт', k: 'kind' }, ...pnl.months.map((m) => ({ h: m, k: m, t: 'money' as Kind }))],
      rows: lines.flatMap((l) => [
        { line: lineLabel(l), kind: 'план', ...Object.fromEntries(pnl.months.map((m) => [m, pnl.plan[m]?.[l]])) },
        { line: lineLabel(l), kind: 'факт', ...Object.fromEntries(pnl.months.map((m) => [m, pnl.fact[m]?.[l]])) },
      ]),
    },
    paySheet,
    debtSheet,
    {
      name: 'Дизайнерам',
      cols: [
        { h: 'Дизайнер', k: 'label' },
        { h: 'Телефон', k: 'phone' },
        { h: 'Договорів', k: 'contracts', t: 'int' },
        { h: 'Сума договорів', k: 'sales', t: 'money' },
        { h: 'Бонус, %', k: 'bonusPct', t: 'num' },
        { h: 'Нараховано', k: 'accrued', t: 'money' },
        { h: 'Виплачено', k: 'paid', t: 'money' },
        { h: 'Винні', k: 'owe', t: 'money' },
      ],
      rows: des.rows,
    },
    {
      name: 'Постійні витрати',
      cols: [
        { h: 'Назва', k: 'name' },
        { h: 'Підстаття', k: 'cat' },
        { h: "Об'єкт", k: 'obj' },
        { h: 'Сума', k: 'amount', t: 'money' },
        { h: 'Періодичність', k: 'period' },
        { h: 'На місяць', k: 'perMonth', t: 'money' },
        { h: 'Сплачено за місяць', k: 'paid', t: 'money' },
        { h: 'Увімкнено', k: 'activeText' },
      ],
      rows: fixed.rows.map((x) => ({ ...x, activeText: x.active ? 'так' : 'ні' })),
    },
    {
      name: 'Статейник',
      cols: [
        { h: 'Стаття', k: 'type' },
        { h: 'Підстаття', k: 'cat' },
        { h: "Об'єкт", k: 'obj' },
        { h: 'Контрагент', k: 'defaultCp' },
        { h: 'Рядок P&L', k: 'lineName' },
        { h: 'До замовлення', k: 'orderText' },
        { h: 'Операцій', k: 'ops', t: 'int' },
      ],
      rows: arts.map((a) => ({ ...a, lineName: lineLabel(String(a.line)), orderText: a.toOrder ? 'так' : '' })),
    },
  ];
}

async function planSheets(req: Request): Promise<Sheet[]> {
  const p = await internal<{ tasks: Row[] }>(req, '/plan');
  return [
    {
      name: 'Планування',
      cols: [
        { h: 'Замовлення', k: 'orderNum' },
        { h: 'Клієнт', k: 'clientName' },
        { h: 'Адреса', k: 'address' },
        { h: 'Етап', k: 'stage' },
        { h: 'Відповідальний', k: 'assigneeName' },
        { h: 'Початок', k: 'start', t: 'date' },
        { h: 'Кінець', k: 'last', t: 'date' },
        { h: 'Днів', k: 'days', t: 'int' },
        { h: 'Виконано, %', k: 'progress', t: 'int' },
        { h: 'Стан', k: 'state' },
      ],
      rows: p.tasks.map((t) => {
        const s = t.sched as Row;
        return {
          ...t,
          start: s.planned ? s.start : null,
          last: s.last,
          state: s.done ? 'виконано' : s.late ? `прострочено на ${s.lateBy} дн.` : s.planned ? 'за планом' : 'дні не вказано',
        };
      }),
    },
  ];
}

async function mydaySheets(req: Request): Promise<Sheet[]> {
  const from = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : kyivToday();
  const user = typeof req.query.user === 'string' ? `&user=${encodeURIComponent(req.query.user)}` : '';
  const rows: Row[] = [];
  for (let k = 0; k < 14; k++) {
    const day = addDays(from, k);
    const d = await internal<{ visits: Row[] }>(req, `/myday?date=${day}${user}`);
    for (const v of d.visits) rows.push({ ...v, day, items: (v.items as Row[]).map((i) => i.name).join(', ') });
  }
  return [
    {
      name: 'Виїзди',
      cols: [
        { h: 'Дата', k: 'day', t: 'date' },
        { h: 'Тип', k: 'stage' },
        { h: '№', k: 'num' },
        { h: 'Адреса', k: 'address' },
        { h: 'Клієнт', k: 'clientName' },
        { h: 'Телефон', k: 'phone' },
        { h: 'Вироби', k: 'items' },
        { h: 'Коментар', k: 'comment' },
      ],
      rows,
    },
  ];
}

async function stockSheets(req: Request): Promise<Sheet[]> {
  const rows = await internal<Row[]>(req, '/stock');
  return [
    {
      name: 'Склад залишків',
      cols: [
        { h: 'Тип', k: 'kind' },
        { h: 'Матеріал', k: 'material' },
        { h: 'Товщина, мм', k: 'thick', t: 'int' },
        { h: 'Ширина, мм', k: 'w', t: 'int' },
        { h: 'Висота, мм', k: 'h', t: 'int' },
        { h: 'Площа, м²', k: 'area', t: 'num' },
        { h: 'Кількість', k: 'qty', t: 'num' },
        { h: 'Одиниця', k: 'unit' },
        { h: 'Місце', k: 'place' },
        { h: 'Звідки', k: 'from' },
        { h: 'Статус', k: 'status' },
        { h: 'Резерв під №', k: 'resNum' },
      ],
      rows: rows.map((x) => ({
        ...x,
        area: x.w && x.h ? Math.round((Number(x.w) * Number(x.h) * Number(x.qty)) / 10000) / 100 : null,
        from: x.fromNum ? `№${x.fromNum} · ${x.fromClient}` : '',
      })),
    },
  ];
}

async function timeSheets(req: Request): Promise<Sheet[]> {
  const month = typeof req.query.month === 'string' ? req.query.month : kyivToday().slice(0, 7);
  const t = await internal<{ days: { date: string; n: number }[]; users: Row[]; values: Record<string, Record<string, string>> }>(req, `/time?month=${month}`);
  const { timeTotals } = await import('@vudo/shared');
  return [
    {
      name: 'Табель',
      cols: [
        { h: 'Працівник', k: 'name' },
        { h: 'Роль', k: 'roles' },
        ...t.days.map((d) => ({ h: String(d.n), k: d.date })),
        { h: 'Днів', k: 'days', t: 'int' },
        { h: 'Годин', k: 'hours', t: 'num' },
        { h: 'Лікарняних', k: 'sick', t: 'int' },
        { h: 'Відпустки', k: 'vacation', t: 'int' },
        { h: 'Прогулів', k: 'absent', t: 'int' },
      ],
      rows: t.users.map((u) => {
        const v = t.values[String(u.id)] ?? {};
        return { ...u, ...v, ...timeTotals(Object.values(v)) };
      }),
    },
  ];
}

async function statsSheets(req: Request, u: User): Promise<Sheet[]> {
  const s = await internal<{ months: Row[]; sources: Row[]; managers: Row[] }>(req, `/stats?period=${req.query.period ?? 'year'}`);
  const owner = isOwner(u);
  const groupCols = (first: string): Col[] => [
    { h: first, k: 'name' },
    { h: 'Звернень', k: 'leads', t: 'int' },
    { h: 'Договорів', k: 'won', t: 'int' },
    { h: 'Конверсія, %', k: 'conv', t: 'pct' },
    { h: 'Сума', k: 'sum', t: 'money' },
    { h: 'Середній чек', k: 'avg', t: 'money' },
    ...(owner ? [{ h: 'Маржа, %', k: 'marginPct', t: 'pct' as Kind }] : []),
  ];
  const withAvg = (rows: Row[]) => rows.map((r) => ({ ...r, avg: Number(r.won) ? Number(r.sum) / Number(r.won) : null }));
  return [
    {
      name: 'По місяцях',
      cols: [
        { h: 'Місяць', k: 'key' },
        { h: 'Договорів', k: 'n', t: 'int' },
        { h: 'Сума', k: 'v', t: 'money' },
      ],
      rows: s.months,
    },
    { name: 'Джерела', cols: groupCols('Джерело'), rows: withAvg(s.sources) },
    { name: 'Менеджери', cols: groupCols('Менеджер'), rows: withAvg(s.managers) },
  ];
}

async function notesSheets(req: Request, u: User): Promise<Sheet[]> {
  const rows: Row[] = [];
  let before = '';
  // Журнал повністю (лише доступні цій ролі записи — фільтрує /log)
  for (let i = 0; i < 100; i++) {
    const p = await internal<{ entries: Row[]; hasMore: boolean }>(req, `/log?limit=200${before ? `&before=${before}` : ''}`);
    rows.push(...p.entries);
    if (!p.hasMore || !p.entries.length) break;
    before = String(p.entries.at(-1)!.id);
  }
  const owner = moneyAccess(u) === 'report';
  return [
    {
      name: 'Повідомлення',
      cols: [
        { h: 'Дата і час', k: 'at', t: 'date' },
        { h: 'Хто', k: 'userName' },
        { h: 'Замовлення', k: 'orderNum' },
        { h: 'Папка', k: 'folderName' },
        { h: 'Запис', k: 'text' },
      ],
      rows: rows.map((r) => ({ ...r, folderName: folderLabel(r.folder as LogFolder, owner) })),
    },
  ];
}

const SECTIONS: Record<string, { file: string; build: (req: Request, u: User) => Promise<Sheet[]> }> = {
  orders: { file: 'Замовлення', build: ordersSheets },
  crm: { file: 'CRM', build: ordersSheets },
  clients: { file: 'Клієнти', build: (r) => clientsSheets(r, 'clients') },
  designers: { file: 'Дизайнери', build: (r) => clientsSheets(r, 'designers') },
  finance: { file: 'Фінанси', build: financeSheets },
  plan: { file: 'Планування', build: planSheets },
  myday: { file: 'Виїзди', build: mydaySheets },
  stock: { file: 'Склад', build: stockSheets },
  time: { file: 'Табель', build: timeSheets },
  stats: { file: 'Аналітика', build: statsSheets },
  notes: { file: 'Повідомлення', build: notesSheets },
};

export const exportRouter = Router();

exportRouter.get('/export/:section', async (req, res) => {
  const sec = SECTIONS[String(req.params.section)];
  if (!sec) throw badRequest('Невідомий розділ для експорту.');
  const u = me(req);
  const sheets = await sec.build(req, u);
  const buf = await workbook(sheets);
  const name = `VUDO_${sec.file}_${kyivToday()}.xlsx`;
  await writeLog(pool, { userId: u.id, folder: 'other', text: `Експорт в Excel: ${sec.file}` });
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.attachment(name);
  res.send(buf);
});

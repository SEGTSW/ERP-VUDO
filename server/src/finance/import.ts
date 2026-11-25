/**
 * Імпорт наявного обліку і плану P&L з Excel (ТЗ 10.1, 10.2).
 *
 * Облік: колонки Дата | Стаття | Підстаття | Обєкт | Контрагент | Примітка | USD | UAH | UAH(готівка) | ТОВ ВУДО | ФОП.
 *  - рядки без дати беруть дату попереднього; дата текстом («Старт 15.07.2026») — розпізнається;
 *  - сума UAH → каса «Карта», UAH(готівка) → «Готівка», ТОВ → «ТОВ», ФОП → «ФОП» (кілька в рядку — кілька операцій);
 *  - повторний імпорт не дублює записів (ключ: дата + примітка + сума + каса; однакові операції
 *    в самому файлі — справжні, тому додається лише різниця між кількістю у файлі і в базі).
 * План P&L: перший стовпець — назва рядка P&L, у заголовку — місяці (ММ.РРРР або дата).
 */
import ExcelJS from 'exceljs';
import type pg from 'pg';
import { writeLog } from '../audit.js';
import { ART_TYPES, FUTURE_CLOSED, FUTURE_CLOSED_LABEL, INVEST_LINES, LINE_KIND, PNL_LINES, planSigned, type Account, type PnlLine } from '@vudo/shared';

type Cell = ExcelJS.CellValue;

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Значення клітинки без формул і форматування. */
function plain(v: Cell): unknown {
  if (v && typeof v === 'object') {
    if (v instanceof Date) return v;
    if ('result' in v) return plain(v.result as Cell);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
  }
  return v;
}

/** Дата з клітинки: Date, «15.07.2026», «Старт 15.07.2026», «2026-07-15». */
export function parseDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return isoDate(v);
  if (typeof v === 'number' && v > 30000 && v < 80000) return isoDate(new Date(Date.UTC(1899, 11, 30) + v * 86400000));
  if (typeof v === 'string') {
    let m = v.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (m) return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
    m = v.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/\s/g, '').replace(',', '.'));
    return v.trim() && Number.isFinite(n) ? n : null;
  }
  return null;
}

const str = (v: unknown) => (v == null ? '' : String(v).trim());
const norm = (s: string) => s.toLowerCase().replace(/[^a-zа-яіїєґ0-9()]/gi, '');

export interface ImportReport {
  rows: number;
  added: number;
  duplicates: number;
  skipped: { row: number; reason: string }[];
  articlesAdded: number;
  byAccount: Record<Account, number>;
}

interface CashImportRow {
  date: string;
  type: string;
  cat: string;
  obj: string;
  counterparty: string;
  note: string;
  account: Account;
  sum: number;
}

/** Розбирає аркуш обліку (за назвами колонок у рядку заголовка). */
export function parseCashSheet(ws: ExcelJS.Worksheet): { rows: CashImportRow[]; skipped: ImportReport['skipped']; total: number } {
  let headerRow = 0;
  const col: Record<string, number> = {};
  ws.eachRow((row, i) => {
    if (headerRow) return;
    const vals = (row.values as Cell[]).map((v) => norm(str(plain(v))));
    if (vals.includes('дата') && vals.includes('стаття')) {
      headerRow = i;
      vals.forEach((v, k) => {
        if (v === 'дата') col.date = k;
        else if (v === 'стаття') col.type = k;
        else if (v === 'підстаття') col.cat = k;
        else if (v === 'обєкт' || v === "об'єкт" || v === 'обєкт') col.obj = k;
        else if (v === 'контрагент') col.cp = k;
        else if (v === 'примітка') col.note = k;
        else if (v === 'usd') col.usd = k;
        else if (v === 'uah') col.uah = k;
        else if (v === 'uah(готівка)' || v === 'uahготівка') col.cash = k;
        else if (v.startsWith('тов')) col.tov = k;
        else if (v.startsWith('фоп')) col.fop = k;
      });
    }
  });
  if (!headerRow || !col.date || !col.type) throw new Error('Не знайдено рядок заголовка з колонками «Дата» і «Стаття».');

  const out: CashImportRow[] = [];
  const skipped: ImportReport['skipped'] = [];
  let prevDate: string | null = null;
  let total = 0;
  ws.eachRow((row, i) => {
    if (i <= headerRow) return;
    const g = (k?: number) => (k ? plain(row.getCell(k).value) : null);
    const type = str(g(col.type));
    const usd = num(g(col.usd));
    const uah = num(g(col.uah));
    const cash = num(g(col.cash));
    const tov = num(g(col.tov));
    const fop = num(g(col.fop));
    const d = parseDate(g(col.date)) ?? prevDate;
    if (parseDate(g(col.date))) prevDate = parseDate(g(col.date));
    if (!type && !uah && !cash && !tov && !fop && !usd) return; // порожній / службовий рядок
    total++;
    if (!d) return void skipped.push({ row: i, reason: 'немає дати' });
    if (!(ART_TYPES as readonly string[]).includes(type)) return void skipped.push({ row: i, reason: `невідома стаття «${type}»` });
    if (usd) return void skipped.push({ row: i, reason: 'сума в USD — валютної каси ще немає' });
    const base = { date: d, type, cat: str(g(col.cat)), obj: str(g(col.obj)), counterparty: str(g(col.cp)), note: str(g(col.note)) };
    if (uah) out.push({ ...base, account: 'Карта', sum: Math.round(uah * 100) / 100 });
    if (cash) out.push({ ...base, account: 'Готівка', sum: Math.round(cash * 100) / 100 });
    if (tov) out.push({ ...base, account: 'ТОВ', sum: Math.round(tov * 100) / 100 });
    if (fop) out.push({ ...base, account: 'ФОП', sum: Math.round(fop * 100) / 100 });
    if (!uah && !cash && !tov && !fop) skipped.push({ row: i, reason: 'немає суми' });
  });
  return { rows: out, skipped, total };
}

/** Записує операції; дублікати (дата + примітка + сума + каса) пропускає. Нові підстатті додає в статейник. */
export async function importCash(c: pg.PoolClient, rows: CashImportRow[], userId: number) {
  let added = 0;
  let duplicates = 0;
  let articlesAdded = 0;
  // Однакові операції в одному файлі (напр., три оплати реклами по 225 грн в один день) — справжні.
  // Тому порівнюємо кількість: у файлі N однакових, у базі вже M → додаємо N − M.
  const groups = new Map<string, CashImportRow[]>();
  for (const r of rows) {
    const k = JSON.stringify([r.date, r.note, r.sum, r.account]);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const list of groups.values()) {
    const r = list[0]!;
    const ex = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM cash_ops WHERE date = $1 AND note = $2 AND sum = $3 AND account = $4`,
      [r.date, r.note, r.sum, r.account],
    );
    const have = ex.rows[0]!.n;
    duplicates += Math.min(have, list.length);
    for (const x of list.slice(have)) {
      await c.query(
        `INSERT INTO cash_ops (date, type, cat, obj, counterparty, note, account, sum, source, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'import',$9)`,
        [x.date, x.type, x.cat, x.obj, x.counterparty, x.note, x.account, x.sum, userId],
      );
      added++;
    }
  }
  // Підстатті, яких немає в статейнику, — додати з рядком P&L «Інші» / «Дохід» (власник уточнить у статейнику)
  const pairs = [...new Map(rows.map((r) => [`${r.type}|${r.cat}`, r])).values()];
  for (const r of pairs) {
    const ex = await c.query('SELECT 1 FROM articles WHERE type = $1 AND cat = $2 AND NOT hidden LIMIT 1', [r.type, r.cat]);
    const typeOnly = await c.query(`SELECT 1 FROM articles WHERE type = $1 AND cat = '' AND NOT hidden LIMIT 1`, [r.type]);
    if (ex.rowCount || typeOnly.rowCount) continue;
    const line = r.type === 'Дохід' ? 'income' : r.type === 'Витрата' ? 'other' : 'none';
    await c.query(`INSERT INTO articles (type, cat, obj, line) VALUES ($1, $2, '', $3) ON CONFLICT DO NOTHING`, [r.type, r.cat, line]);
    articlesAdded++;
  }
  return { added, duplicates, articlesAdded };
}

/** Назва рядка у файлі → рядок P&L системи. */
type PlanLine = PnlLine | typeof FUTURE_CLOSED;
const LINE_BY_NAME: Record<string, PlanLine> = (() => {
  const m: Record<string, PlanLine> = { [norm(FUTURE_CLOSED_LABEL)]: FUTURE_CLOSED };
  for (const [k, l] of PNL_LINES) m[norm(l)] = k;
  Object.assign(m, {
    [norm('Витрати')]: 'orderCost',
    [norm('Інвестиції -')]: 'invMinus',
    [norm('Інвестиції +')]: 'invPlus',
    [norm('Податки та збори')]: 'tax',
  });
  return m;
})();

/** Колонка «До» (до початку обліку) у pnl_fact. */
export const BEFORE_MONTH = '0000-00';

export interface PnlSheet {
  /** План: як введено */
  cells: { month: string; line: PlanLine; amount: number }[];
  /** Факт зі знаком — лише для місяців, де у файлі заповнено факт доходу */
  facts: { month: string; line: PnlLine; amount: number }[];
  factMonths: string[];
  /** Місяці між фактичними, для яких у файлі немає колонки: їх суми входять у сусідні колонки */
  mergedMonths: string[];
  before: { line: PnlLine; kind: 'plan' | 'fact'; amount: number }[];
  notes: { month: string; line: PnlLine; text: string }[];
  months: string[];
}

/**
 * Файл P&L: рядок з назвою — план, рядок під ним без назви — факт. Місяці — у заголовку (ММ.РРРР), «До» — до початку обліку.
 * «Витрати» і «Майбутні витрати закриті» у файлі без мінуса; факт витрат на замовлення в системі = обидва разом.
 * Рядки інвестиційної діяльності мають один рядок: у місяцях з фактом він є і фактом.
 */
export function parsePnlSheet(ws: ExcelJS.Worksheet): PnlSheet {
  // Рядок з місяцями — той, де найбільше клітинок виду ММ.РРРР / дата
  let best = { row: 0, months: new Map<number, string>(), before: 0 };
  ws.eachRow((row, i) => {
    const months = new Map<number, string>();
    let before = 0;
    (row.values as Cell[]).forEach((v, k) => {
      const p = plain(v);
      let m: string | null = null;
      if (p instanceof Date) m = isoDate(p).slice(0, 7);
      else if (typeof p === 'string' && /^\d{2}\.\d{4}$/.test(p.trim())) m = `${p.trim().slice(3)}-${p.trim().slice(0, 2)}`;
      else if (norm(str(p)) === 'до') before = k;
      if (m) months.set(k, m);
    });
    if (months.size > best.months.size) best = { row: i, months, before };
  });
  if (best.months.size < 1) throw new Error('Не знайдено рядок з місяцями (ММ.РРРР).');

  // Рядки P&L: значення плану і (якщо під ним рядок без назви) факту
  type Cells = Map<number, unknown>;
  const read = (n: number): Cells => new Map([...best.months.keys(), ...(best.before ? [best.before] : [])].map((k) => [k, plain(ws.getRow(n).getCell(k).value)]));
  const lines: { line: PlanLine; plan: Cells; fact: Cells | null }[] = [];
  for (let i = best.row + 1; i <= ws.rowCount; i++) {
    const line = LINE_BY_NAME[norm(str(plain(ws.getRow(i).getCell(1).value)))];
    if (!line || line === 'none') continue;
    const noName = i < ws.rowCount && !str(plain(ws.getRow(i + 1).getCell(1).value));
    lines.push({ line, plan: read(i), fact: noName && line !== FUTURE_CLOSED ? read(i + 1) : null });
  }
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const val = (c: Cells | null, k: number) => {
    const v = c ? num(c.get(k)) : null;
    return v != null && v !== 0 ? r2(v) : null;
  };

  const income = lines.find((l) => l.line === 'income');
  const isFact = (k: number) => val(income?.fact ?? null, k) != null;
  const closed = lines.find((l) => l.line === FUTURE_CLOSED);
  const invest: readonly string[] = INVEST_LINES;
  const out: PnlSheet = { cells: [], facts: [], factMonths: [], mergedMonths: [], before: [], notes: [], months: [...best.months.values()] };
  for (const [k, month] of best.months) if (isFact(k)) out.factMonths.push(month);
  out.factMonths.sort();
  for (const l of lines) {
    for (const [k, month] of best.months) {
      const p = val(l.plan, k);
      const f = val(l.fact, k);
      if (p != null) out.cells.push({ month, line: l.line, amount: p });
      // сума під рядком у майбутньому місяці — теж план (напр. «Купівля буса»)
      else if (f != null && !isFact(k)) out.cells.push({ month, line: l.line, amount: f });
      if (l.line === FUTURE_CLOSED) continue;
      const raw = l.plan.get(k);
      if (typeof raw === 'string' && raw.trim() && num(raw) == null) out.notes.push({ month, line: l.line, text: raw.trim().slice(0, 300) });
      if (!isFact(k)) continue;
      let sum = f ?? (invest.includes(l.line) ? p : null);
      if (sum != null) sum = planSigned(l.line, sum);
      if (l.line === 'orderCost') {
        const c = val(closed?.plan ?? null, k);
        if (c != null) sum = (sum ?? 0) - Math.abs(c);
      }
      if (sum != null) out.facts.push({ month, line: l.line, amount: r2(sum) });
    }
    if (best.before && l.line !== FUTURE_CLOSED) {
      const p = val(l.plan, best.before);
      const f = val(l.fact, best.before);
      if (p != null) out.before.push({ line: l.line, kind: 'plan', amount: p });
      if (f != null) out.before.push({ line: l.line, kind: 'fact', amount: f });
    }
  }
  if (out.factMonths.length) {
    const [y, m] = out.factMonths[0]!.split('-').map(Number) as [number, number];
    for (let n = 1; ; n++) {
      const mm = new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
      if (mm >= out.factMonths.at(-1)!) break;
      if (!out.months.includes(mm)) out.mergedMonths.push(mm);
    }
  }
  return out;
}

/** Записує план, факт, «До» і примітки з файлу. Місяці з фактом у файлі далі показують факт із файлу, а не з обліку. */
export async function importPnl(c: pg.PoolClient, p: PnlSheet, userId: number): Promise<void> {
  for (const x of p.cells) {
    // план витрат і доходів — без знака (знак визначає рядок), «Кредити» / «Позика» — зі знаком
    const amount = x.line !== FUTURE_CLOSED && LINE_KIND[x.line] === 'mix' ? x.amount : Math.abs(x.amount);
    await c.query(
      `INSERT INTO pnl_plan (month, line, amount, updated_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (month, line) DO UPDATE SET amount = EXCLUDED.amount, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [x.month, x.line, amount, userId],
    );
  }
  for (const [list, note] of [
    [p.factMonths, ''],
    [p.mergedMonths, 'У файлі немає окремої колонки: суми цього місяця — у сусідніх.'],
  ] as const) {
    for (const m of list) {
      await c.query('DELETE FROM pnl_fact WHERE month = $1', [m]);
      await c.query(`INSERT INTO pnl_fixed (month, note, created_by) VALUES ($1, $2, $3) ON CONFLICT (month) DO UPDATE SET note = EXCLUDED.note`, [m, note, userId]);
    }
  }
  for (const x of p.facts) await c.query('INSERT INTO pnl_fact (month, line, amount) VALUES ($1, $2, $3)', [x.month, x.line, x.amount]);
  if (p.before.length) await c.query('DELETE FROM pnl_fact WHERE month = $1', [BEFORE_MONTH]);
  for (const x of p.before) await c.query('INSERT INTO pnl_fact (month, line, kind, amount) VALUES ($1, $2, $3, $4)', [BEFORE_MONTH, x.line, x.kind, x.amount]);
  for (const x of p.notes) {
    await c.query('INSERT INTO pnl_notes (month, line, text) VALUES ($1, $2, $3) ON CONFLICT (month, line) DO UPDATE SET text = EXCLUDED.text', [x.month, x.line, x.text]);
  }
  await writeLog(c, {
    userId,
    folder: 'fin',
    finScope: 'report',
    text: `P&L: імпорт з файлу — план ${p.cells.length} значень${p.factMonths.length ? `, факт за ${[...p.factMonths, ...p.mergedMonths].sort().join(', ')}` : ''}`,
  });
}

export async function loadWorkbook(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

/**
 * Імпорт наявного обліку і плану P&L з Excel (ТЗ 10.1, 10.2).
 *
 * Облік: колонки Дата | Стаття | Підстаття | Обєкт | Контрагент | Примітка | USD | UAH | UAH(готівка).
 *  - рядки без дати беруть дату попереднього; дата текстом («Старт 15.07.2026») — розпізнається;
 *  - сума UAH → каса «Карта», UAH(готівка) → «Готівка» (обидві в рядку — дві операції);
 *  - повторний імпорт не дублює записів (ключ: дата + примітка + сума + каса; однакові операції
 *    в самому файлі — справжні, тому додається лише різниця між кількістю у файлі і в базі).
 * План P&L: перший стовпець — назва рядка P&L, у заголовку — місяці (ММ.РРРР або дата).
 */
import ExcelJS from 'exceljs';
import type pg from 'pg';
import { ART_TYPES, PNL_LINES, type PnlLine } from '@vudo/shared';

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
  card: number;
  cash: number;
}

interface CashImportRow {
  date: string;
  type: string;
  cat: string;
  obj: string;
  counterparty: string;
  note: string;
  account: 'Карта' | 'Готівка';
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
    const d = parseDate(g(col.date)) ?? prevDate;
    if (parseDate(g(col.date))) prevDate = parseDate(g(col.date));
    if (!type && !uah && !cash && !usd) return; // порожній / службовий рядок
    total++;
    if (!d) return void skipped.push({ row: i, reason: 'немає дати' });
    if (!(ART_TYPES as readonly string[]).includes(type)) return void skipped.push({ row: i, reason: `невідома стаття «${type}»` });
    if (usd) return void skipped.push({ row: i, reason: 'сума в USD — валютної каси ще немає' });
    const base = { date: d, type, cat: str(g(col.cat)), obj: str(g(col.obj)), counterparty: str(g(col.cp)), note: str(g(col.note)) };
    if (uah) out.push({ ...base, account: 'Карта', sum: Math.round(uah * 100) / 100 });
    if (cash) out.push({ ...base, account: 'Готівка', sum: Math.round(cash * 100) / 100 });
    if (!uah && !cash) skipped.push({ row: i, reason: 'немає суми' });
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
const LINE_BY_NAME: Record<string, PnlLine> = (() => {
  const m: Record<string, PnlLine> = {};
  for (const [k, l] of PNL_LINES) m[norm(l)] = k;
  Object.assign(m, {
    [norm('Витрати')]: 'orderCost',
    [norm('Інвестиції -')]: 'invMinus',
    [norm('Інвестиції +')]: 'invPlus',
    [norm('Податки та збори')]: 'tax',
  });
  return m;
})();

export function parsePnlSheet(ws: ExcelJS.Worksheet): { cells: { month: string; line: PnlLine; amount: number }[]; months: string[] } {
  // Рядок з місяцями — той, де найбільше клітинок виду ММ.РРРР / дата
  let best = { row: 0, months: new Map<number, string>() };
  ws.eachRow((row, i) => {
    const months = new Map<number, string>();
    (row.values as Cell[]).forEach((v, k) => {
      const p = plain(v);
      let m: string | null = null;
      if (p instanceof Date) m = isoDate(p).slice(0, 7);
      else if (typeof p === 'string' && /^\d{2}\.\d{4}$/.test(p.trim())) m = `${p.trim().slice(3)}-${p.trim().slice(0, 2)}`;
      if (m) months.set(k, m);
    });
    if (months.size > best.months.size) best = { row: i, months };
  });
  if (best.months.size < 1) throw new Error('Не знайдено рядок з місяцями (ММ.РРРР).');
  const cells: { month: string; line: PnlLine; amount: number }[] = [];
  ws.eachRow((row, i) => {
    if (i <= best.row) return;
    const name = str(plain(row.getCell(1).value));
    const line = LINE_BY_NAME[norm(name)];
    if (!line || line === 'none') return;
    for (const [k, month] of best.months) {
      const v = num(plain(row.getCell(k).value));
      if (v != null && v !== 0) cells.push({ month, line, amount: Math.round(v * 100) / 100 });
    }
  });
  return { cells, months: [...best.months.values()] };
}

export async function loadWorkbook(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

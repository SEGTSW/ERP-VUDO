/**
 * Імпорт обліку і плану P&L з Excel із консолі (те саме, що кнопки в «Фінанси → Облік / P&L»):
 *   npm run import-finance -- --cash "Облік.xlsx" --pnl "PnL.xlsx"
 * Повторний запуск не дублює операцій обліку; план P&L перезаписує значення тих самих місяців.
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { LINE_KIND } from '@vudo/shared';
import { pool, tx } from '../db.js';
import { migrate } from '../migrate.js';
import { writeLog } from '../audit.js';
import { importCash, loadWorkbook, parseCashSheet, parsePnlSheet } from '../finance/import.js';

const { values } = parseArgs({ options: { cash: { type: 'string' }, pnl: { type: 'string' } } });
if (!values.cash && !values.pnl) {
  console.error('Вкажіть --cash <файл.xlsx> і/або --pnl <файл.xlsx>');
  process.exit(1);
}
await migrate(pool);
const owner = await pool.query<{ id: number }>(`SELECT id FROM users WHERE 'Адмін' = ANY(roles) AND NOT disabled ORDER BY id LIMIT 1`);
const userId = owner.rows[0]?.id;
if (!userId) throw new Error('Спершу створіть власника: npm run create-admin');

if (values.cash) {
  const wb = await loadWorkbook(await readFile(values.cash));
  const ws = wb.worksheets.find((w) => w.name.trim() === 'Облік') ?? wb.worksheets[0]!;
  const p = parseCashSheet(ws);
  const r = await tx(async (c) => {
    const x = await importCash(c, p.rows, userId);
    await writeLog(c, { userId, folder: 'fin', finScope: 'report', text: `Облік: імпорт з файлу — додано ${x.added}, уже були ${x.duplicates}, пропущено ${p.skipped.length}` });
    return x;
  });
  const sum = (a: string) => Math.round(p.rows.filter((x) => x.account === a).reduce((t, x) => t + x.sum, 0) * 100) / 100;
  console.log(`Облік: рядків ${p.total}, додано ${r.added}, уже були ${r.duplicates}, нових підстатей ${r.articlesAdded}; карта ${sum('Карта')}, готівка ${sum('Готівка')}`);
  for (const s of p.skipped) console.log(`  пропущено рядок ${s.row}: ${s.reason}`);
}

if (values.pnl) {
  const wb = await loadWorkbook(await readFile(values.pnl));
  const p = parsePnlSheet(wb.worksheets[0]!);
  await tx(async (c) => {
    for (const x of p.cells) {
      const amount = LINE_KIND[x.line] === 'mix' ? x.amount : Math.abs(x.amount);
      await c.query(
        `INSERT INTO pnl_plan (month, line, amount, updated_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (month, line) DO UPDATE SET amount = EXCLUDED.amount, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [x.month, x.line, amount, userId],
      );
    }
    await writeLog(c, { userId, folder: 'fin', finScope: 'report', text: `P&L план: імпорт з файлу — ${p.cells.length} значень` });
  });
  const ms = [...new Set(p.cells.map((x) => x.month))].sort();
  console.log(`План P&L: ${p.cells.length} значень, місяці ${ms[0]} – ${ms.at(-1)}`);
}
await pool.end();

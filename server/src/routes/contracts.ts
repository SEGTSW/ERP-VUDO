/** Реєстр договорів та інших документів за юрособами (лише власник): картка, файли, імпорт з Excel. */
import { Router, type Request, type Response } from 'express';
import ExcelJS from 'exceljs';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { CONTRACT_KINDS, CONTRACT_STATUSES, fmtDate } from '@vudo/shared';
import { config } from '../config.js';
import { pool, tx, type Db } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { me, requireOwner } from '../auth/middleware.js';
import { diffLine, writeLog } from '../audit.js';
import { parseDate, loadWorkbook } from '../finance/import.js';
import { receive, sendStored } from './files.js';

export const contractsRouter = Router();
contractsRouter.use('/contracts', requireOwner);

const idOf = (v: unknown) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw notFound();
  return n;
};
const log = (c: Db, userId: number, text: string) => writeLog(c, { userId, folder: 'fin', finScope: 'report', text });

contractsRouter.get('/contracts', async (_req, res) => {
  const entities = await pool.query('SELECT id, name FROM legal_entities ORDER BY pos, id');
  const rows = await pool.query<{ id: number }>(
    `SELECT id, entity_id AS "entityId", kind, counterparty, responsible, subject, amount_text AS "amountText", num, signed_on AS "signedOn",
            ends_text AS "endsText", status, original, origin, note, scan_url AS "scanUrl", archived
       FROM contracts ORDER BY archived, signed_on DESC NULLS LAST, id DESC`,
  );
  const files = await pool.query<{ contractId: number }>(
    `SELECT f.id, f.contract_id AS "contractId", f.name, f.size, f.created_at AS "createdAt", u.name AS "byName"
       FROM contract_files f LEFT JOIN users u ON u.id = f.created_by ORDER BY f.id`,
  );
  res.json({ entities: entities.rows, rows: rows.rows.map((r) => ({ ...r, files: files.rows.filter((f) => f.contractId === r.id) })) });
});

contractsRouter.patch('/contracts/entities/:id', async (req, res) => {
  const id = idOf(req.params.id);
  const { name } = z.object({ name: z.string().trim().min(1, 'Вкажіть назву.').max(200) }).parse(req.body);
  await tx(async (c) => {
    const r = await c.query<{ name: string }>('SELECT name FROM legal_entities WHERE id = $1 FOR UPDATE', [id]);
    if (!r.rows[0]) throw notFound('Юрособу не знайдено.');
    if (r.rows[0].name === name) return;
    await c.query('UPDATE legal_entities SET name = $2 WHERE id = $1', [id, name]);
    await log(c, me(req).id, `Договори: «${r.rows[0].name}» → «${name}»`);
  });
  res.json({ ok: true });
});

const t = (max: number) => z.string().trim().max(max).default('');
const schema = z.object({
  entityId: z.number().int().positive(),
  kind: z.enum(CONTRACT_KINDS).default('договір'),
  counterparty: z.string().trim().min(1, 'Вкажіть контрагента.').max(300),
  responsible: t(200),
  subject: t(1000),
  amountText: t(300),
  num: t(200),
  signedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().transform((v) => v || null),
  endsText: t(300),
  status: z.enum(CONTRACT_STATUSES).default(''),
  original: t(300),
  origin: t(300),
  note: t(4000),
  scanUrl: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => v || null)
    .refine((v) => !v || /^https?:\/\//.test(v), 'Посилання має починатися з https://'),
});
type Contract = z.infer<typeof schema>;

const values = (b: Contract) => [b.entityId, b.kind, b.counterparty, b.responsible, b.subject, b.amountText, b.num, b.signedOn, b.endsText, b.status, b.original, b.origin, b.note, b.scanUrl];
async function insert(c: Db, b: Contract, userId: number): Promise<number> {
  const r = await c.query<{ id: number }>(
    `INSERT INTO contracts (entity_id, kind, counterparty, responsible, subject, amount_text, num, signed_on, ends_text, status, original, origin, note, scan_url, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
    [...values(b), userId],
  );
  return r.rows[0]!.id;
}
async function checkEntity(c: Db, id: number): Promise<string> {
  const r = await c.query<{ name: string }>('SELECT name FROM legal_entities WHERE id = $1', [id]);
  if (!r.rows[0]) throw badRequest('Виберіть юрособу.', 'entityId');
  return r.rows[0].name;
}

contractsRouter.post('/contracts', async (req, res) => {
  const b = schema.parse(req.body);
  const u = me(req);
  const id = await tx(async (c) => {
    const ent = await checkEntity(c, b.entityId);
    const x = await insert(c, b, u.id);
    await log(c, u.id, `Договори · ${ent}: додано «${b.counterparty}»${b.num ? ` ${b.num}` : ''}`);
    return x;
  });
  res.status(201).json({ id });
});

contractsRouter.put('/contracts/:id', async (req, res) => {
  const id = idOf(req.params.id);
  const b = schema.parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    const r = await c.query('SELECT * FROM contracts WHERE id = $1 FOR UPDATE', [id]);
    const x = r.rows[0];
    if (!x) throw notFound('Договір не знайдено.');
    await checkEntity(c, b.entityId);
    await c.query(
      `UPDATE contracts SET entity_id=$2, kind=$3, counterparty=$4, responsible=$5, subject=$6, amount_text=$7, num=$8, signed_on=$9, ends_text=$10,
              status=$11, original=$12, origin=$13, note=$14, scan_url=$15 WHERE id = $1`,
      [id, ...values(b)],
    );
    const d = (v: string | null) => (v ? fmtDate(v) : null);
    const ch = [
      diffLine('контрагент', x.counterparty, b.counterparty),
      diffLine('предмет', x.subject, b.subject),
      diffLine('сума', x.amount_text, b.amountText),
      diffLine('номер', x.num, b.num),
      diffLine('підписано', d(x.signed_on), d(b.signedOn)),
      diffLine('завершення', x.ends_text, b.endsText),
      diffLine('статус', x.status, b.status),
      diffLine('оригінал', x.original, b.original),
      diffLine('примітки', x.note, b.note),
    ].filter(Boolean);
    if (ch.length) await log(c, u.id, `Договір «${b.counterparty}»: ${ch.join('; ')}`);
  });
  res.json({ ok: true });
});

contractsRouter.patch('/contracts/:id/archive', async (req, res) => {
  const id = idOf(req.params.id);
  const { archived } = z.object({ archived: z.boolean() }).parse(req.body);
  await tx(async (c) => {
    const r = await c.query<{ counterparty: string }>('UPDATE contracts SET archived = $2 WHERE id = $1 RETURNING counterparty', [id, archived]);
    if (!r.rows[0]) throw notFound('Договір не знайдено.');
    await log(c, me(req).id, `Договір «${r.rows[0].counterparty}»: ${archived ? 'в архіві' : 'повернуто з архіву'}`);
  });
  res.json({ ok: true });
});

contractsRouter.post('/contracts/:id/files', async (req, res) => {
  const id = idOf(req.params.id);
  const u = me(req);
  await receive(req, res);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  try {
    if (!files.length) throw badRequest('Виберіть файл.');
    await tx(async (c) => {
      const r = await c.query<{ counterparty: string }>('SELECT counterparty FROM contracts WHERE id = $1 FOR UPDATE', [id]);
      if (!r.rows[0]) throw notFound('Договір не знайдено.');
      for (const f of files) {
        await c.query('INSERT INTO contract_files (contract_id, name, size, mime, storage_key, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [
          id, f.originalname.slice(0, 255), f.size, f.mimetype, f.filename, u.id,
        ]);
        await log(c, u.id, `Договір «${r.rows[0].counterparty}»: додано файл «${f.originalname}»`);
      }
    });
  } catch (e) {
    await Promise.all(files.map((f) => unlink(f.path).catch(() => {})));
    throw e;
  }
  res.status(201).json({ ok: true });
});

contractsRouter.get('/contracts/files/:id', async (req, res) => {
  const r = await pool.query<{ name: string; mime: string | null; storage_key: string }>('SELECT name, mime, storage_key FROM contract_files WHERE id = $1', [idOf(req.params.id)]);
  if (!r.rows[0]) throw notFound('Файл не знайдено.');
  sendStored(res, r.rows[0]);
});

contractsRouter.delete('/contracts/files/:id', async (req, res) => {
  const id = idOf(req.params.id);
  const key = await tx(async (c) => {
    const r = await c.query<{ name: string; storage_key: string; counterparty: string }>(
      'SELECT f.name, f.storage_key, k.counterparty FROM contract_files f JOIN contracts k ON k.id = f.contract_id WHERE f.id = $1 FOR UPDATE OF f',
      [id],
    );
    const f = r.rows[0];
    if (!f) throw notFound('Файл не знайдено.');
    await c.query('DELETE FROM contract_files WHERE id = $1', [id]);
    await log(c, me(req).id, `Договір «${f.counterparty}»: видалено файл «${f.name}»`);
    return f.storage_key;
  });
  await unlink(path.join(config.uploadDir, key)).catch(() => {});
  res.json({ ok: true });
});

/* ---------- Імпорт з Excel ---------- */

const HEADERS: [RegExp, keyof Contract | 'scan'][] = [
  [/^контрагент/, 'counterparty'],
  [/^відповідальн/, 'responsible'],
  [/^предмет/, 'subject'],
  [/^сума/, 'amountText'],
  [/^номер/, 'num'],
  [/^дата підпис/, 'signedOn'],
  [/^дата завер/, 'endsText'],
  [/^діюч/, 'status'],
  [/^наявн/, 'original'],
  [/^поход/, 'origin'],
  [/^приміт/, 'note'],
  [/^відскан/, 'scan'],
];

export function parseContracts(ws: ExcelJS.Worksheet, entityId: number): Contract[] {
  const cell = (c: ExcelJS.Cell): string => {
    const v = c.value;
    if (v instanceof Date) return fmtDate(v.toISOString().slice(0, 10));
    return c.text.replace(/\s+/g, ' ').trim();
  };
  let header = 0;
  const col = new Map<string, number>();
  ws.eachRow((row, i) => {
    if (header) return;
    const found = new Map<string, number>();
    row.eachCell((c, k) => {
      const h = cell(c).toLowerCase();
      const m = HEADERS.find(([re]) => re.test(h));
      if (m) found.set(m[1], k);
    });
    if (found.has('counterparty') && found.has('subject')) {
      header = i;
      for (const [k, v] of found) col.set(k, v);
    }
  });
  if (!header) throw badRequest('Не знайдено рядок заголовка з колонками «Контрагент» і «Предмет договору».');
  const out: Contract[] = [];
  ws.eachRow((row, i) => {
    if (i <= header) return;
    const g = (k: string) => (col.has(k) ? cell(row.getCell(col.get(k)!)) : '');
    if (!g('counterparty')) return;
    const scan = col.has('scan') ? row.getCell(col.get('scan')!) : null;
    const status = g('status').toLowerCase();
    out.push(
      schema.parse({
        entityId,
        counterparty: g('counterparty'),
        responsible: g('responsible'),
        subject: g('subject'),
        amountText: g('amountText'),
        num: g('num'),
        signedOn: col.has('signedOn') ? parseDate(row.getCell(col.get('signedOn')!).value) : null,
        endsText: g('endsText'),
        status: status.startsWith('діюч') ? 'Діючий' : status.startsWith('заверш') ? 'Завершений' : '',
        original: g('original'),
        origin: g('origin'),
        note: g('note'),
        scanUrl: scan?.hyperlink && /^https?:/.test(scan.hyperlink) ? scan.hyperlink : null,
      }),
    );
  });
  return out;
}

/** Уже внесені (та сама юрособа, контрагент, номер, предмет) не дублюються. */
export async function importContracts(c: Db, rows: Contract[], userId: number) {
  let added = 0;
  for (const b of rows) {
    const ex = await c.query('SELECT 1 FROM contracts WHERE entity_id = $1 AND counterparty = $2 AND num = $3 AND subject = $4', [b.entityId, b.counterparty, b.num, b.subject]);
    if (ex.rowCount) continue;
    await insert(c, b, userId);
    added++;
  }
  return { added, duplicates: rows.length - added };
}

contractsRouter.post('/contracts/import/:entityId', async (req: Request, res: Response) => {
  const entityId = idOf(req.params.entityId);
  const u = me(req);
  await receive(req, res);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  try {
    const f = files[0];
    if (!f || !/\.xlsx$/i.test(f.originalname)) throw badRequest('Потрібен файл Excel (.xlsx).');
    const wb = await loadWorkbook(await readFile(f.path)).catch(() => {
      throw badRequest('Файл не читається як Excel (.xlsx).');
    });
    const rows = parseContracts(wb.worksheets[0]!, entityId);
    const r = await tx(async (c) => {
      const ent = await checkEntity(c, entityId);
      const x = await importContracts(c, rows, u.id);
      await log(c, u.id, `Договори · ${ent}: імпорт з файлу — додано ${x.added}, уже були ${x.duplicates}`);
      return x;
    });
    res.json(r);
  } finally {
    await Promise.all(files.map((f) => unlink(f.path).catch(() => {})));
  }
});

/** Документи → «Первинні документи» (лише власник): реєстр рахунків, накладних, актів по ТОВ і ФОП, з файлами. */
import { Router } from 'express';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { CONTRACT_STORAGE, PRIMARY_DIRECTIONS, PRIMARY_KINDS, PRIMARY_PAY, fmtDate, moneyKop } from '@vudo/shared';
import { config } from '../config.js';
import { pool, tx, type Db } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { me, requireOwner } from '../auth/middleware.js';
import { diffLine, writeLog } from '../audit.js';
import { receive, sendStored } from './files.js';

export const primaryRouter = Router();
primaryRouter.use('/primary-docs', requireOwner);

const idOf = (v: unknown) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw notFound();
  return n;
};
const log = (c: Db, userId: number, text: string) => writeLog(c, { userId, folder: 'fin', finScope: 'report', text });
/** «Рахунок №15 від 03.11.2026 · Віяр» — для журналу. */
const title = (d: { kind: string; num: string; docDate?: string | null; doc_date?: string | null; counterparty: string }) => {
  const date = d.docDate ?? d.doc_date ?? null;
  return `${d.kind}${d.num ? ` №${d.num.replace(/^№\s*/, '')}` : ''}${date ? ` від ${fmtDate(date)}` : ''} · ${d.counterparty}`;
};

primaryRouter.get('/primary-docs', async (_req, res) => {
  const entities = await pool.query('SELECT id, name FROM legal_entities WHERE primary_docs ORDER BY pos, id');
  const rows = await pool.query<{ id: number }>(
    `SELECT id, entity_id AS "entityId", kind, direction, num, doc_date AS "docDate", counterparty, subject, amount, pay_status AS "payStatus",
            storage, location, note, archived
       FROM primary_docs ORDER BY archived, doc_date DESC NULLS LAST, id DESC`,
  );
  const files = await pool.query<{ docId: number }>(
    `SELECT f.id, f.doc_id AS "docId", f.name, f.size, f.created_at AS "createdAt", u.name AS "byName"
       FROM primary_doc_files f LEFT JOIN users u ON u.id = f.created_by ORDER BY f.id`,
  );
  res.json({
    entities: entities.rows,
    rows: rows.rows.map((r) => ({ ...r, files: files.rows.filter((f) => f.docId === r.id) })),
  });
});

const t = (max: number) => z.string().trim().max(max).default('');
const schema = z.object({
  entityId: z.number().int().positive(),
  kind: z.enum(PRIMARY_KINDS).default('Рахунок'),
  direction: z.enum(PRIMARY_DIRECTIONS).default('Вхідний'),
  num: t(200),
  docDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().transform((v) => v || null),
  counterparty: z.string().trim().min(1, 'Вкажіть контрагента.').max(300),
  subject: t(1000),
  amount: z.number().min(0, 'Сума без мінуса.').max(1_000_000_000).nullish().transform((v) => (v == null ? null : Math.round(v * 100) / 100)),
  payStatus: z.enum(PRIMARY_PAY).default(''),
  storage: z.enum(CONTRACT_STORAGE).default(''),
  location: t(300),
  note: t(4000),
});
type Doc = z.infer<typeof schema>;
const values = (b: Doc) => [b.entityId, b.kind, b.direction, b.num, b.docDate, b.counterparty, b.subject, b.amount, b.payStatus, b.storage, b.location, b.note];

async function checkEntity(c: Db, id: number): Promise<string> {
  const r = await c.query<{ name: string }>('SELECT name FROM legal_entities WHERE id = $1 AND primary_docs', [id]);
  if (!r.rows[0]) throw badRequest('Виберіть ТОВ або ФОП.', 'entityId');
  return r.rows[0].name;
}

primaryRouter.post('/primary-docs', async (req, res) => {
  const b = schema.parse(req.body);
  const u = me(req);
  const id = await tx(async (c) => {
    const ent = await checkEntity(c, b.entityId);
    const r = await c.query<{ id: number }>(
      `INSERT INTO primary_docs (entity_id, kind, direction, num, doc_date, counterparty, subject, amount, pay_status, storage, location, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [...values(b), u.id],
    );
    await log(c, u.id, `Первинні документи · ${ent}: додано ${title(b)}${b.amount != null ? `, ${moneyKop(b.amount)}` : ''}`);
    return r.rows[0]!.id;
  });
  res.status(201).json({ id });
});

primaryRouter.put('/primary-docs/:id', async (req, res) => {
  const id = idOf(req.params.id);
  const b = schema.parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    const r = await c.query('SELECT * FROM primary_docs WHERE id = $1 FOR UPDATE', [id]);
    const x = r.rows[0];
    if (!x) throw notFound('Документ не знайдено.');
    await checkEntity(c, b.entityId);
    await c.query(
      `UPDATE primary_docs SET entity_id=$2, kind=$3, direction=$4, num=$5, doc_date=$6, counterparty=$7, subject=$8, amount=$9, pay_status=$10,
              storage=$11, location=$12, note=$13 WHERE id = $1`,
      [id, ...values(b)],
    );
    const d = (v: string | null) => (v ? fmtDate(v) : null);
    const m = (v: number | null) => (v == null ? null : moneyKop(v));
    const ch = [
      diffLine('вид', x.kind, b.kind),
      diffLine('вхідний / вихідний', x.direction, b.direction),
      diffLine('номер', x.num, b.num),
      diffLine('дата', d(x.doc_date), d(b.docDate)),
      diffLine('контрагент', x.counterparty, b.counterparty),
      diffLine('зміст', x.subject, b.subject),
      diffLine('сума', m(x.amount == null ? null : Number(x.amount)), m(b.amount)),
      diffLine('оплата', x.pay_status, b.payStatus),
      diffLine('зберігання', x.storage, b.storage),
      diffLine('де зберігається', x.location, b.location),
      diffLine('примітки', x.note, b.note),
    ].filter(Boolean);
    if (ch.length) await log(c, u.id, `${title(b)}: ${ch.join('; ')}`);
  });
  res.json({ ok: true });
});

primaryRouter.patch('/primary-docs/:id/archive', async (req, res) => {
  const id = idOf(req.params.id);
  const { archived } = z.object({ archived: z.boolean() }).parse(req.body);
  await tx(async (c) => {
    const r = await c.query('UPDATE primary_docs SET archived = $2 WHERE id = $1 RETURNING kind, num, doc_date, counterparty', [id, archived]);
    if (!r.rows[0]) throw notFound('Документ не знайдено.');
    await log(c, me(req).id, `${title(r.rows[0])}: ${archived ? 'в архіві' : 'повернуто з архіву'}`);
  });
  res.json({ ok: true });
});

primaryRouter.post('/primary-docs/:id/files', async (req, res) => {
  const id = idOf(req.params.id);
  const u = me(req);
  await receive(req, res);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  try {
    if (!files.length) throw badRequest('Виберіть файл.');
    await tx(async (c) => {
      const r = await c.query('SELECT kind, num, doc_date, counterparty FROM primary_docs WHERE id = $1 FOR UPDATE', [id]);
      if (!r.rows[0]) throw notFound('Документ не знайдено.');
      for (const f of files) {
        await c.query('INSERT INTO primary_doc_files (doc_id, name, size, mime, storage_key, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [
          id, f.originalname.slice(0, 255), f.size, f.mimetype, f.filename, u.id,
        ]);
        await log(c, u.id, `${title(r.rows[0])}: додано файл «${f.originalname}»`);
      }
    });
  } catch (e) {
    await Promise.all(files.map((f) => unlink(f.path).catch(() => {})));
    throw e;
  }
  res.status(201).json({ ok: true });
});

primaryRouter.get('/primary-docs/files/:id', async (req, res) => {
  const r = await pool.query<{ name: string; mime: string | null; storage_key: string }>('SELECT name, mime, storage_key FROM primary_doc_files WHERE id = $1', [idOf(req.params.id)]);
  if (!r.rows[0]) throw notFound('Файл не знайдено.');
  sendStored(res, r.rows[0]);
});

primaryRouter.delete('/primary-docs/files/:id', async (req, res) => {
  const id = idOf(req.params.id);
  const key = await tx(async (c) => {
    const r = await c.query(
      `SELECT f.name, f.storage_key, d.kind, d.num, d.doc_date, d.counterparty
         FROM primary_doc_files f JOIN primary_docs d ON d.id = f.doc_id WHERE f.id = $1 FOR UPDATE OF f`,
      [id],
    );
    const f = r.rows[0];
    if (!f) throw notFound('Файл не знайдено.');
    await c.query('DELETE FROM primary_doc_files WHERE id = $1', [id]);
    await log(c, me(req).id, `${title(f)}: видалено файл «${f.name}»`);
    return f.storage_key as string;
  });
  await unlink(path.join(config.uploadDir, key)).catch(() => {});
  res.json({ ok: true });
});

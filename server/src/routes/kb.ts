/**
 * 12Б База знань — у всіх ролей. Створюють, редагують, видаляють — менеджер і власник; інші лише читають.
 * «Лише офіс» — матеріали, які сервер віддає тільки менеджерам і власнику.
 */
import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { FILE_EXTENSIONS, MAX_FILE_MB, isOffice } from '@vudo/shared';
import { config } from '../config.js';
import { pool, tx } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { me, requireOffice } from '../auth/middleware.js';
import { writeLog } from '../audit.js';
import type { User } from '../users.js';

export const kbRouter = Router();
export const KB_CATS = ['Компанія', 'Клієнт', 'Регламенти', 'Шаблони і документи', 'Навчання'] as const;
const KB_EXT = [...FILE_EXTENSIONS, 'ppt', 'pptx', 'key', 'txt', 'odt', 'ods', 'odp'];

const visSql = (u: User) => (isOffice(u) ? 'TRUE' : `a.vis = 'all'`);

/** Хто має бачити матеріал (для «Ознайомились N з M»): активні; «лише офіс» — менеджери й власник. */
const AUD_SQL = `SELECT id, name FROM users WHERE NOT disabled AND ($1 = 'all' OR roles && ARRAY['Адмін','Менеджер']) ORDER BY name`;

kbRouter.get('/kb', async (req, res) => {
  const u = me(req);
  const r = await pool.query(
    `SELECT a.id, a.title, a.cat, a.body, a.vis, a.pinned, a.draft, a.updated_at AS "updatedAt", uu.name AS "byName",
            (SELECT count(*)::int FROM kb_files f WHERE f.article_id = a.id) AS files,
            (SELECT read_at FROM kb_reads r WHERE r.article_id = a.id AND r.user_id = $1) AS "readAt",
            (SELECT count(*)::int FROM kb_reads r JOIN users x ON x.id = r.user_id AND NOT x.disabled WHERE r.article_id = a.id) AS reads
       FROM kb_articles a LEFT JOIN users uu ON uu.id = coalesce(a.updated_by, a.created_by)
      WHERE ${visSql(u)} ORDER BY a.title`,
    [u.id],
  );
  const aud = await pool.query<{ all: number; office: number }>(
    `SELECT count(*)::int AS all, count(*) FILTER (WHERE roles && ARRAY['Адмін','Менеджер'])::int AS office FROM users WHERE NOT disabled`,
  );
  const office = isOffice(u);
  res.json(
    r.rows.map((a) => ({
      ...a,
      // Скільки ознайомилось — лише менеджеру й власнику
      reads: office ? a.reads : undefined,
      audience: office ? (a.vis === 'office' ? aud.rows[0]!.office : aud.rows[0]!.all) : undefined,
    })),
  );
});

/** Лічильник непрочитаних (крапка й цифра біля «База знань»); чернетки ознайомлення не потребують. */
kbRouter.get('/kb-unread', async (req, res) => {
  const u = me(req);
  const r = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM kb_articles a WHERE ${visSql(u)} AND NOT a.draft
       AND NOT EXISTS (SELECT 1 FROM kb_reads r WHERE r.article_id = a.id AND r.user_id = $1)`,
    [u.id],
  );
  res.json({ total: r.rows[0]!.n });
});

async function visibleArticle(u: User, id: number) {
  const r = await pool.query<{ id: number; title: string; vis: string; draft: boolean }>(
    `SELECT a.id, a.title, a.vis, a.draft FROM kb_articles a WHERE a.id = $1 AND ${visSql(u)}`,
    [id],
  );
  if (!r.rows[0]) throw notFound('Матеріал не знайдено.');
  return r.rows[0];
}

kbRouter.get('/kb/:id', async (req, res) => {
  const u = me(req);
  const id = Number(req.params.id);
  await visibleArticle(u, id);
  const a = await pool.query(
    `SELECT a.id, a.title, a.cat, a.body, a.vis, a.pinned, a.draft, a.updated_at AS "updatedAt", uu.name AS "byName",
            (SELECT read_at FROM kb_reads r WHERE r.article_id = a.id AND r.user_id = $2) AS "readAt"
       FROM kb_articles a LEFT JOIN users uu ON uu.id = coalesce(a.updated_by, a.created_by) WHERE a.id = $1`,
    [id, u.id],
  );
  const files = await pool.query(
    `SELECT f.id, f.name, f.size, f.created_at AS "createdAt", uu.name AS "byName" FROM kb_files f LEFT JOIN users uu ON uu.id = f.created_by
      WHERE f.article_id = $1 ORDER BY f.id`,
    [id],
  );
  let readers = null;
  if (isOffice(u)) {
    const aud = await pool.query<{ id: number; name: string }>(AUD_SQL, [a.rows[0].vis]);
    const reads = await pool.query<{ userId: number; readAt: string }>(`SELECT user_id AS "userId", read_at AS "readAt" FROM kb_reads WHERE article_id = $1`, [id]);
    readers = aud.rows.map((x) => ({ ...x, readAt: reads.rows.find((r) => r.userId === x.id)?.readAt ?? null }));
  }
  res.json({ ...a.rows[0], files: files.rows, readers });
});

const artSchema = z.object({
  title: z.string().trim().min(1, 'Вкажіть назву.').max(200),
  cat: z.enum(KB_CATS),
  body: z.string().max(200_000),
  vis: z.enum(['all', 'office']),
  pinned: z.boolean(),
  draft: z.boolean(),
  /** Суттєві зміни — попросити всіх ознайомитись знову (позначки скидаються) */
  rereq: z.boolean().optional(),
});

kbRouter.post('/kb', requireOffice, async (req, res) => {
  const b = artSchema.parse(req.body);
  const u = me(req);
  const id = await tx(async (c) => {
    const r = await c.query<{ id: number }>(
      `INSERT INTO kb_articles (title, cat, body, vis, pinned, draft, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
      [b.title, b.cat, b.body, b.vis, b.pinned, b.draft, u.id],
    );
    await writeLog(c, { userId: u.id, folder: 'other', text: `База знань: додано «${b.title}»` });
    return r.rows[0]!.id;
  });
  res.status(201).json({ id });
});

kbRouter.patch('/kb/:id', requireOffice, async (req, res) => {
  const id = Number(req.params.id);
  const b = artSchema.parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    const r = await c.query('UPDATE kb_articles SET title=$2, cat=$3, body=$4, vis=$5, pinned=$6, draft=$7, updated_at=now(), updated_by=$8 WHERE id = $1', [
      id, b.title, b.cat, b.body, b.vis, b.pinned, b.draft, u.id,
    ]);
    if (!r.rowCount) throw notFound('Матеріал не знайдено.');
    if (b.rereq) await c.query('DELETE FROM kb_reads WHERE article_id = $1', [id]);
    await writeLog(c, { userId: u.id, folder: 'other', text: `База знань: оновлено «${b.title}»${b.rereq ? ' — попрошено ознайомитись знову' : ''}` });
  });
  res.json({ ok: true });
});

kbRouter.delete('/kb/:id', requireOffice, async (req, res) => {
  const id = Number(req.params.id);
  const u = me(req);
  const keys = await tx(async (c) => {
    const a = await c.query<{ title: string }>('SELECT title FROM kb_articles WHERE id = $1 FOR UPDATE', [id]);
    if (!a.rows[0]) throw notFound('Матеріал не знайдено.');
    const f = await c.query<{ storage_key: string }>('SELECT storage_key FROM kb_files WHERE article_id = $1', [id]);
    await c.query('DELETE FROM kb_articles WHERE id = $1', [id]);
    await writeLog(c, { userId: u.id, folder: 'other', text: `База знань: видалено «${a.rows[0].title}»` });
    return f.rows.map((x) => x.storage_key);
  });
  await Promise.all(keys.map((k) => unlink(path.join(config.uploadDir, k)).catch(() => {})));
  res.json({ ok: true });
});

/** «Ознайомився ✓» — фіксує дату й час. */
kbRouter.post('/kb/:id/read', async (req, res) => {
  const u = me(req);
  const id = Number(req.params.id);
  const a = await visibleArticle(u, id);
  if (a.draft) throw badRequest('Чернетка не потребує ознайомлення.');
  await pool.query(`INSERT INTO kb_reads (article_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, u.id]);
  res.json({ ok: true });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, f, cb) => cb(null, `kb-${randomUUID()}${path.extname(f.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 10 },
  defParamCharset: 'utf8',
  fileFilter: (_req, f, cb) =>
    KB_EXT.includes(path.extname(f.originalname).slice(1).toLowerCase()) ? cb(null, true) : cb(badRequest(`Тип файлу не підтримується: ${f.originalname}`)),
}).array('files', 10);

kbRouter.post('/kb/:id/files', requireOffice, async (req, res) => {
  const id = Number(req.params.id);
  const u = me(req);
  await new Promise<void>((ok, bad) =>
    upload(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return bad(badRequest(`Файл більше ${MAX_FILE_MB} МБ, не додано.`));
      if (err) return bad(err);
      ok();
    }),
  );
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  try {
    if (!files.length) throw badRequest('Виберіть файл.');
    await tx(async (c) => {
      const a = await c.query<{ title: string }>('SELECT title FROM kb_articles WHERE id = $1', [id]);
      if (!a.rows[0]) throw notFound('Матеріал не знайдено.');
      for (const f of files) {
        await c.query(`INSERT INTO kb_files (article_id, name, size, mime, storage_key, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [
          id, f.originalname.slice(0, 255), f.size, f.mimetype, f.filename, u.id,
        ]);
      }
      await writeLog(c, { userId: u.id, folder: 'other', text: `База знань: до «${a.rows[0].title}» додано файлів: ${files.length}` });
    });
  } catch (e) {
    await Promise.all(files.map((f) => unlink(f.path).catch(() => {})));
    throw e;
  }
  res.status(201).json({ ok: true });
});

kbRouter.get('/kb-files/:id', async (req, res) => {
  const u = me(req);
  const r = await pool.query<{ name: string; mime: string | null; storage_key: string; article_id: number }>(
    'SELECT name, mime, storage_key, article_id FROM kb_files WHERE id = $1',
    [Number(req.params.id)],
  );
  const f = r.rows[0];
  if (!f) throw notFound('Файл не знайдено.');
  await visibleArticle(u, f.article_id).catch(() => {
    throw forbidden();
  });
  const inline = f.mime === 'application/pdf' || (!!f.mime && f.mime.startsWith('image/') && f.mime !== 'image/svg+xml');
  res.set('Cache-Control', 'private, max-age=3600');
  res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.attachment(f.name);
  if (inline) res.set('Content-Disposition', res.get('Content-Disposition')!.replace(/^attachment/, 'inline'));
  res.type(inline ? f.mime! : 'application/octet-stream');
  res.sendFile(path.join(config.uploadDir, f.storage_key), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Файл відсутній у сховищі.' });
  });
});

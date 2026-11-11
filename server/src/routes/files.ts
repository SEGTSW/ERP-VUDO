/**
 * Файли замовлення (ТЗ розділи 1, 6.4): до 50 МБ на файл, кілька за раз, дозволені типи.
 * Права на «Прорахунки / специфікації» (spec) перевіряє сервер — і при додаванні, і при завантаженні.
 */
import { Router, type Request } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { FILE_EXTENSIONS, MAX_FILE_MB, isOffice } from '@vudo/shared';
import { config } from '../config.js';
import { pool, tx } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { me } from '../auth/middleware.js';
import { writeLog } from '../audit.js';
import { fetchOrder } from '../orders/repo.js';
import { execCard, officeCard } from '../orders/serialize.js';
import { getSettings } from '../settings.js';

const CATEGORY_LABEL = { design: 'Дизайн-проєкт', spec: 'Прорахунки / специфікації', constr: 'Конструктив', other: 'Інші файли' } as const;
type Category = keyof typeof CATEGORY_LABEL;

mkdirSync(config.uploadDir, { recursive: true });

const ext = (name: string) => path.extname(name).slice(1).toLowerCase();

/** Ім'я поточного файлу — щоб відмова «більше 50 МБ» містила назву. */
interface UploadReq extends Request {
  currentFile?: string;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${ext(file.originalname) ? `.${ext(file.originalname)}` : ''}`),
  }),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 20 },
  defParamCharset: 'utf8',
  fileFilter: (req, file, cb) => {
    (req as UploadReq).currentFile = file.originalname;
    if (!(FILE_EXTENSIONS as readonly string[]).includes(ext(file.originalname))) {
      cb(badRequest(`Тип файлу не підтримується: ${file.originalname}. Дозволено: зображення, PDF, DWG, DXF, B3D, PRO100, STO, ZIP, RAR, DOC/DOCX, XLS/XLSX.`));
      return;
    }
    cb(null, true);
  },
}).array('files', 20);

/** Обгортка multer: зрозумілі тексти помилок. */
function receive(req: Request, res: Parameters<typeof upload>[1]): Promise<void> {
  return new Promise((resolve, reject) =>
    upload(req, res, (err: unknown) => {
      if (!err) return resolve();
      if (err instanceof multer.MulterError) {
        const name = (req as UploadReq).currentFile;
        if (err.code === 'LIMIT_FILE_SIZE') return reject(badRequest(`Файл більше ${MAX_FILE_MB} МБ, не додано: ${name ?? ''}`));
        if (err.code === 'LIMIT_FILE_COUNT') return reject(badRequest('Не більше 20 файлів за раз.'));
        return reject(badRequest('Не вдалося отримати файл. Спробуйте ще раз.'));
      }
      reject(err);
    }),
  );
}

export const filesRouter = Router();

filesRouter.post('/orders/:id/files', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) throw notFound();
  const u = me(req);
  await receive(req, res);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const cleanup = () => Promise.all(files.map((f) => unlink(f.path).catch(() => {})));
  try {
    const category = z.enum(['design', 'spec', 'constr', 'other']).parse(req.body?.category) as Category;
    if (category === 'spec' && !isOffice(u)) throw forbidden('Файли «Прорахунки / специфікації» додають лише менеджер і власник.');
    if (!files.length) throw badRequest('Виберіть файл.');
    await tx(async (c) => {
      const o = await fetchOrder(c, id, true);
      if (!o) throw notFound('Замовлення не знайдено.');
      for (const f of files) {
        await c.query(
          `INSERT INTO order_files (order_id, category, name, size, mime, storage_key, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, category, f.originalname.slice(0, 255), f.size, f.mimetype, f.filename, u.id],
        );
        await writeLog(c, category === 'spec'
          ? { userId: u.id, orderId: id, folder: 'fin', finScope: 'pay', text: `Додано файл «${f.originalname}» (${CATEGORY_LABEL.spec})` }
          : {
              userId: u.id,
              orderId: id,
              folder: 'files',
              text: category === 'design' ? `Додано файл дизайн-проєкту «${f.originalname}»` : `Додано файл «${f.originalname}» (${CATEGORY_LABEL[category]})`,
            });
      }
    });
  } catch (e) {
    await cleanup();
    throw e;
  }
  const o = (await fetchOrder(pool, id))!;
  res.status(201).json(isOffice(u) ? await officeCard(pool, o, await getSettings(pool), u) : await execCard(pool, o, u));
});

/** Відкрити / завантажити файл. Зображення (крім SVG) і PDF відкриваються в браузері, решта — завантажуються. */
filesRouter.get('/files/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) throw notFound();
  const u = me(req);
  const r = await pool.query<{ name: string; mime: string | null; storage_key: string; category: Category }>(
    'SELECT name, mime, storage_key, category FROM order_files WHERE id = $1',
    [id],
  );
  const f = r.rows[0];
  if (!f) throw notFound('Файл не знайдено.');
  if (f.category === 'spec' && !isOffice(u)) throw forbidden();
  const inline = !!f.mime && f.mime !== 'image/svg+xml' && (f.mime.startsWith('image/') || f.mime === 'application/pdf');
  res.set('Cache-Control', 'private, max-age=3600');
  res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.attachment(f.name);
  if (inline) res.set('Content-Disposition', res.get('Content-Disposition')!.replace(/^attachment/, 'inline'));
  res.type(inline ? f.mime! : 'application/octet-stream');
  res.sendFile(path.join(config.uploadDir, f.storage_key), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Файл відсутній у сховищі. Зверніться до адміністратора.' });
  });
});


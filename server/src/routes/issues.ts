/**
 * 8А.2 Не вистачає / брак деталі: надсилає будь-який виконавець (і офіс), опрацьовують менеджер і власник.
 * Фото додається у «Файли → Інші файли» як «брак_№_назва». Сум і цін немає.
 */
import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { MAX_FILE_MB } from '@vudo/shared';
import { config } from '../config.js';
import { tx } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { me, requireOffice } from '../auth/middleware.js';
import { writeLog } from '../audit.js';
import { fetchOrder } from '../orders/repo.js';

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp'];
const ext = (n: string) => path.extname(n).slice(1).toLowerCase();

const photoUpload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, f, cb) => cb(null, `${randomUUID()}.${ext(f.originalname) || 'jpg'}`),
  }),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 1 },
  defParamCharset: 'utf8',
  fileFilter: (_req, f, cb) => {
    if (!IMAGE_EXT.includes(ext(f.originalname)) && !f.mimetype.startsWith('image/')) return cb(badRequest('Фото — лише зображення (JPG, PNG, HEIC…).'));
    cb(null, true);
  },
}).single('photo');

const issueSchema = z.object({
  type: z.enum(['Не вистачає', 'Брак деталі']),
  itemId: z.coerce.number().int().positive().optional().or(z.literal('').transform(() => undefined)),
  qty: z.string().trim().max(100).optional(),
  text: z.string().trim().min(1, 'Опишіть, чого не вистачає або що за брак.').max(2000),
  urgent: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .optional()
    .transform((v) => v === true || v === 'true' || v === '1'),
});

export const issuesRouter = Router();

issuesRouter.post('/orders/:id/issues', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) throw notFound();
  const u = me(req);
  await new Promise<void>((ok, bad) =>
    photoUpload(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return bad(badRequest(`Фото більше ${MAX_FILE_MB} МБ, не додано.`));
      if (err) return bad(err);
      ok();
    }),
  );
  const photo = req.file;
  try {
    const b = issueSchema.parse(req.body ?? {});
    await tx(async (c) => {
      const o = await fetchOrder(c, id, true);
      if (!o) throw notFound('Замовлення не знайдено.');
      const item = b.itemId ? o.items.find((i) => i.id === b.itemId) : undefined;
      if (b.itemId && !item) throw badRequest('Виріб не знайдено в цьому замовленні.');
      let photoId: number | null = null;
      if (photo) {
        const name = `брак_${o.num}_${photo.originalname}`.slice(0, 255);
        const f = await c.query<{ id: number }>(
          `INSERT INTO order_files (order_id, category, name, size, mime, storage_key, created_by)
           VALUES ($1, 'other', $2, $3, $4, $5, $6) RETURNING id`,
          [id, name, photo.size, photo.mimetype, photo.filename, u.id],
        );
        photoId = f.rows[0]!.id;
      }
      await c.query(
        `INSERT INTO issues (order_id, item_id, type, text, qty, urgent, photo_file_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, item?.id ?? null, b.type, b.text, b.qty || null, b.urgent, photoId, u.id],
      );
      await writeLog(c, {
        userId: u.id,
        orderId: id,
        folder: 'issue',
        text: `${b.type}: ${b.text}${b.qty ? ` — ${b.qty}` : ''}${item ? ` («${item.name}»)` : ''}${b.urgent ? '. ТЕРМІНОВО, зупиняє роботу' : ''}. Потрібне дозамовлення`,
      });
    });
  } catch (e) {
    if (photo) await unlink(photo.path).catch(() => {});
    throw e;
  }
  res.status(201).json({ ok: true });
});

/** Статус проблеми: нове → замовлено → вирішено (лише менеджер і власник). */
issuesRouter.patch('/issues/:id', requireOffice, async (req, res) => {
  const id = Number(req.params.id);
  const { status } = z.object({ status: z.enum(['замовлено', 'вирішено']) }).parse(req.body);
  const u = me(req);
  await tx(async (c) => {
    const r = await c.query<{ order_id: number; text: string; status: string }>('SELECT order_id, text, status FROM issues WHERE id = $1 FOR UPDATE', [id]);
    const x = r.rows[0];
    if (!x) throw notFound('Запис не знайдено.');
    if (x.status === status) return;
    if (x.status === 'вирішено') throw badRequest('Проблему вже вирішено.');
    await c.query('UPDATE issues SET status = $2, status_at = now(), status_by = $3 WHERE id = $1', [id, status, u.id]);
    const short = x.text.length > 60 ? `${x.text.slice(0, 60)}…` : x.text;
    await writeLog(c, {
      userId: u.id,
      orderId: x.order_id,
      folder: 'issue',
      text: `Проблема «${short}»: ${status === 'замовлено' ? 'дозамовлено' : 'вирішено'}`,
    });
  });
  res.json({ ok: true });
});

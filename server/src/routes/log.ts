import { Router } from 'express';
import { z } from 'zod';
import { LOG_FOLDERS, isLogFolder, type LogFolder } from '@vudo/shared';
import { pool, tx } from '../db.js';
import { me } from '../auth/middleware.js';
import { visibleLogSql } from '../audit.js';

const listSchema = z.object({
  folder: z.string().default('all'),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(200),
});

/** Межа «нового» для папки: id останнього прочитаного (або базова межа '*' нового користувача). */
const SEEN_SQL = `GREATEST(
  COALESCE((SELECT r.last_id FROM log_reads r WHERE r.user_id = $1 AND r.folder = l.folder), 0),
  COALESCE((SELECT r.last_id FROM log_reads r WHERE r.user_id = $1 AND r.folder = '*'), 0))`;

export const logRouter = Router();

/** Лічильники по папках: нові (чужі, непрочитані) і всього. */
async function counters(userId: number, vis: string) {
  const r = await pool.query<{ folder: LogFolder; total: number; fresh: number }>(
    `SELECT l.folder, count(*)::int AS total,
            count(*) FILTER (WHERE l.user_id IS DISTINCT FROM $1 AND l.id > ${SEEN_SQL})::int AS fresh
       FROM audit_log l WHERE ${vis} GROUP BY l.folder`,
    [userId],
  );
  const out: Record<string, { new: number; total: number }> = {};
  for (const [k] of LOG_FOLDERS) out[k] = { new: 0, total: 0 };
  for (const row of r.rows) out[row.folder] = { new: row.fresh, total: row.total };
  return out;
}

/** Стрічка журналу (новіші вгорі, до 200, далі підвантаження) з лічильниками папок. */
logRouter.get('/log', async (req, res) => {
  const q = listSchema.parse(req.query);
  const u = me(req);
  const vis = visibleLogSql(u);
  const folder = q.folder === 'all' || !isLogFolder(q.folder) ? null : q.folder;
  const r = await pool.query(
    `SELECT l.id, l.at, l.user_id AS "userId", COALESCE(u.name, 'Система') AS "userName",
            l.order_id AS "orderId", ord.num AS "orderNum", l.text, l.folder,
            (l.user_id IS DISTINCT FROM $1 AND l.id > ${SEEN_SQL}) AS "isNew"
       FROM audit_log l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN orders ord ON ord.id = l.order_id
      WHERE ${vis} AND ($2::text IS NULL OR l.folder = $2) AND ($3::bigint IS NULL OR l.id < $3)
      ORDER BY l.id DESC LIMIT $4`,
    [u.id, folder, q.before ?? null, q.limit + 1],
  );
  const hasMore = r.rows.length > q.limit;
  res.json({ entries: r.rows.slice(0, q.limit), hasMore, counters: await counters(u.id, vis) });
});

/** Загальна кількість нових доступних записів — для лічильника біля «Повідомлень». */
logRouter.get('/log/unread', async (req, res) => {
  const u = me(req);
  const c = await counters(u.id, visibleLogSql(u));
  res.json({ total: Object.values(c).reduce((s, x) => s + x.new, 0) });
});

/** Відкриття папки позначає її записи прочитаними («Усі» — усі доступні). */
logRouter.post('/log/read', async (req, res) => {
  // upTo — найбільший id, який користувач реально побачив (записи, що прийшли пізніше, лишаються новими).
  const { folder, upTo } = z
    .object({ folder: z.string(), upTo: z.number().int().positive().optional() })
    .parse(req.body);
  const u = me(req);
  const vis = visibleLogSql(u);
  const target = folder === 'all' || !isLogFolder(folder) ? null : folder;
  await tx(async (c) => {
    const r = await c.query<{ folder: string; max: number }>(
      `SELECT l.folder, max(l.id)::bigint AS max FROM audit_log l
        WHERE ${vis} AND ($1::text IS NULL OR l.folder = $1) AND ($2::bigint IS NULL OR l.id <= $2)
        GROUP BY l.folder`,
      [target, upTo ?? null],
    );
    for (const row of r.rows) {
      await c.query(
        `INSERT INTO log_reads (user_id, folder, last_id) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, folder) DO UPDATE SET last_id = GREATEST(log_reads.last_id, EXCLUDED.last_id)`,
        [u.id, row.folder, row.max],
      );
    }
  });
  res.json({ ok: true });
});

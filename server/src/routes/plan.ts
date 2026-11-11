/** 8. Планування: етапи активних замовлень з розрахованими датами, вікно етапу, «Мій день». Сум тут немає. */
import { Router } from 'express';
import { z } from 'zod';
import { addDays, daysBetween, fmtDate, isOffice, kyivToday, type Role } from '@vudo/shared';
import { pool, tx } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { me, requireOffice, requireSection } from '../auth/middleware.js';
import { writeLog } from '../audit.js';
import { fetchOrder, fetchOrders, taskSchedule, type OrderAgg, type TaskRow } from '../orders/repo.js';
import { makeMissingPlans } from '../orders/plan.js';
import { checkPerson } from '../orders/people.js';

export const planRouter = Router();

/** Етапи всіх активних замовлень (не архів, не Відмова) з датами за ланцюжком. */
planRouter.get('/plan', requireSection('plan'), async (_req, res) => {
  const orders = await fetchOrders(pool, `NOT o.archived AND o.status <> 'Відмова'`);
  const roles = await pool.query<{ id: number; roles: Role[] }>('SELECT id, roles FROM users');
  const rolesOf = new Map(roles.rows.map((u) => [u.id, u.roles]));
  const tasks = orders.flatMap((o) => {
    const sch = taskSchedule(o);
    return o.tasks.map((t) => ({
      ...t,
      itemName: o.items.find((i) => i.id === t.itemId)?.name ?? '',
      itemPos: o.items.findIndex((i) => i.id === t.itemId),
      assigneeRoles: t.assigneeId ? (rolesOf.get(t.assigneeId) ?? []) : [],
      orderNum: o.num,
      clientName: o.client.name,
      installDate: o.installDate,
      sched: sch.get(t.id)!,
    }));
  });
  res.json({
    today: kyivToday(),
    tasks,
    orders: orders.filter((o) => o.tasks.length).map((o) => ({ id: o.id, num: o.num, clientName: o.client.name })),
  });
});

async function taskWithOrder(id: number): Promise<{ t: TaskRow; o: OrderAgg }> {
  const r = await pool.query<{ order_id: number }>('SELECT order_id FROM plan_tasks WHERE id = $1', [id]);
  const orderId = r.rows[0]?.order_id;
  const o = orderId ? await fetchOrder(pool, orderId) : null;
  const t = o?.tasks.find((x) => x.id === id);
  if (!o || !t) throw notFound('Етап не знайдено.');
  return { t, o };
}

const taskSchema = z.object({
  days: z.number().int().min(1, 'Вкажіть кількість днів (від 1).').max(120, 'Не більше 120 днів.'),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .or(z.literal('').transform(() => null)),
  progress: z.number().int().min(0).max(100).multipleOf(10, 'Виконано — кроком 10 %.'),
  comment: z.string().trim().max(2000).transform((v) => v || null),
  assigneeId: z.number().int().positive().optional(),
});

/** Вікно етапу: редагує відповідальний, менеджер або адмін; відповідального змінює лише менеджер/адмін. */
planRouter.patch('/plan/tasks/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) throw notFound();
  const b = taskSchema.parse(req.body);
  const u = me(req);
  const { t, o } = await taskWithOrder(id);
  const office = isOffice(u);
  if (!office && t.assigneeId !== u.id) throw forbidden('Змінювати етап може відповідальний або менеджер.');
  if (b.assigneeId != null && b.assigneeId !== t.assigneeId && !office) throw forbidden('Відповідального змінює лише менеджер або адмін.');
  // Дату заміру ставить менеджер або власник; замірник лише позначає виконання.
  const measureMoved = t.stage === 'Замір' && (b.days !== t.days || b.startDate !== (t.startDate ?? null));
  if (measureMoved && !office) throw forbidden('Дату заміру ставить менеджер або власник у картці замовлення.');
  if (t.stage === 'Замір' && office && !b.startDate) throw badRequest('Вкажіть дату заміру (поле «Початок»).');
  await tx(async (c) => {
    let assignee = t.assigneeId;
    let assigneeName: string | null = null;
    if (b.assigneeId != null && b.assigneeId !== t.assigneeId) {
      const all: Role[] = ['Адмін', 'Менеджер', 'Замірник', 'Конструктор', 'Технолог', 'Цех', 'Монтажник'];
      assigneeName = await checkPerson(c, b.assigneeId, all, 'Відповідальний', [t.assigneeId]);
      assignee = b.assigneeId;
    }
    const r = await c.query(
      `UPDATE plan_tasks SET days = $2, start_date = $3, progress = $4, comment = $5, assignee_id = $6
        WHERE id = $1 AND days IS NOT DISTINCT FROM $7 AND progress = $8`,
      [id, b.days, b.startDate, b.progress, b.comment, assignee, t.days, t.progress],
    );
    // Хтось інший щойно змінив етап — не перезаписуємо мовчки.
    if (!r.rowCount) throw badRequest('Етап щойно змінив хтось інший. Відкрийте його ще раз.');
    // Нова дата заміру — і в картці замовлення, і в інших виробах цього замовлення.
    if (measureMoved && b.startDate !== o.measureDate) {
      await c.query('UPDATE orders SET measure_date = $2 WHERE id = $1', [o.id, b.startDate]);
      await c.query(
        `UPDATE plan_tasks SET start_date = $2, days = 1 WHERE order_id = $1 AND stage = 'Замір' AND progress < 100 AND id <> $3`,
        [o.id, b.startDate, id],
      );
      await writeLog(c, { userId: u.id, orderId: o.id, folder: 'zamir', text: `Дата заміру: ${o.measureDate ? fmtDate(o.measureDate) : '—'} → ${fmtDate(b.startDate!)}` });
    }
    const ch = [
      t.days !== b.days ? `днів ${t.days ?? '—'} → ${b.days}` : null,
      (t.startDate ?? null) !== b.startDate ? `початок: ${b.startDate ? fmtDate(b.startDate) : 'одразу після попереднього'}` : null,
      t.progress !== b.progress ? `виконано ${b.progress}%` : null,
      assigneeName ? `відповідальний: ${assigneeName}` : null,
      (t.comment ?? null) !== b.comment && b.comment ? `коментар: ${b.comment.slice(0, 60)}` : null,
    ].filter(Boolean);
    const item = o.items.find((i) => i.id === t.itemId)?.name ?? '';
    if (ch.length) await writeLog(c, { userId: u.id, orderId: o.id, folder: 'plan', text: `План «${item}» · ${t.stage}: ${ch.join(', ')}` });
  });
  res.json({ ok: true });
});

/** «Створити план етапів» для виробів без плану (лише менеджер/адмін). */
planRouter.post('/orders/:id/plan', requireOffice, async (req, res) => {
  const id = Number(req.params.id);
  const u = me(req);
  await tx(async (c) => {
    const o = await fetchOrder(c, id, true);
    if (!o) throw notFound('Замовлення не знайдено.');
    const made = await makeMissingPlans(c, o);
    if (!made.length) throw badRequest('План для всіх виробів уже створено.');
    await writeLog(c, { userId: u.id, orderId: id, folder: 'plan', text: `Створено план етапів: ${made.join(', ')}. Відповідальні мають вказати кількість днів.` });
  });
  res.json({ ok: true });
});

/* ---------- 8А.3 Мій день (Виїзди) ---------- */

interface Visit {
  orderId: number;
  num: string;
  stage: 'Замір' | 'Монтаж';
  address: string | null;
  clientName: string;
  phone: string | null;
  comment: string | null;
  items: { id: number; name: string; type: string }[];
  files: { id: number; name: string; category: string; createdAt: string }[];
  taskIds: number[];
  done: boolean;
}

/**
 * Виїзди працівника на день: етапи «Монтаж» і «Замір», де він відповідальний або вибраний
 * серед монтажників / замірником, і день входить у планові дати етапу (або дата монтажу / заміру = цей день).
 * Одне замовлення + один тип = одна картка.
 */
export function visitsFor(orders: OrderAgg[], userId: number, isMeasurer: boolean, day: string): Visit[] {
  const out = new Map<string, Visit>();
  const add = (o: OrderAgg, stage: 'Замір' | 'Монтаж') => {
    const k = `${o.id}|${stage}`;
    let v = out.get(k);
    if (!v) {
      v = {
        orderId: o.id,
        num: o.num,
        stage,
        address: o.address,
        clientName: o.client.name,
        phone: o.client.phone,
        comment: o.comment,
        items: o.items.map((i) => ({ id: i.id, name: i.name, type: i.type })),
        files: o.files
          .filter((f) => f.category === 'constr' || f.category === 'design')
          .map((f) => ({ id: f.id, name: f.name, category: f.category, createdAt: f.createdAt })),
        taskIds: [],
        done: false,
      };
      out.set(k, v);
    }
    return v;
  };
  for (const o of orders) {
    const sch = taskSchedule(o);
    for (const t of o.tasks) {
      if (t.stage !== 'Монтаж' && t.stage !== 'Замір') continue;
      const mine =
        t.assigneeId === userId ||
        (t.stage === 'Монтаж' && o.installerIds.includes(userId)) ||
        (t.stage === 'Замір' && o.measurerId === userId);
      if (!mine) continue;
      const r = sch.get(t.id)!;
      const hit =
        (r.planned && r.start <= day && day < r.end!) ||
        (t.stage === 'Монтаж' && o.installDate === day) ||
        (t.stage === 'Замір' && o.measureDate === day);
      if (hit) add(o, t.stage).taskIds.push(t.id);
    }
    // Замір без виробів — за датою заміру і замірником
    if (isMeasurer && o.measureDate === day && o.measurerId === userId && !o.items.length) add(o, 'Замір');
  }
  for (const v of out.values()) {
    const o = orders.find((x) => x.id === v.orderId)!;
    v.done = v.taskIds.length > 0 && v.taskIds.every((id) => o.tasks.find((t) => t.id === id)!.progress >= 100);
  }
  return [...out.values()].sort((a, b) => a.stage.localeCompare(b.stage) || a.num.localeCompare(b.num));
}

const dayQuery = z.object({
  user: z.coerce.number().int().positive().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

planRouter.get('/myday', requireSection('myday'), async (req, res) => {
  const q = dayQuery.parse(req.query);
  const u = me(req);
  const office = isOffice(u);
  // Менеджер і власник вибирають працівника; виконавці бачать лише свої виїзди.
  const fieldPeople = (
    await pool.query<{ id: number; name: string; roles: Role[] }>(
      `SELECT id, name, roles FROM users WHERE NOT disabled AND roles && ARRAY['Монтажник','Замірник'] ORDER BY name`,
    )
  ).rows;
  let userId = u.id;
  if (office) userId = q.user && fieldPeople.some((p) => p.id === q.user) ? q.user : (fieldPeople[0]?.id ?? 0);
  else if (q.user && q.user !== u.id) throw forbidden();
  const day = q.date ?? kyivToday();
  const person = fieldPeople.find((p) => p.id === userId) ?? (userId === u.id ? u : null);
  const isMeasurer = !!person?.roles.includes('Замірник');
  const orders = userId ? await fetchOrders(pool, `NOT o.archived AND o.status <> 'Відмова'`) : [];
  const visits = userId ? visitsFor(orders, userId, isMeasurer, day) : [];
  const issues = await openIssuesFor(visits.map((v) => v.orderId));
  // Якщо на день нічого немає — найближчі виїзди (до 5 за 14 днів).
  const upcoming: { date: string; visits: Pick<Visit, 'orderId' | 'num' | 'stage' | 'address' | 'clientName'>[] }[] = [];
  if (!visits.length && userId) {
    for (let k = 1; k <= 14 && upcoming.length < 5; k++) {
      const d = addDays(day, k);
      const v = visitsFor(orders, userId, isMeasurer, d);
      if (v.length) upcoming.push({ date: d, visits: v.map(({ orderId, num, stage, address, clientName }) => ({ orderId, num, stage, address, clientName })) });
    }
  }
  res.json({
    userId,
    day,
    people: office ? fieldPeople : [],
    visits: visits.map((v) => ({ ...v, issues: issues.filter((i) => i.orderId === v.orderId) })),
    upcoming,
  });
});

async function openIssuesFor(orderIds: number[]) {
  if (!orderIds.length) return [];
  const r = await pool.query<{ orderId: number }>(
    `SELECT i.id, i.order_id AS "orderId", i.type, i.text, i.qty, i.urgent, i.status, i.created_at AS "createdAt",
            u.name AS "byName", it.name AS "itemName", i.photo_file_id AS "photoId"
       FROM issues i LEFT JOIN users u ON u.id = i.created_by LEFT JOIN items it ON it.id = i.item_id
      WHERE i.order_id = ANY($1) AND i.status <> 'вирішено' ORDER BY i.id`,
    [orderIds],
  );
  return r.rows;
}

/** «Змонтовано ✓» / «Замір виконано ✓»: етапи → 100 %, запис у журнал. Статус замовлення змінює менеджер. */
planRouter.post('/myday/done', async (req, res) => {
  const { taskIds } = z.object({ taskIds: z.array(z.number().int().positive()).min(1).max(50) }).parse(req.body);
  const u = me(req);
  const today = kyivToday();
  await tx(async (c) => {
    const r = await c.query<{ order_id: number }>('SELECT DISTINCT order_id FROM plan_tasks WHERE id = ANY($1)', [taskIds]);
    for (const { order_id } of r.rows) {
      const o = (await fetchOrder(c, order_id, true))!;
      const sch = taskSchedule(o, today);
      for (const t of o.tasks.filter((x) => taskIds.includes(x.id))) {
        if (t.stage !== 'Монтаж' && t.stage !== 'Замір') throw badRequest('Позначити можна лише етапи «Замір» і «Монтаж».');
        const mine =
          t.assigneeId === u.id || (t.stage === 'Монтаж' && o.installerIds.includes(u.id)) || (t.stage === 'Замір' && o.measurerId === u.id);
        if (!mine && !isOffice(u)) throw forbidden('Позначити виїзд може лише його виконавець або менеджер.');
        if (t.progress >= 100) continue;
        const s = sch.get(t.id)!;
        let start = t.startDate;
        let days = t.days;
        if (!days || !s.planned) {
          start = start ?? today;
          days = 1;
        } else if (s.end! > addDays(today, 1) && s.start <= today) {
          // завершено раніше плану — кінець етапу стає сьогодні
          days = Math.max(1, daysBetween(s.start, today) + 1);
        }
        await c.query('UPDATE plan_tasks SET progress = 100, start_date = $2, days = $3 WHERE id = $1', [t.id, start, days]);
        const item = o.items.find((i) => i.id === t.itemId)?.name ?? '';
        await writeLog(c, { userId: u.id, orderId: o.id, folder: t.stage === 'Замір' ? 'zamir' : 'mont', text: `План «${item}» · ${t.stage}: виконано 100%` });
      }
    }
  });
  res.json({ ok: true });
});

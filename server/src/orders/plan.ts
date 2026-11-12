/** Етапи плану (ТЗ 8.1): створення, відповідальні з картки замовлення, завершення за статусом. */
import { PLAN_STAGES, kyivToday, stagePassed, type PlanStage, type Role, type Status } from '@vudo/shared';
import type { Db } from '../db.js';

interface OrderPeople {
  id: number;
  status: Status;
  managerId: number;
  measurerId: number | null;
  constructorId: number | null;
  installerIds: number[];
  /** Дата заміру з картки: етап «Замір» стоїть саме на ній (1 день). */
  measureDate?: string | null;
}

const STAGE_ROLE: Record<PlanStage, Role> = {
  'Прорахунок': 'Менеджер',
  'Замір': 'Замірник',
  'Конструктив': 'Конструктор',
  'Збірка': 'Цех',
  'Монтаж': 'Монтажник',
};

/** Відповідальний з картки замовлення (вкладка «Загальне», блок «Команда»), якщо вибрано. */
function fromCard(o: OrderPeople, st: PlanStage): number | null {
  switch (st) {
    case 'Прорахунок':
      return o.managerId;
    case 'Замір':
      return o.measurerId;
    case 'Конструктив':
      return o.constructorId;
    case 'Монтаж':
      return o.installerIds[0] ?? null;
    case 'Збірка':
      return null;
  }
}

async function firstActive(db: Db, role: Role): Promise<number | null> {
  const r = await db.query<{ id: number }>(
    `SELECT id FROM users WHERE NOT disabled AND $1 = ANY(roles) ORDER BY id LIMIT 1`,
    [role],
  );
  return r.rows[0]?.id ?? null;
}

/**
 * Створює 5 етапів для замовлення (один ланцюжок на весь об'єкт).
 * Етапи, вже пройдені за статусом, — виконані (1 день, 100 %); замір з датою — на цій даті.
 * Повертає true, якщо план створено (раніше його не було).
 */
export async function makePlan(db: Db, o: OrderPeople, today = kyivToday()): Promise<boolean> {
  const exists = await db.query('SELECT 1 FROM plan_tasks WHERE order_id = $1 LIMIT 1', [o.id]);
  if (exists.rowCount) return false;
  for (const [k, st] of PLAN_STAGES.entries()) {
    const assignee = fromCard(o, st) ?? (await firstActive(db, STAGE_ROLE[st]));
    const done = stagePassed(o.status, st);
    const measured = !done && st === 'Замір' && o.measureDate;
    await db.query(
      `INSERT INTO plan_tasks (order_id, stage, idx, assignee_id, start_date, days, progress)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (order_id, stage) DO NOTHING`,
      [o.id, st, k + 1, assignee, done ? today : measured ? o.measureDate : null, done || measured ? 1 : null, done ? 100 : 0],
    );
  }
  return true;
}

/** План для замовлень, у яких його ще немає (наприклад, створених до переходу на план по об'єкту). */
export async function ensureAllPlans(db: Db): Promise<number> {
  const r = await db.query<OrderPeople>(
    `SELECT id, status, manager_id AS "managerId", measurer_id AS "measurerId", constructor_id AS "constructorId",
            installer_ids AS "installerIds", measure_date AS "measureDate"
       FROM orders o WHERE NOT EXISTS (SELECT 1 FROM plan_tasks t WHERE t.order_id = o.id)`,
  );
  for (const o of r.rows) await makePlan(db, o);
  return r.rows.length;
}

/**
 * Оновлює відповідальних у незавершених етапах за полями картки:
 * Замір → замірник, Конструктив → конструктор, Прорахунок → менеджер,
 * Монтаж → перший монтажник (якщо поточний відповідальний не серед вибраних).
 */
export async function applyPeople(db: Db, o: OrderPeople): Promise<number> {
  let n = 0;
  for (const st of ['Прорахунок', 'Замір', 'Конструктив', 'Монтаж'] as const) {
    const who = fromCard(o, st);
    if (!who) continue;
    const r = await db.query(
      `UPDATE plan_tasks SET assignee_id = $3
        WHERE order_id = $1 AND stage = $2 AND progress < 100
          AND assignee_id IS DISTINCT FROM $3
          AND NOT ($2 = 'Монтаж' AND assignee_id = ANY($4::bigint[]))`,
      [o.id, st, who, o.installerIds],
    );
    n += r.rowCount ?? 0;
  }
  return n;
}

/** Перехід замовлення в статус ставить етапу 100 % (якщо днів не було — 1 день від сьогодні). */
export async function completeStage(db: Db, orderId: number, stage: PlanStage, today = kyivToday()): Promise<void> {
  // Замір з призначеною датою лишається на своїй даті — це факт, а не «сьогодні».
  await db.query(
    `UPDATE plan_tasks t SET progress = 100,
            start_date = CASE WHEN t.stage = 'Замір' AND o.measure_date IS NOT NULL THEN o.measure_date
                              WHEN t.days IS NULL THEN $3::date ELSE t.start_date END,
            days = CASE WHEN t.stage = 'Замір' AND o.measure_date IS NOT NULL THEN 1 ELSE COALESCE(t.days, 1) END
       FROM orders o
      WHERE o.id = t.order_id AND t.order_id = $1 AND t.stage = $2 AND t.progress < 100`,
    [orderId, stage, today],
  );
}

/**
 * Дату заміру ставить менеджер або власник — і вона одразу стає фактом у плані:
 * усі етапи «Замір» (і виконані теж) стають на цю дату (1 день). Без дати — незавершений етап знову без днів.
 */
export async function syncMeasureTasks(db: Db, orderId: number, measureDate: string | null): Promise<void> {
  await db.query(
    `UPDATE plan_tasks SET start_date = $2::date, days = CASE WHEN $2::date IS NULL THEN NULL ELSE 1 END
      WHERE order_id = $1 AND stage = 'Замір' AND ($2::date IS NOT NULL OR progress < 100)`,
    [orderId, measureDate],
  );
}

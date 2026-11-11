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

/** Створює 5 етапів для виробу. Етапи, вже пройдені за статусом, — виконані (1 день, 100 %). */
export async function makePlan(db: Db, o: OrderPeople, itemId: number, today = kyivToday()): Promise<void> {
  for (const [k, st] of PLAN_STAGES.entries()) {
    const assignee = fromCard(o, st) ?? (await firstActive(db, STAGE_ROLE[st]));
    const done = stagePassed(o.status, st);
    // Замір із призначеною датою — одразу запланований на цю дату.
    const measured = !done && st === 'Замір' && o.measureDate;
    await db.query(
      `INSERT INTO plan_tasks (order_id, item_id, stage, idx, assignee_id, start_date, days, progress)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (item_id, stage) DO NOTHING`,
      [o.id, itemId, st, k + 1, assignee, done ? today : measured ? o.measureDate : null, done || measured ? 1 : null, done ? 100 : 0],
    );
  }
}

/** Створює план для виробів замовлення, у яких його ще немає. Повертає назви виробів. */
export async function makeMissingPlans(db: Db, o: OrderPeople, today = kyivToday()): Promise<string[]> {
  const r = await db.query<{ id: number; name: string }>(
    `SELECT i.id, i.name FROM items i WHERE i.order_id = $1
       AND NOT EXISTS (SELECT 1 FROM plan_tasks t WHERE t.item_id = i.id) ORDER BY i.id`,
    [o.id],
  );
  for (const i of r.rows) await makePlan(db, o, i.id, today);
  return r.rows.map((i) => i.name);
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
  await db.query(
    `UPDATE plan_tasks SET progress = 100,
            start_date = CASE WHEN days IS NULL THEN $3::date ELSE start_date END,
            days = COALESCE(days, 1)
      WHERE order_id = $1 AND stage = $2 AND progress < 100`,
    [orderId, stage, today],
  );
}

/**
 * Дату заміру ставить менеджер або власник — і вона одразу стає фактом у плані:
 * незавершені етапи «Замір» стають на цю дату (1 день). Без дати — етап знову без днів.
 */
export async function syncMeasureTasks(db: Db, orderId: number, measureDate: string | null): Promise<void> {
  await db.query(
    `UPDATE plan_tasks SET start_date = $2::date, days = CASE WHEN $2::date IS NULL THEN NULL ELSE 1 END
      WHERE order_id = $1 AND stage = 'Замір' AND progress < 100`,
    [orderId, measureDate],
  );
}

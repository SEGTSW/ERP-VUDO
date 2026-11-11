-- Дата заміру — факт: етапи «Замір» (і виконані теж) стоять на даті заміру з картки замовлення.
UPDATE plan_tasks t
   SET start_date = o.measure_date, days = 1
  FROM orders o
 WHERE o.id = t.order_id AND t.stage = 'Замір' AND o.measure_date IS NOT NULL
   AND (t.start_date IS DISTINCT FROM o.measure_date OR t.days IS DISTINCT FROM 1);

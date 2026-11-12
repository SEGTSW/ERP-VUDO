-- План робіт — один на замовлення (об'єкт), а не на кожен виріб (погоджено із замовником).
-- Наявні етапи виробів зливаються: початок — найраніший, днів — найбільше,
-- виконано — найменше (щоб не позначити виконаним те, що зроблено лише для частини виробів).
CREATE TEMP TABLE plan_agg ON COMMIT DROP AS
  SELECT order_id, stage, min(id) AS keep_id, min(start_date) AS s, max(days) AS d, min(progress) AS p
    FROM plan_tasks GROUP BY order_id, stage;

UPDATE plan_tasks t SET start_date = a.s, days = a.d, progress = a.p FROM plan_agg a WHERE t.id = a.keep_id;
DELETE FROM plan_tasks t USING plan_agg a WHERE t.order_id = a.order_id AND t.stage = a.stage AND t.id <> a.keep_id;

ALTER TABLE plan_tasks DROP CONSTRAINT plan_tasks_item_id_stage_key;
ALTER TABLE plan_tasks DROP COLUMN item_id;
ALTER TABLE plan_tasks ADD CONSTRAINT plan_tasks_order_stage_key UNIQUE (order_id, stage);

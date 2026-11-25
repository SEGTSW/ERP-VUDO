-- Один статус «Замір» замість «Замір призначено» і «Замір виконано».
-- Виконання заміру видно з етапу плану «Замір» (прогрес), він не змінюється. Журнал — історія, не переписуємо.
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
UPDATE orders SET status = 'Замір' WHERE status IN ('Замір призначено', 'Замір виконано');
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('Звернення','Прорахунок','Замір','Очікує рішення клієнта',
  'Проєктування','Проєкт погоджено','Договір / аванс отримано','Закупівля матеріалів','У виробництві',
  'Готово до відвантаження','Доставка / монтаж призначено','Змонтовано','Закрито','Відмова','Рекламація'));

-- Норма днів: від «Замір призначено», якщо її немає — від «Замір виконано».
UPDATE settings
   SET value = jsonb_set(value, '{norms}',
         ((value->'norms') - 'Замір призначено' - 'Замір виконано')
         || CASE WHEN coalesce(value->'norms'->'Замір призначено', value->'norms'->'Замір виконано') IS NULL THEN '{}'::jsonb
                 ELSE jsonb_build_object('Замір', coalesce(value->'norms'->'Замір призначено', value->'norms'->'Замір виконано')) END)
 WHERE key = 'main' AND jsonb_typeof(value->'norms') = 'object';

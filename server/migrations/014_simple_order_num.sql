-- Номер замовлення — просте число 1, 2, 3… (було «2026-0001»).
-- Наявні номери «РРРР-NNNN» стають «N»; якщо так виходять дублікати (кілька років), нумеруємо за порядком створення.
DO $$
BEGIN
  IF (SELECT count(DISTINCT ltrim(split_part(num, '-', 2), '0')) = count(*) FROM orders WHERE num ~ '^\d{4}-\d+$')
     AND NOT EXISTS (SELECT 1 FROM orders a JOIN orders b ON a.num ~ '^\d{4}-\d+$' AND b.num = ltrim(split_part(a.num, '-', 2), '0')) THEN
    UPDATE orders SET num = ltrim(split_part(num, '-', 2), '0') WHERE num ~ '^\d{4}-\d+$';
  ELSE
    UPDATE orders SET num = 'tmp-' || id;
    UPDATE orders o SET num = r.n::text FROM (SELECT id, row_number() OVER (ORDER BY id) AS n FROM orders) r WHERE r.id = o.id;
  END IF;
  PERFORM setval('order_num_seq', greatest(coalesce((SELECT max(num::bigint) FROM orders WHERE num ~ '^\d+$'), 0), 1),
                 EXISTS (SELECT 1 FROM orders WHERE num ~ '^\d+$'));
END $$;

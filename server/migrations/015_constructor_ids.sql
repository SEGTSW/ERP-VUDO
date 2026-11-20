-- Кілька конструкторів на замовлення (як монтажники).
ALTER TABLE orders ADD COLUMN constructor_ids bigint[] NOT NULL DEFAULT '{}';
UPDATE orders SET constructor_ids = ARRAY[constructor_id] WHERE constructor_id IS NOT NULL;
ALTER TABLE orders DROP COLUMN constructor_id;

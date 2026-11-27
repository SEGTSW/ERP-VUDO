-- Файли замовлення: окремий розділ «ТЗ» (технічне завдання для конструктора).
ALTER TABLE order_files DROP CONSTRAINT order_files_category_check;
ALTER TABLE order_files ADD CONSTRAINT order_files_category_check CHECK (category IN ('design', 'spec', 'tz', 'constr', 'other'));

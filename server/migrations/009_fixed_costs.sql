-- 10.7 Постійні витрати: те, що платиться незалежно від кількості замовлень.
CREATE TABLE fixed_costs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          text          COLLATE ukr NOT NULL CHECK (length(btrim(name)) > 0),
  cat           text          NOT NULL DEFAULT '',
  obj           text          NOT NULL DEFAULT '',
  counterparty  text          NOT NULL DEFAULT '',
  amount        numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  period        text          NOT NULL DEFAULT 'month' CHECK (period IN ('month', 'week', 'quarter', 'year')),
  active        boolean       NOT NULL DEFAULT true,
  pos           integer       NOT NULL DEFAULT 0,
  created_at    timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE cash_ops ADD CONSTRAINT cash_ops_fixed_fk FOREIGN KEY (fixed_id) REFERENCES fixed_costs(id);
CREATE INDEX cash_ops_fixed_idx ON cash_ops (fixed_id) WHERE fixed_id IS NOT NULL;

-- Стартовий список (ТЗ 10.7; суми — приклад, замовник замінить своїми).
INSERT INTO fixed_costs (pos, name, cat, obj, amount, period, counterparty) VALUES
  (1, 'Оренда цеху', 'Адміністративні', 'Цех', 18000, 'month', 'Оренда'),
  (2, 'Електроенергія, опалення цеху', 'Інші', 'Цех', 6500, 'month', ''),
  (3, 'Клей, крайка, саморізи, витратні матеріали', 'Інші', 'Цех', 4000, 'month', ''),
  (4, 'Робочий одяг (Ліндстрем)', 'Адміністративні', 'Робочий одяг', 6500, 'month', 'Ліндстрем'),
  (5, 'Зв’язок і телефонія', 'Адміністративні', 'Телефонія', 900, 'month', ''),
  (6, 'СРМ і програми', 'Адміністративні', 'СРМ', 1500, 'month', ''),
  (7, 'Обслуговування інструменту', 'Інші', 'Інструмент', 9000, 'quarter', ''),
  (8, 'Реклама Facebook', 'Маркетинг', 'Фейсбук', 6000, 'month', ''),
  (9, 'Єдиний податок ФОП', 'Податки та збори', 'ФОП', 15000, 'month', ''),
  (10, 'Фіксована зарплата', 'Фонд оплати праці', 'Заробітня плата', 95000, 'month', '');

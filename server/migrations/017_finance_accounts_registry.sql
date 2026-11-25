-- Каси: Готівка, ТОВ, Карта, ФОП.
ALTER TABLE cash_ops DROP CONSTRAINT cash_ops_account_check;
ALTER TABLE cash_ops ADD CONSTRAINT cash_ops_account_check CHECK (account IN ('Готівка', 'ТОВ', 'Карта', 'ФОП'));
ALTER TABLE payable_payments DROP CONSTRAINT payable_payments_account_check;
ALTER TABLE payable_payments ADD CONSTRAINT payable_payments_account_check CHECK (account IN ('Готівка', 'ТОВ', 'Карта', 'ФОП'));

-- Спосіб оплати відповідає касі; колишній «рахунок» — рахунок ТОВ.
ALTER TABLE payments DROP CONSTRAINT payments_method_check;
UPDATE payments SET method = 'рахунок ТОВ' WHERE method = 'рахунок';
ALTER TABLE payments ADD CONSTRAINT payments_method_check CHECK (method IN ('готівка', 'картка', 'рахунок ТОВ', 'рахунок ФОП'));
ALTER TABLE designer_payouts DROP CONSTRAINT designer_payouts_method_check;
UPDATE designer_payouts SET method = 'рахунок ТОВ' WHERE method = 'рахунок';
ALTER TABLE designer_payouts ADD CONSTRAINT designer_payouts_method_check CHECK (method IN ('готівка', 'картка', 'рахунок ТОВ', 'рахунок ФОП'));

-- Спосіб внесення позики — каса. Старе «безготівково» без запису в обліку лишається як є (каса невідома).
ALTER TABLE loan_ops DROP CONSTRAINT loan_ops_method_check;
UPDATE loan_ops o SET method = c.account FROM cash_ops c WHERE c.id = o.cash_op_id;
UPDATE loan_ops SET method = 'Готівка' WHERE method = 'готівка';
ALTER TABLE loan_ops ADD CONSTRAINT loan_ops_method_check CHECK (method IN ('Готівка', 'ТОВ', 'Карта', 'ФОП', 'безготівково'));

-- Стаття «Рекламація» — окремий рядок P&L.
ALTER TABLE articles DROP CONSTRAINT articles_line_check;
ALTER TABLE articles ADD CONSTRAINT articles_line_check CHECK (line IN ('income','orderCost','admin','payroll','other','marketing','tax','logistics','collab',
  'claim','credit','working','invPlus','invMinus','dividends','loan','none'));
ALTER TABLE pnl_plan DROP CONSTRAINT pnl_plan_line_check;
ALTER TABLE pnl_plan ADD CONSTRAINT pnl_plan_line_check CHECK (line IN ('income','orderCost','admin','payroll','other','marketing','tax','logistics','collab',
  'claim','credit','working','invPlus','invMinus','dividends','loan'));
UPDATE articles SET line = 'claim' WHERE type = 'Витрата' AND cat = 'Рекламація';
INSERT INTO articles (type, cat, obj, line)
  SELECT 'Витрата', 'Рекламація', x.obj, 'claim' FROM (VALUES (''), ('Переробка')) x(obj)
   WHERE NOT EXISTS (SELECT 1 FROM articles a WHERE a.type = 'Витрата' AND a.cat = 'Рекламація' AND a.obj = x.obj AND NOT a.hidden);

-- Реєстр платежів (для бухгалтера) — окремо від рахунків до оплати (для власника).
ALTER TABLE payables ADD COLUMN kind text NOT NULL DEFAULT 'bill' CHECK (kind IN ('bill', 'registry'));
ALTER TABLE payables ADD COLUMN invoice_date date;

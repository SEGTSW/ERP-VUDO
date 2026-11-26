-- Валютна каса USD: сума в доларах і курс; sum — гривневий еквівалент (для P&L).
ALTER TABLE cash_ops DROP CONSTRAINT cash_ops_account_check;
ALTER TABLE cash_ops ADD CONSTRAINT cash_ops_account_check CHECK (account IN ('Готівка', 'ТОВ', 'Карта', 'ФОП', 'USD'));
ALTER TABLE cash_ops ADD COLUMN usd numeric(14,2);
ALTER TABLE cash_ops ADD COLUMN rate numeric(12,4) CHECK (rate > 0);
ALTER TABLE cash_ops ADD CONSTRAINT cash_ops_usd_check CHECK ((account = 'USD') = (usd IS NOT NULL AND rate IS NOT NULL));

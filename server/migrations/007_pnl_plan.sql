-- P&L: план за місяцями і рядками (ТЗ 10.2). Значення — як введено (витрати без мінуса; «Кредити», «Позика» — зі знаком).
CREATE TABLE pnl_plan (
  month       char(7)       NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  line        text          NOT NULL CHECK (line IN ('income','orderCost','admin','payroll','other','marketing','tax','logistics','collab',
                                                     'credit','working','invPlus','invMinus','dividends','loan')),
  amount      numeric(14,2) NOT NULL,
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  updated_by  bigint        REFERENCES users(id),
  PRIMARY KEY (month, line)
);

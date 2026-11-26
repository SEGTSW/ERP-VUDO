-- Борги без замовлень: хто винен компанії поза замовленнями (позичили, переплатили постачальнику тощо).
CREATE TABLE other_debts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  debtor      text          COLLATE ukr NOT NULL CHECK (length(btrim(debtor)) > 0),
  phone       text,
  reason      text,
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  date        date          NOT NULL,
  due_date    date,
  cat         text          NOT NULL DEFAULT 'Інші',
  obj         text          NOT NULL DEFAULT '',
  note        text,
  written_off boolean       NOT NULL DEFAULT false,
  created_by  bigint        REFERENCES users(id),
  created_at  timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE other_debt_payments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  debt_id     bigint        NOT NULL REFERENCES other_debts(id) ON DELETE CASCADE,
  date        date          NOT NULL,
  sum         numeric(14,2) NOT NULL CHECK (sum > 0),
  account     text          NOT NULL CHECK (account IN ('Готівка', 'ТОВ', 'Карта', 'ФОП')),
  cash_op_id  bigint        REFERENCES cash_ops(id) ON DELETE SET NULL,
  created_by  bigint        REFERENCES users(id),
  created_at  timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX other_debt_payments_debt ON other_debt_payments(debt_id);

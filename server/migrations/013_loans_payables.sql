-- Реєстр позик (поворотна фінансова допомога) і реєстр рахунків до оплати. Лише власник.

CREATE TABLE loans (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lender         text          COLLATE ukr NOT NULL CHECK (length(btrim(lender)) > 0),
  tax_id         text,
  contract       text,
  contract_date  date,
  limit_amount   numeric(14,2) CHECK (limit_amount > 0),
  interest       text          NOT NULL DEFAULT 'безвідсоткова',
  note           text,
  archived       boolean       NOT NULL DEFAULT false,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  created_by     bigint        REFERENCES users(id)
);

CREATE TABLE loan_ops (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loan_id     bigint        NOT NULL REFERENCES loans(id),
  date        date          NOT NULL,
  kind        text          NOT NULL CHECK (kind IN ('in', 'out')),
  sum         numeric(14,2) NOT NULL CHECK (sum > 0),
  method      text          NOT NULL CHECK (method IN ('безготівково', 'готівка')),
  doc         text,
  note        text,
  -- для надходжень: строк повернення внеску
  due_date    date,
  -- операція обліку, створена разом із цією (якщо ставили «Записати в облік»)
  cash_op_id  bigint        REFERENCES cash_ops(id) ON DELETE SET NULL,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  created_by  bigint        REFERENCES users(id),
  CHECK (kind = 'in' OR due_date IS NULL)
);
CREATE INDEX loan_ops_loan_idx ON loan_ops (loan_id, date);

CREATE TABLE payables (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  counterparty  text          COLLATE ukr NOT NULL CHECK (length(btrim(counterparty)) > 0),
  tax_id        text,
  iban          text,
  purpose       text          NOT NULL DEFAULT '',
  invoice       text,
  amount        numeric(14,2) NOT NULL CHECK (amount > 0),
  vat           numeric(14,2) NOT NULL DEFAULT 0 CHECK (vat >= 0),
  due_date      date,
  priority      text          NOT NULL DEFAULT 'звичайний' CHECK (priority IN ('терміново', 'високий', 'звичайний', 'низький')),
  -- куди піде витрата в обліку при оплаті
  cat           text          NOT NULL DEFAULT '',
  obj           text          NOT NULL DEFAULT '',
  order_id      bigint        REFERENCES orders(id),
  note          text,
  cancelled     boolean       NOT NULL DEFAULT false,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  created_by    bigint        REFERENCES users(id)
);

CREATE TABLE payable_payments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payable_id  bigint        NOT NULL REFERENCES payables(id),
  date        date          NOT NULL,
  sum         numeric(14,2) NOT NULL CHECK (sum > 0),
  account     text          NOT NULL CHECK (account IN ('Карта', 'Готівка')),
  cash_op_id  bigint        REFERENCES cash_ops(id) ON DELETE SET NULL,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  created_by  bigint        REFERENCES users(id)
);
CREATE INDEX payable_payments_idx ON payable_payments (payable_id);

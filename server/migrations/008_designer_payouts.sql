-- 10.5 Виплати дизайнерам-партнерам. Не видаляються; в обліку — автоматичний рядок Витрата/Співпраці/Виплата.
CREATE TABLE designer_payouts (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  designer_id  bigint        NOT NULL REFERENCES clients(id),
  sum          numeric(12,2) NOT NULL CHECK (sum > 0),
  method       text          NOT NULL CHECK (method IN ('готівка', 'картка', 'рахунок')),
  date         date          NOT NULL,
  comment      text,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  created_by   bigint        REFERENCES users(id)
);
CREATE INDEX designer_payouts_designer_idx ON designer_payouts (designer_id);

-- Реєстр документів: як зберігається документ (фізично / електронно) і де саме.
ALTER TABLE contracts ADD COLUMN storage text NOT NULL DEFAULT '' CHECK (storage IN ('', 'Фізично', 'Електронно', 'Фізично і електронно'));
ALTER TABLE contracts ADD COLUMN location text NOT NULL DEFAULT '';

-- P&L: сума факту, вписана вручну замість порахованої (з обліку або з файлу). Грошовий потік і залишок не змінює.
CREATE TABLE pnl_override (
  month       char(7)       NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  line        text          NOT NULL,
  amount      numeric(14,2) NOT NULL,
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  updated_by  bigint        REFERENCES users(id),
  PRIMARY KEY (month, line)
);

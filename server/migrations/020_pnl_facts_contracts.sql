-- P&L: факт, перенесений із файлу замовника. Місяці з pnl_fixed показують цей факт замість порахованого з обліку.
CREATE TABLE pnl_fixed (
  month       char(7)     PRIMARY KEY CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  note        text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  bigint      REFERENCES users(id)
);
-- month '0000-00' — колонка «До» (до початку обліку), kind: рядок плану / факту у файлі. Суми зі знаком.
CREATE TABLE pnl_fact (
  month   char(7)       NOT NULL,
  line    text          NOT NULL,
  kind    text          NOT NULL DEFAULT 'fact' CHECK (kind IN ('plan', 'fact')),
  amount  numeric(14,2) NOT NULL,
  PRIMARY KEY (month, line, kind)
);
-- Примітки до клітинок плану («Купівля буса» тощо)
CREATE TABLE pnl_notes (
  month  char(7) NOT NULL,
  line   text    NOT NULL,
  text   text    NOT NULL,
  PRIMARY KEY (month, line)
);

-- Реєстр договорів та інших документів (лише власник).
CREATE TABLE legal_entities (
  id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name  text   NOT NULL CHECK (length(btrim(name)) > 0),
  pos   int    NOT NULL DEFAULT 0
);
INSERT INTO legal_entities (name, pos) VALUES ('ТОВ «ВУДО»', 1), ('ФОП Єфімов Д. М.', 2), ('Фізична особа Єфімов Д. М.', 3);

CREATE TABLE contracts (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id     bigint      NOT NULL REFERENCES legal_entities(id),
  kind          text        NOT NULL DEFAULT 'договір' CHECK (kind IN ('договір', 'інший документ')),
  counterparty  text        COLLATE ukr NOT NULL CHECK (length(btrim(counterparty)) > 0),
  responsible   text        NOT NULL DEFAULT '',
  subject       text        NOT NULL DEFAULT '',
  -- «150 000 грн», «Специфікація №1», «За рахунками та накладними»
  amount_text   text        NOT NULL DEFAULT '',
  num           text        NOT NULL DEFAULT '',
  signed_on     date,
  ends_text     text        NOT NULL DEFAULT '',
  status        text        NOT NULL DEFAULT '' CHECK (status IN ('', 'Діючий', 'Завершений')),
  original      text        NOT NULL DEFAULT '',
  origin        text        NOT NULL DEFAULT '',
  note          text        NOT NULL DEFAULT '',
  scan_url      text        CHECK (scan_url ~ '^https?://'),
  archived      boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    bigint      REFERENCES users(id)
);
CREATE INDEX contracts_entity_idx ON contracts (entity_id) WHERE NOT archived;
CREATE TABLE contract_files (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contract_id  bigint      NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  size         bigint      NOT NULL,
  mime         text,
  storage_key  text        NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   bigint      REFERENCES users(id)
);
CREATE INDEX contract_files_idx ON contract_files (contract_id);
